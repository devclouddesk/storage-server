import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { env, paths } from '../config/env.js';
import type { ApiKeyPermission, ApiKeyRecord } from '../types/index.js';

export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

class KeysStore {
  private filePath: string;
  private keysCache: ApiKeyRecord[] | null = null;
  private lastMtime: number = 0;

  constructor(filePath: string = path.join(paths.config, 'keys.json')) {
    this.filePath = filePath;
  }

  private ensureDir() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private readKeys(forceRefresh = false): ApiKeyRecord[] {
    this.ensureDir();
    if (!fs.existsSync(this.filePath)) {
      this.keysCache = [];
      this.lastMtime = 0;
      return this.keysCache;
    }

    try {
      const stat = fs.statSync(this.filePath);
      if (!forceRefresh && this.keysCache && stat.mtimeMs === this.lastMtime) {
        return this.keysCache;
      }

      const content = fs.readFileSync(this.filePath, 'utf-8');
      this.keysCache = JSON.parse(content);
      this.lastMtime = stat.mtimeMs;
      if (!Array.isArray(this.keysCache)) {
        this.keysCache = [];
      }
    } catch (err) {
      console.warn('[KeysStore] Failed to read keys.json, resetting to empty array:', err);
      this.keysCache = [];
    }

    return this.keysCache!;
  }

  private saveKeys(keys: ApiKeyRecord[]) {
    this.ensureDir();
    this.keysCache = keys;
    const tempFile = `${this.filePath}.tmp-${Date.now()}`;
    fs.writeFileSync(tempFile, JSON.stringify(keys, null, 2), 'utf-8');
    fs.renameSync(tempFile, this.filePath);
    try {
      this.lastMtime = fs.statSync(this.filePath).mtimeMs;
    } catch {}
  }

  /**
   * Ensures at least one default API key exists upon startup
   */
  ensureDefaultKeys(): { publicKey: string | null; secretKey: string | null } {
    const keys = this.readKeys();
    if (keys.length > 0) {
      return { publicKey: null, secretKey: null };
    }

    const { key } = this.createKey('Default Storage API Key', ['read', 'write', 'delete', 'admin'], 200);
    return { publicKey: key, secretKey: key };
  }

  /**
   * Creates a new API key with customizable permissions/roles
   */
  createKey(
    arg1: string | 'public' | 'secret',
    arg2?: string | ApiKeyPermission[],
    arg3: number = 120
  ): { key: string; record: ApiKeyRecord } {
    let name = 'API Key';
    let permissions: ApiKeyPermission[] = ['read', 'write', 'delete'];
    let type: 'public' | 'secret' = 'secret';
    let rateLimit = 120;

    if (arg1 === 'public' || arg1 === 'secret') {
      type = arg1;
      name = typeof arg2 === 'string' ? arg2 : 'API Key';
      permissions = type === 'public' ? ['read', 'write'] : ['read', 'write', 'delete', 'admin'];
      rateLimit = arg3 || 120;
    } else {
      name = String(arg1 || 'API Key');
      if (Array.isArray(arg2) && arg2.length > 0) {
        permissions = arg2;
      }
      type = permissions.includes('delete') || permissions.includes('admin') ? 'secret' : 'public';
      rateLimit = typeof arg3 === 'number' ? arg3 : 120;
    }

    const prefix = env.KEY_PREFIX || 'sk_live_';
    const rawRandom = nanoid(32);
    const key = `${prefix}${rawRandom}`;
    const keyHash = hashApiKey(key);
    const keyPrefix = key.slice(0, 16);

    const record: ApiKeyRecord = {
      id: nanoid(),
      keyHash,
      keyPrefix,
      name,
      permissions,
      type,
      rateLimit,
      createdAt: Math.floor(Date.now() / 1000),
    };

    const keys = this.readKeys();
    keys.unshift(record);
    this.saveKeys(keys);

    return { key, record };
  }

  /**
   * Imports or upserts an existing API key record (used for migration)
   */
  importKey(record: ApiKeyRecord): void {
    const keys = this.readKeys();
    const existingIndex = keys.findIndex((k) => k.id === record.id);
    if (existingIndex >= 0) {
      keys[existingIndex] = record;
    } else {
      keys.push(record);
    }
    this.saveKeys(keys);
  }

  /**
   * Verifies an API key by matching its SHA-256 hash
   */
  verifyApiKey(rawKey: string): ApiKeyRecord | null {
    if (!rawKey) return null;
    const cleanKey = rawKey.trim();
    const hash = hashApiKey(cleanKey);
    const keys = this.readKeys(true);

    // 1. Check exact hash
    const foundByHash = keys.find((k) => k.keyHash === hash);
    if (foundByHash) return foundByHash;

    return null;
  }

  /**
   * Lists all API keys with their permissions
   */
  listApiKeys(): Omit<ApiKeyRecord, 'keyHash'>[] {
    const keys = this.readKeys();
    return keys.map((k) => {
      const permissions: ApiKeyPermission[] =
        Array.isArray(k.permissions) && k.permissions.length > 0
          ? k.permissions
          : k.type === 'secret'
          ? ['read', 'write', 'delete', 'admin']
          : ['read', 'write'];

      return {
        id: k.id,
        keyPrefix: k.keyPrefix,
        name: k.name,
        permissions,
        type: k.type || (permissions.includes('delete') ? 'secret' : 'public'),
        rateLimit: k.rateLimit,
        createdAt: k.createdAt,
      };
    });
  }

  /**
   * Internal lookup to retrieve full key record by ID (including keyHash)
   */
  getKeyRecordById(id: string): ApiKeyRecord | null {
    const keys = this.readKeys();
    return keys.find((k) => k.id === id) || null;
  }

  /**
   * Revokes / deletes an API key by ID
   */
  deleteApiKey(id: string): boolean {
    const keys = this.readKeys();
    const index = keys.findIndex((k) => k.id === id);
    if (index === -1) return false;

    keys.splice(index, 1);
    this.saveKeys(keys);
    return true;
  }
}

export const keysStore = new KeysStore();
