import crypto from 'node:crypto';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { normalizeParamsKey, parseTransformationParams } from '../core/param-parser.js';
import { requestLock } from '../core/request-lock.js';
import { negotiateFormat, transformImageBuffer } from '../core/sharp-pipeline.js';
import { transformLimiter } from '../core/transform-limiter.js';
import { cacheManager } from '../storage/cache-manager.js';
import { getStorageDriver } from '../storage/index.js';

import { filesStore } from '../core/files-store.js';
import { keysStore } from '../core/keys-store.js';
import { uploadSigner } from '../core/signer.js';

function isTransformationParamString(segment: string): boolean {
  if (!segment || segment.trim() === '') return false;
  if (segment === 'original') return true;

  const tokens = segment.split(',');
  if (tokens.length === 0) return false;

  const paramPattern = /^(w_\d+|h_\d+|c_(fill|fit|crop|scale)|f_(auto|webp|avif|jpeg|png)|q_(\d+|auto)|e_[a-z0-9_]+|r_(\d+|auto))$/i;

  return tokens.every((token) => paramPattern.test(token.trim()));
}

function getMimeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.avif': return 'image/avif';
    case '.gif': return 'image/gif';
    case '.svg': return 'image/svg+xml';
    case '.pdf': return 'application/pdf';
    case '.mp4': return 'video/mp4';
    case '.webm': return 'video/webm';
    case '.mp3': return 'audio/mpeg';
    case '.zip': return 'application/zip';
    case '.json': return 'application/json';
    case '.csv': return 'text/csv';
    case '.txt': return 'text/plain';
    default: return 'application/octet-stream';
  }
}

function isImageMime(mime: string): boolean {
  return mime.startsWith('image/') && mime !== 'image/svg+xml';
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
   * Raw Media & Document Delivery:
   * GET /v1/raw/*
   */
  fastify.get('/v1/raw/*', async (request: FastifyRequest, reply: FastifyReply) => {
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
    let storageKey = cleanPublicId;
    let asset = await storage.get(storageKey);

    if (!asset) {
      const exts = ['.pdf', '.mp4', '.webm', '.zip', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.json', '.txt'];
      for (const e of exts) {
        const candidate = `${cleanPublicId}${e}`;
        const candidateAsset = await storage.get(candidate);
        if (candidateAsset) {
          asset = candidateAsset;
          storageKey = candidate;
          break;
        }
      }
    }

    if (!asset) {
      return reply.status(404).send({
        success: false,
        error: { code: 'ASSET_NOT_FOUND', message: `File '${cleanPublicId}' was not found in storage.` },
      });
    }

    const mime =
      asset.meta.mimeType && asset.meta.mimeType !== 'application/octet-stream'
        ? asset.meta.mimeType
        : getMimeFromPath(storageKey);

    if (request.headers['if-none-match'] === asset.meta.etag) {
      return reply.status(304).send();
    }

    const filename = path.basename(storageKey);
    const query = request.query as { download?: string };
    const disposition = query.download === '1' || query.download === 'true'
      ? `attachment; filename="${filename}"`
      : `inline; filename="${filename}"`;

    return reply
      .header('Content-Type', mime)
      .header('Content-Disposition', disposition)
      .header('Cache-Control', cacheControlHeader)
      .header('ETag', asset.meta.etag)
      .header('X-Storage-Delivery', 'RAW')
      .header('X-DCD-Delivery', 'RAW')
      .send(asset.buffer);
  });

  /**
   * Universal Image Delivery & Transformation Endpoint (100% DB-Less):
   * GET /v1/image/*
   */
  fastify.get('/v1/image/*', async (request: FastifyRequest, reply: FastifyReply) => {
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

    let params = '';
    let cleanPublicId = normalized;

    const firstSlashIdx = normalized.indexOf('/');
    if (firstSlashIdx !== -1) {
      const potentialParams = normalized.slice(0, firstSlashIdx);
      if (isTransformationParamString(potentialParams)) {
        params = potentialParams;
        cleanPublicId = normalized.slice(firstSlashIdx + 1);
      }
    }

    const accessCheck = await checkAssetAccess(request, reply, cleanPublicId);
    if (!accessCheck.allowed) return;

    const cacheControlHeader = accessCheck.isPrivate
      ? 'private, no-cache, no-store, must-revalidate'
      : 'public, max-age=31536000, immutable';

    const storage = getStorageDriver();
    let storageKey = cleanPublicId;
    let asset = await storage.get(storageKey);

    // If not found directly, check candidate image and non-image extensions
    if (!asset) {
      const exts = ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.svg', '.pdf', '.mp4', '.webm', '.zip', '.txt'];
      for (const e of exts) {
        const candidate = `${cleanPublicId}${e}`;
        const candidateAsset = await storage.get(candidate);
        if (candidateAsset) {
          asset = candidateAsset;
          storageKey = candidate;
          break;
        }
      }
    }

    if (!asset) {
      return reply.status(404).send({
        success: false,
        error: { code: 'ASSET_NOT_FOUND', message: `Asset '${cleanPublicId}' was not found in storage.` },
      });
    }

    const mime =
      asset.meta.mimeType && asset.meta.mimeType !== 'application/octet-stream'
        ? asset.meta.mimeType
        : getMimeFromPath(storageKey);

    // A) Fast-Path: Direct original asset delivery or Non-Raster/Non-Image Asset (PDFs, Videos, SVGs)
    if (!params || !isImageMime(mime)) {
      if (request.headers['if-none-match'] === asset.meta.etag) {
        return reply.status(304).send();
      }

      return reply
        .header('Content-Type', mime)
        .header('Cache-Control', cacheControlHeader)
        .header('ETag', asset.meta.etag)
        .header('X-Storage-Cache', 'BYPASS')
        .header('X-DCD-Cache', 'BYPASS')
        .send(asset.buffer);
    }

    // B) Transformation Path
    const transformParams = parseTransformationParams(params);
    const acceptHeader = request.headers.accept || '';
    const { format: targetFormat, mimeType: targetMime } = negotiateFormat(
      transformParams.format,
      acceptHeader
    );

    const normalizedKey = normalizeParamsKey(transformParams);
    const cacheFilename = cacheManager.getCacheKey(cleanPublicId, normalizedKey, targetFormat);

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

    // 2. Cache Miss: CPU Abuse & Rate Limiting Protection (Anti-Transformation Bombing)
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

    // 3. Cache Miss: Acquire lock, fetch original, transform with Sharp, and cache
    try {
      const result = await requestLock.acquire(cacheFilename, async () => {
        return doTransform(asset!.buffer, transformParams, acceptHeader, cacheFilename);
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
  });
}

async function doTransform(
  inputBuffer: Buffer,
  params: any,
  acceptHeader: string,
  cacheFilename: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  const transformed = await transformImageBuffer(inputBuffer, params, acceptHeader);

  // Write to local disk cache asynchronously
  cacheManager.put(cacheFilename, transformed.buffer).catch(() => { });

  return {
    buffer: transformed.buffer,
    mimeType: transformed.mimeType,
  };
}
