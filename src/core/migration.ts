import fs from 'node:fs';
import { paths } from '../config/env.js';
import { filesStore } from './files-store.js';
import { keysStore } from './keys-store.js';

/**
 * One-time seamless migration from legacy SQLite database to 100% DB-less architecture
 */
export async function runLegacyDbMigration(): Promise<void> {
  if (!fs.existsSync(paths.databaseFile)) {
    return;
  }

  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(paths.databaseFile);

    // 1. Migrate API Keys to keys.json
    try {
      const keys = db.prepare('SELECT * FROM api_keys').all() as any[];
      if (Array.isArray(keys) && keys.length > 0) {
        for (const k of keys) {
          const existing = keysStore.listApiKeys().find((existingK) => existingK.id === k.id);
          if (!existing) {
            keysStore.importKey({
              id: k.id,
              keyHash: k.key_hash,
              keyPrefix: k.key_prefix,
              type: k.type,
              name: k.name,
              rateLimit: k.rate_limit || 120,
              createdAt: k.created_at || Math.floor(Date.now() / 1000),
            });
          }
        }
        console.log(`[Migration] Migrated ${keys.length} API keys to DB-less keys.json`);
      }
    } catch {}

    // 2. Migrate Media Files metadata to sidecar .meta.json files
    try {
      const files = db.prepare('SELECT * FROM media_files').all() as any[];
      if (Array.isArray(files) && files.length > 0) {
        for (const f of files) {
          const storageKey = `${f.public_id}.${f.format}`;
          await filesStore.saveFileMeta(storageKey, {
            id: f.id,
            publicId: f.public_id,
            originalName: f.original_name,
            folder: f.folder,
            mimeType: f.mime_type,
            format: f.format,
            bytes: f.bytes,
            width: f.width,
            height: f.height,
            storageDriver: f.storage_driver || 'local',
            etag: f.etag,
            createdAt: f.created_at,
          });
        }
        console.log(`[Migration] Migrated ${files.length} file metadata records to DB-less format`);
      }
    } catch {}

    db.close();

    // Rename legacy database so migration doesn't run again
    const backupName = `${paths.databaseFile}.migrated-${Date.now()}`;
    fs.renameSync(paths.databaseFile, backupName);
    console.log('[Migration] Database migration complete. Legacy media.db archived.');
  } catch (err: any) {
    console.warn('[Migration] Note on legacy database check:', err.message);
  }
}
