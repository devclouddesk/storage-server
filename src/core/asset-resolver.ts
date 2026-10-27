import type { IStorageDriver } from '../storage/storage.interface.js';
import type { StoredFileMeta } from '../types/index.js';

export interface ResolvedAsset {
  buffer: Buffer;
  meta: StoredFileMeta;
  storageKey: string;
}

const CANDIDATE_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.avif',
  '.gif',
  '.svg',
  '.pdf',
  '.mp4',
  '.webm',
  '.zip',
  '.txt',
  '.json',
];

/**
 * Robust DB-less asset locator that finds original files in local/S3 storage
 * even when the request specifies an extension different from the original,
 * or no extension at all.
 */
export async function resolveAsset(
  storage: IStorageDriver,
  cleanPublicId: string,
  basePublicId?: string
): Promise<ResolvedAsset | null> {
  // 1. Try exact storage key
  let asset = await storage.get(cleanPublicId);
  if (asset) {
    return { ...asset, storageKey: cleanPublicId };
  }

  // 2. Try base public ID without extension
  if (basePublicId && basePublicId !== cleanPublicId) {
    asset = await storage.get(basePublicId);
    if (asset) {
      return { ...asset, storageKey: basePublicId };
    }
  }

  // 3. Scan candidate extensions
  const searchTarget = basePublicId || cleanPublicId;
  for (const ext of CANDIDATE_EXTENSIONS) {
    const candidateKey = `${searchTarget}${ext}`;
    asset = await storage.get(candidateKey);
    if (asset) {
      return { ...asset, storageKey: candidateKey };
    }
  }

  return null;
}
