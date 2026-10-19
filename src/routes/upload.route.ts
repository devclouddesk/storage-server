import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { nanoid } from 'nanoid';
import { detectFileType } from '../core/magic-bytes.js';
import { inspectImageMetadata } from '../core/sharp-pipeline.js';
import { filesStore } from '../core/files-store.js';
import { foldersStore } from '../core/folders-store.js';
import { requireApiKey } from '../middleware/auth.js';
import { uploadSigner } from '../core/signer.js';
import { getStorageDriver, getStorageProviderName } from '../storage/index.js';
import type { MediaFileRecord } from '../types/index.js';

export async function uploadRoutes(fastify: FastifyInstance) {
  /**
   * Generates a signed upload token for safe client-side browser/mobile uploads
   * POST /v1/upload/sign
   */
  fastify.post(
    '/v1/upload/sign',
    { preHandler: [requireApiKey('write')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const keyRecord = request.apiKeyRecord;
      if (!keyRecord) {
        return reply.status(401).send({
          success: false,
          error: { code: 'AUTH_REQUIRED', message: 'Valid API Key required to generate signed upload tokens.' },
        });
      }

      const body = (request.body || {}) as {
        folder?: string;
        maxBytes?: number;
        expiresInSeconds?: number;
      };

      const folder = body.folder
        ? path.normalize(body.folder).replace(/^(\.\.[\/\\])+/, '').replace(/\\/g, '/').replace(/^\//, '')
        : undefined;

      const token = uploadSigner.createToken(keyRecord.id, keyRecord.keyHash, {
        folder,
        maxBytes: body.maxBytes,
        expiresInSeconds: body.expiresInSeconds || 300,
      });

      const protocol = request.protocol;
      const host = request.headers.host;
      const baseUrl = `${protocol}://${host}`;

      return reply.status(200).send({
        success: true,
        token,
        uploadUrl: `${baseUrl}/v1/upload`,
        expiresInSeconds: body.expiresInSeconds || 300,
        folder: folder || null,
        maxBytes: body.maxBytes || null,
      });
    }
  );

  /**
   * Upload file (Supports images, PDFs, videos, SVGs, documents, archives)
   * Accepts Master API Key OR Short-lived Signed Upload Token
   * POST /v1/upload
   */
  fastify.post(
    '/v1/upload',
    { preHandler: [requireApiKey('write')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const data = await request.file();

      if (!data) {
        return reply.status(400).send({
          success: false,
          error: { code: 'FILE_MISSING', message: 'No file was uploaded in the request.' },
        });
      }

      // Buffer file into memory
      const buffer = await data.toBuffer();

      // Signed token constraints validation (if uploaded via signed token)
      const signedPayload = request.signedUploadPayload;
      if (signedPayload) {
        if (signedPayload.maxBytes && buffer.length > signedPayload.maxBytes) {
          return reply.status(413).send({
            success: false,
            error: {
              code: 'FILE_TOO_LARGE',
              message: `File exceeds maximum allowed size of ${signedPayload.maxBytes} bytes specified in upload token.`,
            },
          });
        }
      }

      // Detect file type via magic bytes & extension fallback
      const detected = detectFileType(buffer, data.filename || '', data.mimetype || '');

      // Inspect metadata with Sharp ONLY for raster images (JPEG, PNG, WebP, AVIF, GIF, TIFF)
      let metadata: { width?: number; height?: number } = {};
      if (detected.isRasterImage) {
        try {
          metadata = await inspectImageMetadata(buffer);
        } catch {
          return reply.status(400).send({
            success: false,
            error: {
              code: 'CORRUPTED_IMAGE',
              message: 'Image data is corrupted or could not be decoded by Sharp.',
            },
          });
        }
      }

      // Extract optional fields (folder, public_id, overwrite, unique_filename)
      const fields = (data.fields || {}) as Record<string, any>;
      let rawFolder = fields.folder?.value ? String(fields.folder.value) : '/';

      // Enforce signed token folder restriction if present
      if (signedPayload?.folder) {
        rawFolder = signedPayload.folder;
      }

      const cleanFolder = path
        .normalize(rawFolder)
        .replace(/^(\.\.[\/\\])+/, '')
        .replace(/\\/g, '/')
        .replace(/^\/+|\/+$/g, '');

      if (cleanFolder) {
        foldersStore.createFolder(cleanFolder).catch(() => {});
      }
      const customPublicId = fields.public_id?.value ? String(fields.public_id.value).trim() : null;

      // Overwrite flag: default is true (matches S3 & Cloudinary standard behavior)
      const rawOverwrite = fields.overwrite?.value;
      const shouldOverwrite =
        rawOverwrite === undefined
          ? true
          : rawOverwrite === true || rawOverwrite === 'true' || rawOverwrite === '1' || rawOverwrite === 1;

      // Unique filename flag: if true, appends unique suffix
      const rawUnique = fields.unique_filename?.value || fields.uniqueFilename?.value;
      const isUniqueRequested = rawUnique === true || rawUnique === 'true' || rawUnique === '1';

      let filenameId: string;
      if (customPublicId) {
        filenameId = customPublicId;
      } else {
        const parsed = path.parse(data.filename || 'asset');
        const cleanName =
          (parsed.name || 'asset')
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '') || 'asset';

        if (isUniqueRequested) {
          filenameId = `${cleanName}-${nanoid(8)}`;
        } else {
          filenameId = cleanName;
        }
      }

      const publicId =
        cleanFolder === '/' || cleanFolder === ''
          ? filenameId
          : `${cleanFolder.replace(/^\//, '')}/${filenameId}`;

      const format = detected.ext;
      const storageKey = `${publicId}.${format}`;
      const storage = getStorageDriver();

      // Check if file with this publicId already exists
      const existing = await filesStore.findByPublicId(publicId);

      if (existing) {
        if (!shouldOverwrite) {
          return reply.status(409).send({
            success: false,
            error: {
              code: 'FILE_ALREADY_EXISTS',
              message: `An asset with public_id '${publicId}' already exists in folder '${cleanFolder}'. Set overwrite: true to replace it.`,
              existingAsset: {
                publicId: existing.publicId,
                originalName: existing.originalName,
                format: existing.format,
                bytes: existing.bytes,
                createdAt: existing.createdAt,
              },
            },
          });
        }

        // If overwriting and format changed (e.g. was .png, now .jpg), clean up the previous file
        if (existing.format !== format) {
          const oldStorageKey = `${existing.publicId}.${existing.format}`;
          await storage.delete(oldStorageKey).catch(() => {});
          await filesStore.deleteMediaFile(oldStorageKey).catch(() => {});
        }
      }

      // Write to storage driver (Local NVMe or S3)
      const stored = await storage.put(storageKey, buffer, detected.mime);

      const record: MediaFileRecord = {
        id: existing?.id || nanoid(),
        publicId,
        originalName: data.filename || 'uploaded-asset',
        folder: cleanFolder,
        mimeType: detected.mime,
        format,
        bytes: stored.size,
        width: metadata.width,
        height: metadata.height,
        resourceType: detected.category,
        storageDriver: getStorageProviderName(),
        etag: stored.etag,
        createdAt: existing?.createdAt || stored.createdAt,
      };

      // Persist to local file metadata
      await filesStore.saveFileMeta(storageKey, record);

      const protocol = request.protocol;
      const host = request.headers.host;
      const baseUrl = `${protocol}://${host}`;
      const assetUrl = `${baseUrl}/v1/image/${record.publicId}.${record.format}`;
      const rawUrl = `${baseUrl}/v1/raw/${record.publicId}.${record.format}`;

      return reply.status(existing ? 200 : 201).send({
        success: true,
        overwritten: !!existing,
        asset: {
          public_id: record.publicId,
          publicId: record.publicId,
          filename: record.originalName,
          format: record.format,
          resource_type: record.resourceType,
          resourceType: record.resourceType,
          width: record.width,
          height: record.height,
          bytes: record.bytes,
          storageDriver: record.storageDriver,
          etag: record.etag,
          url: assetUrl,
          secure_url: assetUrl,
          secureUrl: assetUrl,
          rawUrl,
          created_at: record.createdAt,
          createdAt: record.createdAt,
        },
      });
    }
  );
}
