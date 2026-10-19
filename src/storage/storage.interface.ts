import type { StoredFileMeta } from '../types/index.js';

export interface IStorageDriver {
  /**
   * Uploads an asset buffer to permanent storage
   */
  put(key: string, buffer: Buffer, mimeType: string): Promise<StoredFileMeta>;

  /**
   * Retrieves original asset buffer
   */
  get(key: string): Promise<{ buffer: Buffer; meta: StoredFileMeta } | null>;

  /**
   * Checks whether an asset exists in storage
   */
  has(key: string): Promise<boolean>;

  /**
   * Deletes an asset permanently
   */
  delete(key: string): Promise<boolean>;

  /**
   * Gets total storage consumption and file count
   */
  getStats(): Promise<{ totalBytes: number; fileCount: number }>;
}
