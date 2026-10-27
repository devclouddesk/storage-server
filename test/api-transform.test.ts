import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { filesStore } from '../src/core/files-store.js';
import { getStorageDriver } from '../src/storage/index.js';
import type { MediaFileRecord } from '../src/types/index.js';

describe('Transform & CDN Delivery Routes (/cdn, /image/upload, /raw/upload, /storage)', () => {
  let app: FastifyInstance;
  const storage = getStorageDriver();

  // 1x1 transparent PNG binary bytes
  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64'
  );

  const sampleRecord: MediaFileRecord = {
    id: 'test_asset_100',
    publicId: 'test_folder/sample',
    originalName: 'sample.png',
    folder: 'test_folder',
    mimeType: 'image/png',
    format: 'png',
    bytes: tinyPng.length,
    width: 1,
    height: 1,
    resourceType: 'image',
    storageDriver: 'local',
    etag: 'sample_etag_100',
    access: 'public',
    createdAt: 1761500000,
  };

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.ready();

    // Seed test asset into storage & filesStore
    await storage.put('test_folder/sample.png', tinyPng, 'image/png');
    await filesStore.saveFileMeta('test_folder/sample.png', sampleRecord);
  });

  afterAll(async () => {
    await storage.delete('test_folder/sample.png').catch(() => {});
    await filesStore.deleteMediaFile('test_folder/sample.png').catch(() => {});
    await app.close();
  });

  it('delivers image directly via /cdn route (Fast-Path bypass)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/cdn/test_folder/sample.png',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-storage-cache']).toBe('BYPASS');
    expect(res.rawPayload.length).toBe(tinyPng.length);
  });

  it('delivers image via Cloudinary-compatible /image/upload route', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/image/upload/test_folder/sample.png',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
  });

  it('strips Cloudinary version prefix v123456/ and resolves asset', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/image/upload/v1761570000/test_folder/sample.png',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
  });

  it('returns 304 Not Modified when if-none-match header matches ETag', async () => {
    const initialRes = await app.inject({
      method: 'GET',
      url: '/cdn/test_folder/sample.png',
    });
    const etag = initialRes.headers.etag as string;
    expect(etag).toBeDefined();

    const res = await app.inject({
      method: 'GET',
      url: '/cdn/test_folder/sample.png',
      headers: {
        'if-none-match': etag,
      },
    });

    expect(res.statusCode).toBe(304);
    expect(res.body).toBe('');
  });

  it('returns 404 for non-existent assets', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/cdn/unknown/does_not_exist.png',
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('ASSET_NOT_FOUND');
  });
});
