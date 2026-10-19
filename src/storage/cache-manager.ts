import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../config/env.js';

export class CacheManager {
  private cacheDir: string;

  constructor(cacheDir: string = paths.cache) {
    this.cacheDir = path.resolve(cacheDir);
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Generates a deterministic cache key / filename
   */
  getCacheKey(publicId: string, normalizedParams: string, format: string): string {
    const raw = `${publicId}_${normalizedParams}`;
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    return `${hash}.${format}`;
  }

  private getFilePath(filename: string): string {
    return path.join(this.cacheDir, filename);
  }

  /**
   * Retrieves a cached variant from disk if it exists
   */
  async get(cacheFilename: string): Promise<Buffer | null> {
    const fullPath = this.getFilePath(cacheFilename);
    if (!fs.existsSync(fullPath)) {
      return null;
    }

    try {
      // Touch file to update access time (mtime/atime) for LRU
      const now = new Date();
      await fs.promises.utimes(fullPath, now, now).catch(() => {});
      return await fs.promises.readFile(fullPath);
    } catch {
      return null;
    }
  }

  /**
   * Stores a transformed variant in disk cache atomically
   */
  async put(cacheFilename: string, buffer: Buffer): Promise<void> {
    const fullPath = this.getFilePath(cacheFilename);
    const tempPath = `${fullPath}.tmp-${Date.now()}`;

    try {
      await fs.promises.writeFile(tempPath, buffer);
      await fs.promises.rename(tempPath, fullPath);
    } catch (err) {
      // If disk is full, log error and skip cache write (image is still returned to user)
      console.warn(`[CacheManager] Failed to write cache file ${cacheFilename}:`, err);
      if (fs.existsSync(tempPath)) {
        await fs.promises.unlink(tempPath).catch(() => {});
      }
    }
  }

  /**
   * Purges oldest files in the cache to free targetBytes
   */
  async evictOldest(targetBytesToFree: number): Promise<number> {
    if (!fs.existsSync(this.cacheDir)) return 0;

    const entries = await fs.promises.readdir(this.cacheDir);
    const fileStats: Array<{ name: string; fullPath: string; mtime: number; size: number }> = [];

    for (const name of entries) {
      if (name.endsWith('.tmp')) {
        // Clean leftover tmp files immediately
        await fs.promises.unlink(path.join(this.cacheDir, name)).catch(() => {});
        continue;
      }
      const fullPath = path.join(this.cacheDir, name);
      try {
        const s = await fs.promises.stat(fullPath);
        if (s.isFile()) {
          fileStats.push({ name, fullPath, mtime: s.mtimeMs, size: s.size });
        }
      } catch {}
    }

    // Sort by oldest access / modification time first
    fileStats.sort((a, b) => a.mtime - b.mtime);

    let freedBytes = 0;
    for (const item of fileStats) {
      if (freedBytes >= targetBytesToFree) break;
      try {
        await fs.promises.unlink(item.fullPath);
        freedBytes += item.size;
      } catch {}
    }

    return freedBytes;
  }

  /**
   * Purges all cached variants
   */
  async purgeAll(): Promise<number> {
    if (!fs.existsSync(this.cacheDir)) return 0;
    const entries = await fs.promises.readdir(this.cacheDir);
    let count = 0;

    for (const name of entries) {
      const fullPath = path.join(this.cacheDir, name);
      try {
        await fs.promises.unlink(fullPath);
        count++;
      } catch {}
    }
    return count;
  }

  /**
   * Returns cache stats (total size in bytes and variants count)
   */
  async getStats(): Promise<{ totalBytes: number; variantsCount: number }> {
    if (!fs.existsSync(this.cacheDir)) return { totalBytes: 0, variantsCount: 0 };
    const entries = await fs.promises.readdir(this.cacheDir);
    let totalBytes = 0;
    let variantsCount = 0;

    for (const name of entries) {
      if (name.startsWith('.')) continue;
      const fullPath = path.join(this.cacheDir, name);
      try {
        const s = await fs.promises.stat(fullPath);
        if (s.isFile()) {
          totalBytes += s.size;
          variantsCount++;
        }
      } catch {}
    }
    return { totalBytes, variantsCount };
  }
}

export const cacheManager = new CacheManager();
