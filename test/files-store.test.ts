import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { filesStore } from '../src/core/files-store.js';
import type { MediaFileRecord } from '../src/types/index.js';

describe('filesStore (Metadata Storage, Indexing & Retrieval)', () => {
  let tempUploadsDir: string;
  let originalBaseDir: string;

  beforeEach(() => {
    tempUploadsDir = path.join(os.tmpdir(), `uploads-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tempUploadsDir, { recursive: true });
    originalBaseDir = (filesStore as any).baseDir;
    (filesStore as any).baseDir = tempUploadsDir;
  });

  afterEach(() => {
    (filesStore as any).baseDir = originalBaseDir;
    if (fs.existsSync(tempUploadsDir)) {
      fs.rmSync(tempUploadsDir, { recursive: true, force: true });
    }
  });

  it('saves and retrieves file metadata by storage key', async () => {
    const record: MediaFileRecord = {
      id: 'rec_101',
      publicId: 'gallery/beach',
      originalName: 'beach_photo.jpg',
      folder: 'gallery',
      mimeType: 'image/jpeg',
      format: 'jpg',
      bytes: 120000,
      width: 1920,
      height: 1080,
      resourceType: 'image',
      storageDriver: 'local',
      etag: 'etag_101',
      access: 'public',
      createdAt: 1761500000,
    };

    await filesStore.saveFileMeta('gallery/beach.jpg', record);

    const retrieved = await filesStore.getFileMeta('gallery/beach.jpg');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe('rec_101');
    expect(retrieved?.publicId).toBe('gallery/beach');
    expect(retrieved?.bytes).toBe(120000);
  });

  it('finds file by publicId regardless of extension in query', async () => {
    const record: MediaFileRecord = {
      id: 'rec_102',
      publicId: 'products/watch',
      originalName: 'rolex.png',
      folder: 'products',
      mimeType: 'image/png',
      format: 'png',
      bytes: 50000,
      resourceType: 'image',
      storageDriver: 'local',
      etag: 'etag_102',
      access: 'public',
      createdAt: 1761510000,
    };

    await filesStore.saveFileMeta('products/watch.png', record);

    // Lookup with just publicId
    const found1 = await filesStore.findByPublicId('products/watch');
    expect(found1).not.toBeNull();
    expect(found1?.id).toBe('rec_102');

    // Lookup with extension
    const found2 = await filesStore.findByPublicId('products/watch.png');
    expect(found2).not.toBeNull();
    expect(found2?.id).toBe('rec_102');
  });

  it('updates metadata fields while preserving core identifiers', async () => {
    const record: MediaFileRecord = {
      id: 'rec_103',
      publicId: 'docs/confidential',
      originalName: 'secret.pdf',
      folder: 'docs',
      mimeType: 'application/pdf',
      format: 'pdf',
      bytes: 80000,
      resourceType: 'raw',
      storageDriver: 'local',
      etag: 'etag_103',
      access: 'public',
      createdAt: 1761520000,
    };

    await filesStore.saveFileMeta('docs/confidential.pdf', record);

    // Update to private
    const updated = await filesStore.updateFileMeta('docs/confidential', { access: 'private' });
    expect(updated).not.toBeNull();
    expect(updated?.access).toBe('private');
    expect(updated?.id).toBe('rec_103'); // Identity preserved

    const verified = await filesStore.findByPublicId('docs/confidential');
    expect(verified?.access).toBe('private');
  });

  it('lists files with pagination and folder filtering', async () => {
    const file1: MediaFileRecord = {
      id: 'f1',
      publicId: 'avatars/alice',
      originalName: 'alice.jpg',
      folder: 'avatars',
      mimeType: 'image/jpeg',
      format: 'jpg',
      bytes: 1000,
      resourceType: 'image',
      storageDriver: 'local',
      etag: 'e1',
      createdAt: 1761500001,
    };

    const file2: MediaFileRecord = {
      id: 'f2',
      publicId: 'avatars/bob',
      originalName: 'bob.jpg',
      folder: 'avatars',
      mimeType: 'image/jpeg',
      format: 'jpg',
      bytes: 2000,
      resourceType: 'image',
      storageDriver: 'local',
      etag: 'e2',
      createdAt: 1761500002,
    };

    const file3: MediaFileRecord = {
      id: 'f3',
      publicId: 'banners/hero',
      originalName: 'hero.png',
      folder: 'banners',
      mimeType: 'image/png',
      format: 'png',
      bytes: 5000,
      resourceType: 'image',
      storageDriver: 'local',
      etag: 'e3',
      createdAt: 1761500003,
    };

    await filesStore.saveFileMeta('avatars/alice.jpg', file1);
    await filesStore.saveFileMeta('avatars/bob.jpg', file2);
    await filesStore.saveFileMeta('banners/hero.png', file3);

    // List all
    const all = await filesStore.listMediaFiles(10, 0);
    expect(all.total).toBe(3);

    // Filter by folder 'avatars'
    const avatarsOnly = await filesStore.listMediaFiles(10, 0, 'avatars');
    expect(avatarsOnly.total).toBe(2);
    expect(avatarsOnly.files.map((f) => f.publicId)).toContain('avatars/alice');
    expect(avatarsOnly.files.map((f) => f.publicId)).toContain('avatars/bob');
  });
});
