import fs from 'node:fs';
import { env, paths } from '../config/env.js';
import { cacheManager } from './cache-manager.js';

export class DiskGuard {
  private timer: NodeJS.Timeout | null = null;

  startMonitoring(intervalMs = 60_000) {
    if (this.timer) return;
    this.timer = setInterval(() => this.checkAndEvict(), intervalMs);
    // Don't keep the Node.js event loop alive solely for disk guard
    this.timer.unref();
  }

  stopMonitoring() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async checkAndEvict(): Promise<void> {
    try {
      // Use fs.statfs if available (Node 19.6+)
      if (typeof fs.statfs === 'function') {
        const stats = await fs.promises.statfs(paths.data);
        const freeBytes = stats.bavail * stats.bsize;
        const totalBytes = stats.blocks * stats.bsize;
        const freePercent = (freeBytes / totalBytes) * 100;

        if (freePercent < env.DISK_FREE_THRESHOLD_PERCENT) {
          console.warn(
            `[DiskGuard] Free disk space is low (${freePercent.toFixed(1)}%). Triggering LRU cache eviction...`
          );
          // Free 1GB or 20% of cache size
          const bytesToFree = 1024 * 1024 * 1024;
          const freed = await cacheManager.evictOldest(bytesToFree);
          console.log(`[DiskGuard] Evicted ${(freed / (1024 * 1024)).toFixed(1)}MB of cached variants.`);
        }
      }
    } catch (err) {
      // Non-fatal, just log
      console.warn('[DiskGuard] Disk check skipped:', err);
    }
  }
}

export const diskGuard = new DiskGuard();
