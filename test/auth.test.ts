import { describe, expect, it } from 'vitest';
import { extractApiKey, requireApiKey } from '../src/middleware/auth.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

describe('extractApiKey (Multi-Header & Query Parameter Support)', () => {
  it('extracts API key from Authorization Bearer header', () => {
    const req = {
      headers: { authorization: 'Bearer dcd_key_live_bearer123' },
    } as unknown as FastifyRequest;

    expect(extractApiKey(req)).toBe('dcd_key_live_bearer123');
  });

  it('extracts API key from x-api-key header', () => {
    const req = {
      headers: { 'x-api-key': 'dcd_key_live_xkey456' },
    } as unknown as FastifyRequest;

    expect(extractApiKey(req)).toBe('dcd_key_live_xkey456');
  });

  it('extracts API key from x-admin-key header with highest priority', () => {
    const req = {
      headers: {
        'x-admin-key': 'admin_secret_key',
        authorization: 'Bearer lesser_key',
      },
    } as unknown as FastifyRequest;

    expect(extractApiKey(req)).toBe('admin_secret_key');
  });

  it('extracts signed upload token from x-upload-token header', () => {
    const req = {
      headers: { 'x-upload-token': 'dcd_sig_token_789' },
    } as unknown as FastifyRequest;

    expect(extractApiKey(req)).toBe('dcd_sig_token_789');
  });

  it('extracts API key from query parameter ?key=...', () => {
    const req = {
      headers: {},
      query: { key: 'dcd_key_live_query_param' },
    } as unknown as FastifyRequest;

    expect(extractApiKey(req)).toBe('dcd_key_live_query_param');
  });

  it('returns null when no key header or query param is provided', () => {
    const req = {
      headers: {},
      query: {},
    } as unknown as FastifyRequest;

    expect(extractApiKey(req)).toBeNull();
  });
});
