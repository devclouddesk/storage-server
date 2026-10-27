import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashApiKey, keysStore } from '../src/core/keys-store.js';

describe('keysStore (API Key Storage, Hashing & Verification)', () => {
  let tempKeysPath: string;
  let originalFilePath: string;

  beforeEach(() => {
    tempKeysPath = path.join(os.tmpdir(), `keys-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    // Access private property to redirect to temp file for testing
    originalFilePath = (keysStore as any).filePath;
    (keysStore as any).filePath = tempKeysPath;
    (keysStore as any).keysCache = null;
  });

  afterEach(() => {
    (keysStore as any).filePath = originalFilePath;
    (keysStore as any).keysCache = null;
    if (fs.existsSync(tempKeysPath)) {
      fs.unlinkSync(tempKeysPath);
    }
  });

  it('generates a consistent sha256 hash for any key', () => {
    const key = 'dcd_key_live_test123';
    const hash1 = hashApiKey(key);
    const hash2 = hashApiKey(key);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 is 64 hex chars
  });

  it('creates an API key, saves it to disk, and verifies it successfully', () => {
    const { key, record } = keysStore.createKey('Test Microservice', ['read', 'write'], 200);

    expect(key).toMatch(/^dcd_key_live_/);
    expect(record.name).toBe('Test Microservice');
    expect(record.permissions).toEqual(['read', 'write']);
    expect(record.rateLimit).toBe(200);

    // Verification with raw key
    const verified = keysStore.verifyApiKey(key);
    expect(verified).not.toBeNull();
    expect(verified?.id).toBe(record.id);
    expect(verified?.name).toBe('Test Microservice');
    expect(verified?.permissions).toEqual(['read', 'write']);
  });

  it('rejects verification for an invalid or non-existent key', () => {
    keysStore.createKey('Valid Key', ['read'], 100);

    const verified = keysStore.verifyApiKey('dcd_key_live_fake_key_999');
    expect(verified).toBeNull();
  });

  it('lists created keys without revealing the full secret key', () => {
    keysStore.createKey('Key 1', ['read'], 60);
    keysStore.createKey('Key 2', ['write'], 120);

    const list = keysStore.listApiKeys();
    expect(list.length).toBe(2);
    expect(list[0].keyPrefix).toBeDefined();
    expect((list[0] as any).key).toBeUndefined(); // raw key must never be exposed
  });

  it('deletes/revokes an API key', () => {
    const { key, record } = keysStore.createKey('To Be Revoked', ['admin'], 100);
    expect(keysStore.verifyApiKey(key)).not.toBeNull();

    const deleted = keysStore.deleteApiKey(record.id);
    expect(deleted).toBe(true);

    // After revocation, key is no longer valid
    expect(keysStore.verifyApiKey(key)).toBeNull();
  });
});
