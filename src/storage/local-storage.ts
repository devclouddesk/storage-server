import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../config/env.js';
import type { StoredFileMeta } from '../types/index.js';
import type { IStorageDriver } from './storage.interface.js';

export class LocalStorageDriver implements IStorageDriver {
  private baseDir: string;

  constructor(baseDir: string = paths.uploads) {
    this.baseDir = path.resolve(baseDir);
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /**
   * Sanitizes key to prevent path traversal attacks (../../etc/passwd)
   */
  private sanitizeKey(key: string): string {
    const normalized = path.normalize(key).replace(/^(\.\.[\/\\])+/, '');
    const clean = normalized.replace(/^[\/\\]+/, '');
    return clean;
  }

  /**
   * Generates a 2-level hashed directory path to avoid inode lookup degradation
   */
  private getHashedPath(cleanKey: string): { dir: string; fullPath: string } {
    const hash = crypto.createHash('md5').update(cleanKey).digest('hex');
    const p1 = hash.slice(0, 2);
    const p2 = hash.slice(2, 4);

    const dir = path.join(this.baseDir, p1, p2);
    const filename = `${hash}_${path.basename(cleanKey)}`;
    const fullPath = path.join(dir, filename);

    return { dir, fullPath };
  }

  async put(key: string, buffer: Buffer, mimeType: string): Promise<StoredFileMeta> {
    const cleanKey = this.sanitizeKey(key);
    const { dir, fullPath } = this.getHashedPath(cleanKey);

    await fs.promises.mkdir(dir, { recursive: true });

    // Edge Case: Atomic write via temporary file prevents corrupt partial writes
    const tempPath = `${fullPath}.tmp-${Date.now()}`;
    await fs.promises.writeFile(tempPath, buffer);
    await fs.promises.rename(tempPath, fullPath);

    const etag = crypto.createHash('md5').update(buffer).digest('hex');

    return {
      key: cleanKey,
      size: buffer.length,
      mimeType,
      etag,
      createdAt: Math.floor(Date.now() / 1000),
    };
  }

  async get(key: string): Promise<{ buffer: Buffer; meta: StoredFileMeta } | null> {
    const cleanKey = this.sanitizeKey(key);
    const { fullPath } = this.getHashedPath(cleanKey);

    if (!fs.existsSync(fullPath)) {
      return null;
    }

    const buffer = await fs.promises.readFile(fullPath);
    const stats = await fs.promises.stat(fullPath);
    const etag = crypto.createHash('md5').update(buffer).digest('hex');

    return {
      buffer,
      meta: {
        key: cleanKey,
        size: stats.size,
        mimeType: 'application/octet-stream', // Resolved by metadata database
        etag,
        createdAt: Math.floor(stats.birthtimeMs / 1000),
      },
    };
  }

  async has(key: string): Promise<boolean> {
    const cleanKey = this.sanitizeKey(key);
    const { fullPath } = this.getHashedPath(cleanKey);
    return fs.existsSync(fullPath);
  }

  async delete(key: string): Promise<boolean> {
    const cleanKey = this.sanitizeKey(key);
    const { fullPath } = this.getHashedPath(cleanKey);

    if (fs.existsSync(fullPath)) {
      await fs.promises.unlink(fullPath);
      return true;
    }
    return false;
  }

  async getStats(): Promise<{ totalBytes: number; fileCount: number }> {
    let totalBytes = 0;
    let fileCount = 0;

    const walk = async (currentDir: string) => {
      if (!fs.existsSync(currentDir)) return;
      const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const full = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile() && !entry.name.endsWith('.tmp')) {
          const s = await fs.promises.stat(full);
          totalBytes += s.size;
          fileCount += 1;
        }
      }
    };

    await walk(this.baseDir);
    return { totalBytes, fileCount };
  }
}
