import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../config/env.js';
import { getStorageDriver } from '../storage/index.js';
import type { MediaFileRecord } from '../types/index.js';

class FilesStore {
  private baseDir: string;

  constructor(baseDir: string = paths.uploads) {
    this.baseDir = path.resolve(baseDir);
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private sanitizeKey(key: string): string {
    const normalized = path.normalize(key).replace(/^(\.\.[\/\\])+/, '');
    return normalized.replace(/^[\/\\]+/, '').replace(/\\/g, '/');
  }

  private getMetaPath(cleanKey: string): string {
    const hash = crypto.createHash('md5').update(cleanKey).digest('hex');
    const p1 = hash.slice(0, 2);
    const p2 = hash.slice(2, 4);
    const dir = path.join(this.baseDir, p1, p2);
    const filename = `${hash}_${path.basename(cleanKey)}.meta.json`;
    return path.join(dir, filename);
  }

  /**
   * Persists file metadata alongside the physical asset
   */
  async saveFileMeta(storageKey: string, record: MediaFileRecord): Promise<void> {
    const cleanKey = this.sanitizeKey(storageKey);
    const metaPath = this.getMetaPath(cleanKey);
    const dir = path.dirname(metaPath);

    await fs.promises.mkdir(dir, { recursive: true });
    const tempPath = `${metaPath}.tmp-${Date.now()}`;
    await fs.promises.writeFile(tempPath, JSON.stringify(record, null, 2), 'utf-8');
    await fs.promises.rename(tempPath, metaPath);
  }

  /**
   * Retrieves file metadata for a specific storageKey
   */
  async getFileMeta(storageKey: string): Promise<MediaFileRecord | null> {
    const cleanKey = this.sanitizeKey(storageKey);
    const metaPath = this.getMetaPath(cleanKey);
    if (!fs.existsSync(metaPath)) {
      return null;
    }
    try {
      const raw = await fs.promises.readFile(metaPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /**
   * Fast O(1) lookup to find existing file record by publicId across supported extensions
   */
  async findByPublicId(publicId: string): Promise<MediaFileRecord | null> {
    const cleanPublicId = this.sanitizeKey(publicId);
    const extensions = [
      '.jpeg', '.jpg', '.png', '.webp', '.avif', '.gif', '.tiff', '.svg',
      '.pdf', '.mp4', '.webm', '.mp3', '.zip', '.json', '.csv', '.txt', ''
    ];
    for (const ext of extensions) {
      const candidateKey = `${cleanPublicId}${ext}`;
      const meta = await this.getFileMeta(candidateKey);
      if (meta) return meta;
    }
    return null;
  }

  /**
   * Scans uploads directory for metadata and returns paginated file list
   */
  async listMediaFiles(
    limit = 50,
    offset = 0,
    folder?: string
  ): Promise<{ files: MediaFileRecord[]; total: number }> {
    const records: MediaFileRecord[] = [];

    let normFilter: string | undefined = undefined;
    if (folder !== undefined && folder !== 'all' && folder !== '*') {
      normFilter = folder === 'root' ? '' : folder.replace(/^[\/\\]+|[\/\\]+$/g, '').replace(/\\/g, '/');
    }

    const walk = async (currentDir: string) => {
      if (!fs.existsSync(currentDir)) return;
      let entries: fs.Dirent[] = [];
      try {
        entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const full = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile() && entry.name.endsWith('.meta.json')) {
          try {
            const raw = await fs.promises.readFile(full, 'utf-8');
            const data: MediaFileRecord = JSON.parse(raw);
            const itemNorm = (data.folder || '').replace(/^[\/\\]+|[\/\\]+$/g, '').replace(/\\/g, '/');
            const isMatch = normFilter === undefined ? true : itemNorm === normFilter;
            if (isMatch) {
              records.push(data);
            }
          } catch {
            // Ignore unreadable or corrupted single meta file
          }
        }
      }
    };

    await walk(this.baseDir);

    // Sort newest first
    records.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    const total = records.length;
    const paged = records.slice(offset, offset + limit);

    return { files: paged, total };
  }

  /**
   * Calculates overall storage statistics (total file count & bytes)
   */
  async getMediaStats(): Promise<{ totalFiles: number; totalBytes: number }> {
    let totalFiles = 0;
    let totalBytes = 0;

    const walk = async (currentDir: string) => {
      if (!fs.existsSync(currentDir)) return;
      let entries: fs.Dirent[] = [];
      try {
        entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const full = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile() && entry.name.endsWith('.meta.json')) {
          try {
            const raw = await fs.promises.readFile(full, 'utf-8');
            const data: MediaFileRecord = JSON.parse(raw);
            totalFiles += 1;
            totalBytes += data.bytes || 0;
          } catch {}
        }
      }
    };

    await walk(this.baseDir);
    return { totalFiles, totalBytes };
  }

  /**
   * Deletes physical storage file and its corresponding metadata across all supported extensions
   */
  async deleteMediaFile(rawPublicId: string): Promise<boolean> {
    const cleanPublicId = this.sanitizeKey(rawPublicId);
    const storage = getStorageDriver();
    let deleted = false;

    // 1. Try finding by publicId first (fast deterministic metadata check)
    const record = await this.findByPublicId(cleanPublicId);
    if (record) {
      const storageKey = `${record.publicId}.${record.format}`;
      const d1 = await storage.delete(storageKey);
      const d2 = await storage.delete(record.publicId);

      const metaPath1 = this.getMetaPath(storageKey);
      if (fs.existsSync(metaPath1)) {
        await fs.promises.unlink(metaPath1).catch(() => {});
        deleted = true;
      }

      const metaPath2 = this.getMetaPath(record.publicId);
      if (fs.existsSync(metaPath2)) {
        await fs.promises.unlink(metaPath2).catch(() => {});
        deleted = true;
      }

      if (d1 || d2) deleted = true;
    }

    // 2. Try deleting candidate keys with all supported extensions
    const extensions = [
      '', '.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.tiff', '.svg',
      '.pdf', '.mp4', '.webm', '.mp3', '.zip', '.json', '.csv', '.txt'
    ];
    for (const ext of extensions) {
      const candidateKey = `${cleanPublicId}${ext}`;
      const metaPath = this.getMetaPath(candidateKey);
      if (fs.existsSync(metaPath)) {
        await fs.promises.unlink(metaPath).catch(() => {});
        deleted = true;
      }
      const hasFile = await storage.has(candidateKey);
      if (hasFile) {
        await storage.delete(candidateKey);
        deleted = true;
      }
    }

    // 3. Resilient fallback walk: Match by id, publicId, filename, or originalName
    const walk = async (currentDir: string) => {
      if (!fs.existsSync(currentDir)) return;
      let entries: fs.Dirent[] = [];
      try {
        entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const full = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile() && entry.name.endsWith('.meta.json')) {
          try {
            const raw = await fs.promises.readFile(full, 'utf-8');
            const data: MediaFileRecord = JSON.parse(raw);
            if (
              data.id === cleanPublicId ||
              data.publicId === cleanPublicId ||
              path.basename(data.publicId) === cleanPublicId ||
              data.originalName === cleanPublicId ||
              `${data.publicId}.${data.format}` === cleanPublicId
            ) {
              await fs.promises.unlink(full).catch(() => {});
              const physicalPath = full.slice(0, -'.meta.json'.length);
              if (fs.existsSync(physicalPath)) {
                await fs.promises.unlink(physicalPath).catch(() => {});
              }
              deleted = true;
            }
          } catch {}
        }
      }
    };

    await walk(this.baseDir);
    return deleted;
  }
}

export const filesStore = new FilesStore();
