import crypto from 'node:crypto';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { resolveAsset } from '../core/asset-resolver.js';
import { filesStore } from '../core/files-store.js';
import { keysStore } from '../core/keys-store.js';
import { getMimeFromPath, isRasterImageMime } from '../core/mime.js';
import { normalizeParamsKey, parseQueryParams, parseTransformationParams } from '../core/param-parser.js';
import { requestLock } from '../core/request-lock.js';
import { negotiateFormat, transformImageBuffer } from '../core/sharp-pipeline.js';
import { uploadSigner } from '../core/signer.js';
import { transformLimiter } from '../core/transform-limiter.js';
import { cacheManager } from '../storage/cache-manager.js';
import { getStorageDriver } from '../storage/index.js';

function isTransformationParamString(segment: string): boolean {
  if (!segment || segment.trim() === '') return false;
  if (segment === 'original') return true;

  const tokens = segment.split(',');
  if (tokens.length === 0) return false;

  const paramPattern =
    /^(w_\d+|h_\d+|c_(fill|fit|crop|scale)|f_(auto|webp|avif|jpeg|png)|q_(\d+|auto)|e_[a-z0-9_]+|r_(\d+|auto))$/i;

  return tokens.every((token) => paramPattern.test(token.trim()));
}

async function checkAssetAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  cleanPublicId: string
): Promise<{ allowed: boolean; isPrivate: boolean }> {
  const baseId = cleanPublicId.replace(/\.[a-z0-9]+$/i, '');
  const meta = (await filesStore.findByPublicId(cleanPublicId)) || (await filesStore.findByPublicId(baseId));

  if (!meta || meta.access !== 'private') {
    return { allowed: true, isPrivate: false }; // Public asset
  }

  // 1. Check API Key header
  const authHeader = request.headers.authorization || request.headers['x-api-key'];
  if (authHeader && typeof authHeader === 'string') {
    const rawKey = authHeader.replace(/^Bearer\s+/i, '').trim();
    const verified = keysStore.verifyApiKey(rawKey);
    if (verified) {
      const perms = verified.permissions || [];
      if (perms.includes('read') || perms.includes('admin') || verified.type === 'secret') {
        return { allowed: true, isPrivate: true };
      }
    }
  }

  // 2. Check signed URL query parameters (?exp=...&sig=...&keyId=...)
  const query = (request.query || {}) as { exp?: string; sig?: string; keyId?: string };
  const sigResult = uploadSigner.verifyDownloadSignature(cleanPublicId, query);
  if (sigResult.valid) {
    return { allowed: true, isPrivate: true };
  }
  const baseSigResult = uploadSigner.verifyDownloadSignature(baseId, query);
  if (baseSigResult.valid) {
    return { allowed: true, isPrivate: true };
  }

  // Access denied
  reply.status(403).send({
    success: false,
    error: {
      code: 'ACCESS_DENIED',
      message: sigResult.error || 'This asset is private. A valid signed URL or API key is required.',
    },
  });
  return { allowed: false, isPrivate: true };
}

