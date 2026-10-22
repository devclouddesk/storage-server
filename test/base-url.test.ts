import { describe, expect, it } from 'vitest';
import { getRequestBaseUrl } from '../src/core/base-url.js';
import type { FastifyRequest } from 'fastify';

describe('getRequestBaseUrl (RFC Reverse Proxy Resolution)', () => {
  it('resolves direct VPS IP and port access', () => {
    const req = {
      protocol: 'http',
      headers: { host: '142.93.100.45:7100' },
      hostname: '142.93.100.45',
    } as unknown as FastifyRequest;

    expect(getRequestBaseUrl(req)).toBe('http://142.93.100.45:7100');
  });

  it('resolves localhost development access', () => {
    const req = {
      protocol: 'http',
      headers: { host: 'localhost:7100' },
      hostname: 'localhost',
    } as unknown as FastifyRequest;

    expect(getRequestBaseUrl(req)).toBe('http://localhost:7100');
  });

  it('resolves HTTPS custom domain through Nginx reverse proxy', () => {
    const req = {
      protocol: 'http', // Internal Fastify sees HTTP
      headers: {
        host: 'cdn.mycompany.com',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'cdn.mycompany.com',
      },
      hostname: 'cdn.mycompany.com',
    } as unknown as FastifyRequest;

    expect(getRequestBaseUrl(req)).toBe('https://cdn.mycompany.com');
  });

  it('handles multi-hop proxy comma-separated headers', () => {
    const req = {
      protocol: 'http',
      headers: {
        host: 'internal-node',
        'x-forwarded-proto': 'https, http',
        'x-forwarded-host': 'assets.mysaas.io, edge-cdn',
      },
      hostname: 'internal-node',
    } as unknown as FastifyRequest;

    expect(getRequestBaseUrl(req)).toBe('https://assets.mysaas.io');
  });
});
