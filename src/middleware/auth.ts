import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import { keysStore } from '../core/keys-store.js';
import { uploadSigner, type SignedUploadPayload } from '../core/signer.js';
import type { ApiKeyRecord } from '../types/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    apiKeyRecord?: ApiKeyRecord;
    signedUploadPayload?: SignedUploadPayload;
  }
}

export function extractApiKey(request: FastifyRequest): string | null {
  const adminKey = request.headers['x-admin-key'];
  if (typeof adminKey === 'string' && adminKey.trim()) {
    return adminKey.trim();
  }

  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  const xApiKey = request.headers['x-api-key'];
  if (typeof xApiKey === 'string' && xApiKey.trim()) {
    return xApiKey.trim();
  }

  const xUploadToken = request.headers['x-upload-token'];
  if (typeof xUploadToken === 'string' && xUploadToken.trim()) {
    return xUploadToken.trim();
  }

  const queryKey = (request.query as any)?.key;
  if (typeof queryKey === 'string' && queryKey.trim()) {
    return queryKey.trim();
  }

  const queryToken = (request.query as any)?.token;
  if (typeof queryToken === 'string' && queryToken.trim()) {
    return queryToken.trim();
  }

  return null;
}

export function requireApiKey(
  requiredPermission: 'any' | 'read' | 'write' | 'delete' | 'admin' | 'public' | 'secret' = 'any'
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Control Plane / DevCloudDesk Agent internal bypass
    const ip = request.ip || '';
    const isInternal =
      ip === '127.0.0.1' ||
      ip === '::1' ||
      ip.startsWith('172.') ||
      ip.startsWith('10.') ||
      request.headers['x-dcd-agent'] === 'true';

    if (isInternal) {
      return;
    }

    const rawKey = extractApiKey(request);

    if (!rawKey) {
      return reply.status(401).send({
        success: false,
        error: {
          code: 'AUTH_API_KEY_REQUIRED',
          message: 'An API key or signed upload token is required.',
        },
      });
    }

    // Check if it's a signed upload token
    if (rawKey.startsWith('sig_') || rawKey.startsWith('dcd_sig_')) {
      if (requiredPermission !== 'write' && requiredPermission !== 'any') {
        return reply.status(403).send({
          success: false,
          error: {
            code: 'AUTH_FORBIDDEN_ROLE',
            message: 'Signed upload tokens can only be used for file uploads.',
          },
        });
      }

      const verified = uploadSigner.verifyToken(rawKey);
      if (!verified.valid || !verified.payload) {
        return reply.status(401).send({
          success: false,
          error: {
            code: 'AUTH_INVALID_SIGNED_TOKEN',
            message: verified.error || 'The signed upload token is invalid or expired.',
          },
        });
      }

      request.signedUploadPayload = verified.payload;
      return;
    }

    // Master Key check (Root Admin via env.MASTER_KEY)
    if (env.MASTER_KEY && rawKey === env.MASTER_KEY) {
      request.apiKeyRecord = {
        id: 'master-key',
        keyHash: '',
        keyPrefix: 'master',
        name: 'Master Admin Key',
        permissions: ['read', 'write', 'delete', 'admin'],
        type: 'secret',
        rateLimit: 1000,
        createdAt: 0,
      };
      return;
    }

    const record = keysStore.verifyApiKey(rawKey);

    if (!record) {
      return reply.status(401).send({
        success: false,
        error: {
          code: 'AUTH_INVALID_API_KEY',
          message: 'The provided API key is invalid or has been revoked.',
        },
      });
    }

    // Role / permission verification
    const perms =
      record.permissions ||
      (record.type === 'secret' ? ['read', 'write', 'delete', 'admin'] : ['read', 'write']);

    if (
      (requiredPermission === 'write' || requiredPermission === 'any') &&
      !perms.includes('write') &&
      !perms.includes('admin')
    ) {
      return reply.status(403).send({
        success: false,
        error: {
          code: 'AUTH_FORBIDDEN_ROLE',
          message: 'This operation requires an API Key with "Add (Upload)" role.',
        },
      });
    }

    if (
      requiredPermission === 'read' &&
      !perms.includes('read') &&
      !perms.includes('admin')
    ) {
      return reply.status(403).send({
        success: false,
        error: {
          code: 'AUTH_FORBIDDEN_ROLE',
          message: 'This operation requires an API Key with "Read" role.',
        },
      });
    }

    if (
      (requiredPermission === 'delete' || requiredPermission === 'secret') &&
      !perms.includes('delete') &&
      !perms.includes('admin')
    ) {
      return reply.status(403).send({
        success: false,
        error: {
          code: 'AUTH_FORBIDDEN_ROLE',
          message: 'This operation requires an API Key with "Delete" role.',
        },
      });
    }

    request.apiKeyRecord = record;
  };
}