export async function transformRoutes(fastify: FastifyInstance) {
  /**
   * Raw Media & Document Delivery Handler
   */
  const handleRaw = async (request: FastifyRequest, reply: FastifyReply) => {
    const rawWildcard = (request.params as any)['*'] as string;
    if (!rawWildcard) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_PATH', message: 'Asset path must be provided' },
      });
    }

    const cleanPublicId = path
      .normalize(rawWildcard)
      .replace(/^(\.\.[\/\\])+/, '')
      .replace(/^[\/\\]+/, '')
      .replace(/\\/g, '/');

    const accessCheck = await checkAssetAccess(request, reply, cleanPublicId);
    if (!accessCheck.allowed) return;

    const cacheControlHeader = accessCheck.isPrivate
      ? 'private, no-cache, no-store, must-revalidate'
      : 'public, max-age=31536000, immutable';

    const storage = getStorageDriver();
    const urlExt = path.extname(cleanPublicId).toLowerCase();
    const basePublicId = urlExt ? cleanPublicId.slice(0, -urlExt.length) : cleanPublicId;

    const resolved = await resolveAsset(storage, cleanPublicId, basePublicId);
    if (!resolved) {
      return reply.status(404).send({
        success: false,
        error: { code: 'ASSET_NOT_FOUND', message: `File '${cleanPublicId}' was not found in storage.` },
      });
    }

    const mime =
      resolved.meta.mimeType && resolved.meta.mimeType !== 'application/octet-stream'
        ? resolved.meta.mimeType
        : getMimeFromPath(resolved.storageKey);

    if (request.headers['if-none-match'] === resolved.meta.etag) {
      return reply.status(304).send();
    }

    const filename = path.basename(resolved.storageKey);
    const query = request.query as { download?: string };
    const disposition =
      query.download === '1' || query.download === 'true'
        ? `attachment; filename="${filename}"`
        : `inline; filename="${filename}"`;

    return reply
      .header('Content-Type', mime)
      .header('Content-Disposition', disposition)
      .header('Cache-Control', cacheControlHeader)
      .header('ETag', resolved.meta.etag)
      .header('X-Storage-Delivery', 'RAW')
      .header('X-DCD-Delivery', 'RAW')
      .send(resolved.buffer);
  };

  /**
   * Universal Image Delivery & Transformation Endpoint (100% DB-Less & Cloudinary drop-in compatible)
   */
  const handleImage = async (request: FastifyRequest, reply: FastifyReply) => {
    const rawWildcard = (request.params as any)['*'] as string;
    if (!rawWildcard) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_PATH', message: 'Asset path must be provided' },
      });
    }

    const normalized = path
      .normalize(rawWildcard)
      .replace(/^(\.\.[\/\\])+/, '')
      .replace(/^[\/\\]+/, '')
      .replace(/\\/g, '/');

    let pathParams = '';
    let cleanPublicId = normalized;

    // 1. Check if first segment is transformation params (e.g. w_800,h_600,c_fill,f_webp/...)
    const firstSlashIdx = normalized.indexOf('/');
    if (firstSlashIdx !== -1) {
      const potentialParams = normalized.slice(0, firstSlashIdx);
      if (isTransformationParamString(potentialParams)) {
        pathParams = potentialParams;
        cleanPublicId = normalized.slice(firstSlashIdx + 1);
      }
    }

    // 2. Strip Cloudinary cache-busting version prefix if present (e.g. v16928401/avatars/john.jpg -> avatars/john.jpg)
    cleanPublicId = cleanPublicId.replace(/^v\d+\//, '');

    // 3. Extract requested URL extension (e.g. .webp, .jpg, .png)
    const urlExt = path.extname(cleanPublicId).toLowerCase();
    const basePublicId = urlExt ? cleanPublicId.slice(0, -urlExt.length) : cleanPublicId;

    // 4. Merge path transformation params and query string params (e.g. ?w=800&fit=cover)
    const queryTransform = parseQueryParams(request.query as Record<string, any>);
    const pathTransform = parseTransformationParams(pathParams);
    const transformParams = { ...queryTransform, ...pathTransform };

    // 5. If format was not explicitly specified via f_ in params, but the URL ended with an image extension,
    // infer the format from the URL extension (Cloudinary standard behavior)
    if (!transformParams.format && urlExt) {
      const extFmt = urlExt.slice(1);
      if (extFmt === 'jpg' || extFmt === 'jpeg') transformParams.format = 'jpeg';
      else if (extFmt === 'webp') transformParams.format = 'webp';
      else if (extFmt === 'avif') transformParams.format = 'avif';
      else if (extFmt === 'png') transformParams.format = 'png';
    }

    const accessCheck = await checkAssetAccess(request, reply, cleanPublicId);
    if (!accessCheck.allowed) return;

    const cacheControlHeader = accessCheck.isPrivate
      ? 'private, no-cache, no-store, must-revalidate'
      : 'public, max-age=31536000, immutable';

    const storage = getStorageDriver();
    const resolved = await resolveAsset(storage, cleanPublicId, basePublicId);

    if (!resolved) {
      return reply.status(404).send({
        success: false,
        error: { code: 'ASSET_NOT_FOUND', message: `Asset '${cleanPublicId}' was not found in storage.` },
      });
    }

    const mime =
      resolved.meta.mimeType && resolved.meta.mimeType !== 'application/octet-stream'
        ? resolved.meta.mimeType
        : getMimeFromPath(resolved.storageKey);

    // Check if transformations or format conversion is needed
    const isRaster = isRasterImageMime(mime);
    const hasTransformParams = Boolean(
      transformParams.width ||
      transformParams.height ||
      transformParams.cropMode ||
      transformParams.quality ||
      transformParams.blur ||
      transformParams.grayscale ||
      transformParams.sharpen ||
      transformParams.rotation
    );
    const originalExt = path.extname(resolved.storageKey).toLowerCase().replace(/^\./, '');
    const needsFormatConversion = Boolean(
      transformParams.format &&
      transformParams.format !== 'auto' &&
      transformParams.format !== originalExt &&
      !(transformParams.format === 'jpeg' && (originalExt === 'jpg' || originalExt === 'jpeg'))
    );

    // Fast-Path: Direct original asset delivery without transforms or Non-Raster Asset (PDFs, Videos, SVGs)
    if (!isRaster || (!hasTransformParams && !needsFormatConversion)) {
      if (request.headers['if-none-match'] === resolved.meta.etag) {
        return reply.status(304).send();
      }

      return reply
        .header('Content-Type', mime)
        .header('Cache-Control', cacheControlHeader)
        .header('ETag', resolved.meta.etag)
        .header('X-Storage-Cache', 'BYPASS')
        .header('X-DCD-Cache', 'BYPASS')
        .send(resolved.buffer);
    }

    // Transformation Path
    const acceptHeader = request.headers.accept || '';
    const { format: targetFormat, mimeType: targetMime } = negotiateFormat(
      transformParams.format,
      acceptHeader
    );

    const normalizedKey = normalizeParamsKey(transformParams);
    const cacheFilename = cacheManager.getCacheKey(basePublicId || cleanPublicId, normalizedKey, targetFormat);

    // 1. Check local disk cache (Cache HIT)
    const cachedBuffer = await cacheManager.get(cacheFilename);
    if (cachedBuffer) {
      const etag = crypto.createHash('md5').update(cachedBuffer).digest('hex');

      if (request.headers['if-none-match'] === etag) {
        return reply.status(304).send();
      }

      return reply
        .header('Content-Type', targetMime)
        .header('Cache-Control', cacheControlHeader)
        .header('ETag', etag)
        .header('Vary', 'Accept')
        .header('X-Storage-Cache', 'HIT')
        .header('X-DCD-Cache', 'HIT')
        .send(cachedBuffer);
    }

    // 2. Cache Miss: Rate Limiting Protection
    const clientIp = request.ip || (request.headers['x-forwarded-for'] as string) || '127.0.0.1';
    if (!transformLimiter.allow(clientIp)) {
      const remaining = transformLimiter.getRemaining(clientIp);
      return reply
        .status(429)
        .header('Retry-After', String(remaining.resetInSeconds))
        .send({
          success: false,
          error: {
            code: 'TRANSFORMATION_RATE_LIMIT_EXCEEDED',
            message: `Transformation rate limit exceeded (max 60 new transformations/min). Try again in ${remaining.resetInSeconds} seconds.`,
          },
        });
    }

    // 3. Cache Miss: Transform with Sharp and cache
    try {
      const result = await requestLock.acquire(cacheFilename, async () => {
        return doTransform(resolved.buffer, transformParams, acceptHeader, cacheFilename);
      });

      const etag = crypto.createHash('md5').update(result.buffer).digest('hex');

      return reply
        .header('Content-Type', result.mimeType)
        .header('Cache-Control', cacheControlHeader)
        .header('ETag', etag)
        .header('Vary', 'Accept')
        .header('X-Storage-Cache', 'MISS')
        .header('X-DCD-Cache', 'MISS')
        .send(result.buffer);
    } catch (err: any) {
      if (err.message === 'ASSET_NOT_FOUND') {
        return reply.status(404).send({
          success: false,
          error: { code: 'ASSET_NOT_FOUND', message: `Image '${cleanPublicId}' was not found in storage.` },
        });
      }
      throw err;
    }
  };

  // Register universal CDN & storage delivery routes
  fastify.get('/cdn/*', handleImage);
  fastify.get('/storage/*', handleImage);
  fastify.get('/files/*', handleImage);

  // Cloudinary migration compatibility routes
  fastify.get('/image/upload/*', handleImage);
  fastify.get('/raw/upload/*', handleRaw);

  // Legacy API compatibility routes
  fastify.get('/v1/image/*', handleImage);
  fastify.get('/v1/raw/*', handleRaw);
}

async function doTransform(
  inputBuffer: Buffer,
  params: any,
  acceptHeader: string,
  cacheFilename: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  const transformed = await transformImageBuffer(inputBuffer, params, acceptHeader);

  // Write to local disk cache asynchronously
  cacheManager.put(cacheFilename, transformed.buffer).catch(() => {});

  return {
    buffer: transformed.buffer,
    mimeType: transformed.mimeType,
  };
}
