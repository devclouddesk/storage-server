import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CacheManager } from '../src/storage/cache-manager.js';

describe('CacheManager (Deterministic Variant Caching & Atomic Writes)', () => {
  let tempCacheDir: string;
  let manager: CacheManager;

  beforeEach(() => {
    tempCacheDir = path.join(os.tmpdir(), `cache-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    manager = new CacheManager(tempCacheDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempCacheDir)) {
      fs.rmSync(tempCacheDir, { recursive: true, force: true });
    }
  });

  it('generates deterministic cache keys for given params and format', () => {
    const key1 = manager.getCacheKey('users/avatar', 'w:300_h:300_c:fill', 'webp');
    const key2 = manager.getCacheKey('users/avatar', 'w:300_h:300_c:fill', 'webp');
    const key3 = manager.getCacheKey('users/avatar', 'w:400_h:400_c:fill', 'webp');

    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3);
    expect(key1).toMatch(/\.webp$/);
  });

  it('writes variant to cache and retrieves it successfully (Cache HIT)', async () => {
    const cacheKey = manager.getCacheKey('product/laptop', 'w:800', 'jpeg');
    const data = Buffer.from('transformed_laptop_bytes');

    // Initially miss
    const initialGet = await manager.get(cacheKey);
    expect(initialGet).toBeNull();

    // Store in cache
    await manager.put(cacheKey, data);

    // Now HIT
    const cached = await manager.get(cacheKey);
    expect(cached).not.toBeNull();
    expect(cached?.toString()).toBe('transformed_laptop_bytes');
  });

  it('purges all cache entries cleanly', async () => {
    await manager.put('file1.webp', Buffer.from('data1'));
    await manager.put('file2.webp', Buffer.from('data2'));

    const statsBefore = await manager.getStats();
    expect(statsBefore.variantsCount).toBe(2);

    const purged = await manager.purgeAll();
    expect(purged).toBe(2);

    const statsAfter = await manager.getStats();
    expect(statsAfter.variantsCount).toBe(0);
  });
});
