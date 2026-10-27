import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('GET /health (System Health API)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 OK with server health, memory and uptime', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('healthy');
    expect(body.service).toBe('devclouddesk-media-server');
    expect(body.version).toBe('1.0.0');
    expect(body.uptime).toBeTypeOf('number');
    expect(body.storage).toBeDefined();
    expect(body.timestamp).toBeTypeOf('string');
  });
});
