import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { keysStore } from '../src/core/keys-store.js';

describe('Admin Endpoints (Stats, Folders, Keys & Cache Management)', () => {
  let app: FastifyInstance;
  let adminKey: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.ready();

    // Create an admin key
    const created = keysStore.createKey('Integration Admin Test Key', ['admin', 'read', 'write', 'delete'], 500);
    adminKey = created.key;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /v1/admin/stats returns system and storage metrics', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/stats',
      headers: { authorization: `Bearer ${adminKey}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.stats).toBeDefined();
    expect(body.stats.filesCount).toBeTypeOf('number');
    expect(body.stats.totalStorageBytes).toBeTypeOf('number');
    expect(body.stats.uptimeSeconds).toBeTypeOf('number');
    expect(body.stats.storageDriver).toBeDefined();
  });

  it('POST & GET /v1/admin/folders manages virtual folder hierarchies', async () => {
    // 1. Create folder
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/admin/folders',
      headers: {
        authorization: `Bearer ${adminKey}`,
        'content-type': 'application/json',
      },
      payload: { name: 'admin-test-folder' },
    });

    expect(createRes.statusCode).toBe(201);
    const createBody = createRes.json();
    expect(createBody.success).toBe(true);
    expect(createBody.folder.path).toBe('admin-test-folder');

    // 2. List folders
    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/admin/folders',
      headers: { authorization: `Bearer ${adminKey}` },
    });

    expect(listRes.statusCode).toBe(200);
    const listBody = listRes.json();
    expect(listBody.success).toBe(true);
    expect(listBody.folders.some((f: any) => f.path === 'admin-test-folder')).toBe(true);

    // 3. Delete folder
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: '/v1/admin/folders/admin-test-folder',
      headers: { authorization: `Bearer ${adminKey}` },
    });

    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json().success).toBe(true);
  });

  it('POST & DELETE /v1/admin/keys manages API keys lifecycle', async () => {
    // 1. Create a key via API
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/admin/keys',
      headers: {
        authorization: `Bearer ${adminKey}`,
        'content-type': 'application/json',
      },
      payload: {
        name: 'Temporary Agent Key',
        type: 'secret',
        permissions: ['read', 'write'],
        rateLimit: 60,
      },
    });

    expect(createRes.statusCode).toBe(201);
    const createBody = createRes.json();
    expect(createBody.success).toBe(true);
    expect(createBody.key).toMatch(/^dcd_key_live_/);
    const keyId = createBody.apiKey.id;

    // 2. List keys
    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/admin/keys',
      headers: { authorization: `Bearer ${adminKey}` },
    });

    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().keys.some((k: any) => k.id === keyId)).toBe(true);

    // 3. Revoke key
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/v1/admin/keys/${keyId}`,
      headers: { authorization: `Bearer ${adminKey}` },
    });

    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json().success).toBe(true);
  });

  it('POST /v1/admin/purge-cache purges cached image variants', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/purge-cache',
      headers: { authorization: `Bearer ${adminKey}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.purgedCount).toBeTypeOf('number');
  });
});
