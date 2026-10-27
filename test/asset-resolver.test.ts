import { describe, expect, it } from 'vitest';
import { resolveAsset } from '../src/core/asset-resolver.js';
import type { IStorageDriver } from '../src/storage/storage.interface.js';
import type { StoredFileMeta } from '../src/types/index.js';

describe('resolveAsset (DB-Less Multi-Extension Asset Locator)', () => {
  const dummyMeta: StoredFileMeta = {
    key: 'photos/sample.jpg',
    size: 1024,
    mimeType: 'image/jpeg',
    etag: 'mock_etag',
    createdAt: 1761500000,
  };

  const createMockStorage = (existingKeys: Record<string, Buffer>): IStorageDriver => ({
    put: async () => dummyMeta,
    get: async (key: string) => {
      if (existingKeys[key]) {
        return { buffer: existingKeys[key], meta: { ...dummyMeta, key } };
      }
      return null;
    },
    has: async (key: string) => Boolean(existingKeys[key]),
    delete: async () => true,
    getStats: async () => ({
      totalBytes: Object.values(existingKeys).reduce((acc, b) => acc + b.length, 0),
      fileCount: Object.keys(existingKeys).length,
    }),
  });

  it('finds asset by exact key match', async () => {
    const storage = createMockStorage({
      'avatars/user.webp': Buffer.from('webp_content'),
    });

    const result = await resolveAsset(storage, 'avatars/user.webp');
    expect(result).not.toBeNull();
    expect(result?.storageKey).toBe('avatars/user.webp');
    expect(result?.buffer.toString()).toBe('webp_content');
  });

  it('finds asset by base public ID when requested without extension', async () => {
    const storage = createMockStorage({
      'avatars/user': Buffer.from('exact_base_content'),
    });

    const result = await resolveAsset(storage, 'avatars/user.jpg', 'avatars/user');
    expect(result).not.toBeNull();
    expect(result?.storageKey).toBe('avatars/user');
    expect(result?.buffer.toString()).toBe('exact_base_content');
  });

  it('finds asset via candidate extension fallback when requested format differs from storage', async () => {
    // Original uploaded as .jpg, but user requested .webp in URL
    const storage = createMockStorage({
      'products/hero.jpg': Buffer.from('jpeg_original_bytes'),
    });

    const result = await resolveAsset(storage, 'products/hero.webp', 'products/hero');
    expect(result).not.toBeNull();
    expect(result?.storageKey).toBe('products/hero.jpg');
    expect(result?.buffer.toString()).toBe('jpeg_original_bytes');
  });

  it('returns null when asset does not exist in storage', async () => {
    const storage = createMockStorage({});
    const result = await resolveAsset(storage, 'non_existent.png', 'non_existent');
    expect(result).toBeNull();
  });
});
