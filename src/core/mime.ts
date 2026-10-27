import path from 'node:path';

/**
 * Standardized MIME mapping for all supported media and document formats
 */
const EXTENSION_MIME_MAP: Record<string, string> = {
  // Images (Raster)
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  heic: 'image/heic',
  heif: 'image/heif',

  // Images (Vector)
  svg: 'image/svg+xml',

  // Documents
  pdf: 'application/pdf',
  json: 'application/json',
  txt: 'text/plain',
  csv: 'text/csv',
  xml: 'application/xml',
  html: 'text/html',
  md: 'text/markdown',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',

  // Audio & Video
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',

  // Archives
  zip: 'application/zip',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
};

/**
 * Returns the MIME type based on file path or filename extension
 */
export function getMimeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase().replace(/^\./, '');
  return EXTENSION_MIME_MAP[ext] || 'application/octet-stream';
}

/**
 * Returns the MIME type based on extension string (e.g. 'webp' or '.png')
 */
export function getMimeFromExtension(ext: string): string {
  const cleanExt = ext.toLowerCase().replace(/^\./, '');
  return EXTENSION_MIME_MAP[cleanExt] || 'application/octet-stream';
}

/**
 * Checks if a given MIME type is an image (including raster and vector)
 */
export function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

/**
 * Checks if a given MIME type is a raster image capable of Sharp image processing
 * (excludes SVG vectors)
 */
export function isRasterImageMime(mime: string): boolean {
  return isImageMime(mime) && mime !== 'image/svg+xml';
}

/**
 * Classifies resource type category for metadata indexing
 */
export function getResourceTypeFromMime(
  mime: string
): 'image' | 'raw' | 'video' | 'audio' | 'document' | 'archive' {
  if (isRasterImageMime(mime)) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (
    mime === 'application/pdf' ||
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime.includes('document') ||
    mime.includes('sheet')
  ) {
    return 'document';
  }
  if (
    mime === 'application/zip' ||
    mime === 'application/gzip' ||
    mime === 'application/x-tar' ||
    mime === 'application/x-7z-compressed'
  ) {
    return 'archive';
  }
  return 'raw';
}
