import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { keysStore } from '../src/core/keys-store.js';

describe('Upload & Signing Endpoints (POST /v1/upload/sign, POST /v1/download/sign)', () => {
  let app: FastifyInstance;
  let testKey: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.ready();

    // Create an authorized test API key
    const created = keysStore.createKey('Upload Route Test Key', ['read', 'write', 'admin'], 100);
    testKey = created.key;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /v1/upload/sign', () => {
    it('generates a valid signed upload token with custom constraints', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/upload/sign',
        headers: {
          authorization: `Bearer ${testKey}`,
          'content-type': 'application/json',
        },
        payload: {
          folder: 'avatars/users',
          maxBytes: 5242880, // 5MB
          expiresInSeconds: 600,
          access: 'public',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.token).toMatch(/^sig_/);
      expect(body.folder).toBe('avatars/users');
      expect(body.maxBytes).toBe(5242880);
      expect(body.expiresInSeconds).toBe(600);
      expect(body.uploadUrl).toContain('/v1/upload');
    });

    it('rejects invalid parameters with clean validation errors', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/upload/sign',
        headers: {
          authorization: `Bearer ${testKey}`,
          'content-type': 'application/json',
        },
        payload: {
          maxBytes: -500, // Invalid negative number
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.success).toBe(false);
      expect(body.error?.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /v1/download/sign', () => {
    it('generates a signed download URL for a private asset', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/download/sign',
        headers: {
          authorization: `Bearer ${testKey}`,
          'content-type': 'application/json',
        },
        payload: {
          publicId: 'invoices/inv_2026_01',
          expiresInSeconds: 300,
          resourceType: 'raw',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.publicId).toBe('invoices/inv_2026_01');
      expect(body.signedUrl).toContain('sig=');
      expect(body.signedUrl).toContain('exp=');
      expect(body.signedUrl).toContain('keyId=');
    });

    it('returns 400 when publicId is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/download/sign',
        headers: {
          authorization: `Bearer ${testKey}`,
          'content-type': 'application/json',
        },
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.success).toBe(false);
      expect(body.error?.code).toBe('VALIDATION_ERROR');
    });
  });
});
