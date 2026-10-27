import path from 'node:path';
import type { MediaFileRecord } from '../types/index.js';

export interface FormattedAssetResponse {
  asset_id: string;
  public_id: string;
  version: number;
  version_id: string;
  signature: string;
  width?: number;
  height?: number;
  format: string;
  resource_type: string;
  created_at: string;
  bytes: number;
  type: string;
  url: string;
  secure_url: string;
  original_filename: string;
  display_name: string;
  folder: string;
  access: 'public' | 'private';
  etag: string;
  storageDriver: 'local' | 's3';

  // Backward-compatible camelCase aliases for TypeScript / JavaScript SDK clients
  publicId: string;
  resourceType?: string;
  secureUrl: string;
  rawUrl: string;
  createdAt: number;
}

/**
 * Standardizes asset JSON representations across Upload, Admin API, and Webhooks
 * Following Cloudinary convention with full backward compatibility.
 */
export function formatAssetResponse(
  record: MediaFileRecord,
  baseUrl: string
): FormattedAssetResponse {
  const isRaw = record.resourceType === 'raw' || record.resourceType === 'document' || record.resourceType === 'archive';
  const cleanBase = baseUrl.replace(/\/+$/, '');

  const assetUrl = isRaw
    ? `${cleanBase}/raw/upload/${record.publicId}.${record.format}`
    : `${cleanBase}/image/upload/${record.publicId}.${record.format}`;

  const rawUrl = `${cleanBase}/raw/upload/${record.publicId}.${record.format}`;

  const origParsed = path.parse(record.originalName || 'file');
  const folderPath = record.folder === '/' ? '' : record.folder;
  const createdAtIso = new Date(record.createdAt * 1000).toISOString();

  return {
    asset_id: record.id,
    public_id: record.publicId,
    version: record.createdAt,
    version_id: `v${record.createdAt}`,
    signature: record.etag,
    width: record.width,
    height: record.height,
    format: record.format,
    resource_type: isRaw ? 'raw' : (record.resourceType || 'image'),
    created_at: createdAtIso,
    bytes: record.bytes,
    type: 'upload',
    url: assetUrl,
    secure_url: assetUrl,
    original_filename: origParsed.name,
    display_name: record.originalName,
    folder: folderPath,
    access: record.access || 'public',
    etag: record.etag,
    storageDriver: record.storageDriver,

    // CamelCase aliases
    publicId: record.publicId,
    resourceType: record.resourceType,
    secureUrl: assetUrl,
    rawUrl,
    createdAt: record.createdAt,
  };
}
