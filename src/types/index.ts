export type SupportedFormat = 'auto' | 'webp' | 'avif' | 'jpeg' | 'png';
export type CropMode = 'fill' | 'fit' | 'crop' | 'scale';

export interface TransformationParams {
  width?: number;
  height?: number;
  cropMode?: CropMode;
  format?: SupportedFormat;
  quality?: number | 'auto';
  blur?: number;
  grayscale?: boolean;
  sharpen?: boolean;
  rotation?: number | 'auto';
}

export interface StoredFileMeta {
  key: string;            // e.g. "avatars/usr_8921.jpg"
  size: number;           // file size in bytes
  mimeType: string;       // e.g. "image/jpeg"
  etag: string;           // MD5 or content hash
  createdAt: number;      // unix timestamp in seconds
}

export interface MediaFileRecord {
  id: string;
  publicId: string;
  originalName: string;
  folder: string;
  mimeType: string;
  format: string;
  bytes: number;
  width?: number;
  height?: number;
  resourceType?: 'image' | 'raw' | 'video' | 'audio' | 'document' | 'archive';
  storageDriver: 'local' | 's3';
  etag: string;
  access?: 'public' | 'private';
  createdAt: number;
}

export type ApiKeyPermission = 'read' | 'write' | 'delete' | 'admin';

export interface ApiKeyRecord {
  id: string;
  keyHash: string;
  keyPrefix: string;
  name: string;
  permissions?: ApiKeyPermission[];
  type?: 'public' | 'secret';
  rateLimit: number;
  createdAt: number;
}

export interface StorageConfig {
  provider: 'local' | 's3';
  s3?: {
    endpoint?: string;
    region?: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle?: boolean;
  };
}

export interface ServerStats {
  filesCount: number;
  totalStorageBytes: number;
  cacheVariantsCount: number;
  cacheSizeBytes: number;
  uptimeSeconds: number;
  memoryUsageMb: number;
  storageDriver: 'local' | 's3';
}
