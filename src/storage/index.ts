import fs from 'node:fs';
import { paths } from '../config/env.js';
import type { StorageConfig } from '../types/index.js';
import { LocalStorageDriver } from './local-storage.js';
import { S3StorageDriver } from './s3-storage.js';
import type { IStorageDriver } from './storage.interface.js';

let activeDriver: IStorageDriver | null = null;
let currentConfig: StorageConfig = { provider: 'local' };

export function loadStorageConfig(): StorageConfig {
  if (fs.existsSync(paths.configFile)) {
    try {
      const raw = fs.readFileSync(paths.configFile, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed.storage) {
        currentConfig = parsed.storage;
      }
    } catch (err) {
      console.warn('[Storage] Failed to read config file, falling back to local storage:', err);
    }
  }
  return currentConfig;
}

export function saveStorageConfig(config: StorageConfig): void {
  if (!fs.existsSync(paths.config)) {
    fs.mkdirSync(paths.config, { recursive: true });
  }

  const payload = { storage: config, updatedAt: new Date().toISOString() };
  fs.writeFileSync(paths.configFile, JSON.stringify(payload, null, 2), 'utf-8');
  currentConfig = config;
  activeDriver = null; // Re-initialize on next get
}

export function getStorageDriver(): IStorageDriver {
  if (activeDriver) return activeDriver;

  const config = loadStorageConfig();

  if (config.provider === 's3' && config.s3) {
    console.log(`[Storage] Initializing S3/R2 storage driver for bucket: ${config.s3.bucket}`);
    activeDriver = new S3StorageDriver(config.s3);
  } else {
    console.log('[Storage] Initializing Local NVMe/SSD storage driver');
    activeDriver = new LocalStorageDriver();
  }

  return activeDriver;
}

export function getStorageProviderName(): 'local' | 's3' {
  return currentConfig.provider;
}
