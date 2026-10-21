import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.js';
import { filesStore } from '../core/files-store.js';
import { foldersStore } from '../core/folders-store.js';
import { keysStore } from '../core/keys-store.js';
import { extractApiKey, requireApiKey } from '../middleware/auth.js';
import { cacheManager } from '../storage/cache-manager.js';
import { getStorageDriver, getStorageProviderName, saveStorageConfig } from '../storage/index.js';
import type { ServerStats } from '../types/index.js';

export async function adminRoutes(fastify: FastifyInstance) {
  // Pre-handler for all admin endpoints
  fastify.addHook('preHandler', async (request, reply) => {
    const rawKey = extractApiKey(request);

    // 1. Direct Master Key check (via header x-admin-key, Authorization Bearer, or query)
    if (env.MASTER_KEY && rawKey === env.MASTER_KEY) {
      return;
    }

    // 2. Localhost internal management bypass (for local CLI & agent)
    const ip = request.ip || '';
    const isInternal =
      ip === '127.0.0.1' ||
      ip === '::1' ||
      ip.startsWith('172.') ||
      ip.startsWith('10.') ||
      request.headers['x-dcd-agent'] === 'true';

    if (isInternal) return;

    if (!rawKey) {
      return reply.status(401).send({
        success: false,
        error: { code: 'AUTH_REQUIRED', message: 'Admin API requires authentication' },
      });
    }

    const record = keysStore.verifyApiKey(rawKey);
    const perms = record?.permissions || [];
    const isAuthorized =
      record &&
      (record.type === 'secret' || perms.includes('delete') || perms.includes('admin') || perms.includes('write'));

    if (!isAuthorized) {
      return reply.status(403).send({
        success: false,
        error: { code: 'AUTH_FORBIDDEN', message: 'Admin API requires an authorized API Key' },
      });
    }
  });

  /**
   * GET /v1/admin/stats
   */
  fastify.get('/v1/admin/stats', async () => {
    const filesStats = await filesStore.getMediaStats();
    const cacheStats = await cacheManager.getStats();
    const memory = process.memoryUsage();

    const stats: ServerStats = {
      filesCount: filesStats.totalFiles,
      totalStorageBytes: filesStats.totalBytes,
      cacheVariantsCount: cacheStats.variantsCount,
      cacheSizeBytes: cacheStats.totalBytes,
      uptimeSeconds: Math.floor(process.uptime()),
      memoryUsageMb: Math.round(memory.rss / (1024 * 1024)),
      storageDriver: getStorageProviderName(),
    };

    return { success: true, stats };
  });

  /**
   * GET /v1/admin/files
   */
  fastify.get('/v1/admin/files', async (request: FastifyRequest) => {
    const query = request.query as { page?: string; limit?: string; folder?: string };
    const page = Math.max(1, parseInt(query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(query.limit || '50', 10)));
    const offset = (page - 1) * limit;

    const { files, total } = await filesStore.listMediaFiles(limit, offset, query.folder);

    const protocol = request.protocol;
    const host = request.headers.host;
    const baseUrl = `${protocol}://${host}`;

    const enrichedFiles = files.map((f) => {
      const ext = f.format ? `.${f.format}` : '';
      const directUrl = `${baseUrl}/v1/image/${f.publicId}${ext}`;
      return {
        ...f,
        public_id: f.publicId,
        resource_type: f.resourceType,
        url: directUrl,
        secure_url: directUrl,
        secureUrl: directUrl,
      };
    });

    return {
      success: true,
      data: {
        files: enrichedFiles,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: offset + limit < total,
          hasPrev: page > 1,
        },
      },
    };
  });

  /**
   * GET /v1/admin/files/*
   * Retrieves full metadata for a single asset by publicId
   */
  fastify.get('/v1/admin/files/*', async (request: FastifyRequest, reply: FastifyReply) => {
    const rawPublicId = (request.params as any)['*'] as string;
    if (!rawPublicId) {
      return reply.status(400).send({ success: false, error: { message: 'Missing publicId' } });
    }

    const decoded = decodeURIComponent(rawPublicId);
    const file = await filesStore.findByPublicId(decoded);
    if (!file) {
      return reply.status(404).send({
        success: false,
        error: { code: 'ASSET_NOT_FOUND', message: `File '${decoded}' was not found in storage.` },
      });
    }

    const protocol = request.protocol;
    const host = request.headers.host;
    const baseUrl = `${protocol}://${host}`;
    const ext = file.format ? `.${file.format}` : '';
    const directUrl = `${baseUrl}/v1/image/${file.publicId}${ext}`;
    const rawUrl = `${baseUrl}/v1/raw/${file.publicId}${ext}`;

    return reply.status(200).send({
      success: true,
      asset: {
        ...file,
        public_id: file.publicId,
        resource_type: file.resourceType,
        url: directUrl,
        secure_url: directUrl,
        rawUrl,
      },
    });
  });

  /**
   * PATCH /v1/admin/files/*
   * Updates asset access level (e.g. 'public' <-> 'private')
   */
  fastify.patch('/v1/admin/files/*', async (request: FastifyRequest, reply: FastifyReply) => {
    const rawPublicId = (request.params as any)['*'] as string;
    if (!rawPublicId) {
      return reply.status(400).send({ success: false, error: { message: 'Missing publicId' } });
    }

    const decoded = decodeURIComponent(rawPublicId);
    const body = (request.body || {}) as { access?: 'public' | 'private' };
    if (!body.access || (body.access !== 'public' && body.access !== 'private')) {
      return reply.status(400).send({
        success: false,
        error: { message: "Invalid payload. 'access' must be 'public' or 'private'." },
      });
    }

    const updated = await filesStore.updateFileMeta(decoded, { access: body.access });
    if (!updated) {
      return reply.status(404).send({
        success: false,
        error: { code: 'ASSET_NOT_FOUND', message: `File '${decoded}' was not found in storage.` },
      });
    }

    await cacheManager.purgeAll();

    return reply.status(200).send({
      success: true,
      message: `Access mode updated to '${body.access}'`,
      asset: updated,
    });
  });

  /**
   * POST /v1/admin/keys
   */
  fastify.post('/v1/admin/keys', async (request: FastifyRequest, reply: FastifyReply) => {
    const schema = z.object({
      name: z.string().min(1).max(100),
      permissions: z.array(z.enum(['read', 'write', 'delete', 'admin'])).optional(),
      roles: z.array(z.string()).optional(),
      type: z.enum(['public', 'secret']).optional(),
      rateLimit: z.number().int().min(10).max(10000).default(120),
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.format() });
    }

    // Map permissions / roles
    let permissions: any[] = parsed.data.permissions || [];
    if (permissions.length === 0 && parsed.data.roles && parsed.data.roles.length > 0) {
      permissions = parsed.data.roles.map((r: string) => (r === 'add' || r === 'upload' ? 'write' : r));
    }
    if (permissions.length === 0) {
      permissions = parsed.data.type === 'secret' ? ['read', 'write', 'delete', 'admin'] : ['read', 'write'];
    }

    const { key, record } = keysStore.createKey(
      parsed.data.name,
      permissions,
      parsed.data.rateLimit
    );

    return reply.status(201).send({
      success: true,
      key, // Return raw key only once on creation
      apiKey: record,
    });
  });

  /**
   * GET /v1/admin/keys
   */
  fastify.get('/v1/admin/keys', async () => {
    const keys = keysStore.listApiKeys();
    return { success: true, keys };
  });

  /**
   * DELETE /v1/admin/keys/:id
   */
  fastify.delete('/v1/admin/keys/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const deleted = keysStore.deleteApiKey(id);
    if (!deleted) {
      return reply.status(404).send({ success: false, error: { message: 'Key not found' } });
    }
    return { success: true, message: 'API key revoked' };
  });

  /**
   * DELETE /v1/admin/files/*, /v1/files/*, and /v1/delete/*
   */
  const handleDelete = async (request: FastifyRequest, reply: FastifyReply) => {
    const rawPublicId = (request.params as any)['*'] as string;
    if (!rawPublicId) {
      return reply.status(400).send({ success: false, error: { message: 'Missing publicId' } });
    }

    const decoded = decodeURIComponent(rawPublicId);
    const deleted = await filesStore.deleteMediaFile(decoded);
    await cacheManager.purgeAll();

    return {
      success: true,
      deleted,
      message: deleted
        ? `File '${decoded}' deleted successfully`
        : `File '${decoded}' was not found, but cache was purged`,
    };
  };

  fastify.delete('/v1/admin/files/*', handleDelete);
  fastify.delete('/v1/files/*', handleDelete);
  fastify.delete('/v1/delete/*', handleDelete);

  /**
   * GET /v1/admin/folders
   * Returns all storage folders with item counts
   */
  fastify.get('/v1/admin/folders', async (request: FastifyRequest) => {
    const query = request.query as { parent?: string };
    const folders = await foldersStore.listFolders(query.parent);
    return { success: true, folders };
  });

  /**
   * POST /v1/admin/folders
   * Creates a new virtual or explicit folder
   */
  fastify.post('/v1/admin/folders', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body || {}) as { name?: string; path?: string; parent?: string };
    const name = (body.name || '').trim();
    const parent = (body.parent || '').trim();
    const rawPath = body.path || (parent ? `${parent}/${name}` : name);

    if (!rawPath) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_FOLDER_NAME', message: 'Folder name or path is required.' },
      });
    }

    try {
      const folder = await foldersStore.createFolder(rawPath);
      return reply.status(201).send({ success: true, folder });
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        error: { code: 'FOLDER_CREATE_FAILED', message: err.message },
      });
    }
  });

  /**
   * DELETE /v1/admin/folders/*
   * Deletes a folder and all its contents
   */
  fastify.delete('/v1/admin/folders/*', async (request: FastifyRequest, reply: FastifyReply) => {
    const rawPath = (request.params as any)['*'] as string;
    if (!rawPath) {
      return reply.status(400).send({ success: false, error: { message: 'Missing folder path' } });
    }

    const decoded = decodeURIComponent(rawPath);
    const { success, deletedCount } = await foldersStore.deleteFolder(decoded);
    await cacheManager.purgeAll();

    return {
      success,
      deletedCount,
      message: `Folder '${decoded}' and ${deletedCount} file(s) deleted successfully`,
    };
  });

  /**
   * POST /v1/admin/storage
   */
  fastify.post('/v1/admin/storage', async (request: FastifyRequest, reply: FastifyReply) => {
    const schema = z.object({
      provider: z.enum(['local', 's3']),
      s3: z
        .object({
          bucket: z.string(),
          region: z.string().default('auto'),
          endpoint: z.string().optional(),
          accessKeyId: z.string(),
          secretAccessKey: z.string(),
        })
        .optional(),
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.format() });
    }

    saveStorageConfig(parsed.data as any);
    return { success: true, message: 'Storage backend updated' };
  });
}
