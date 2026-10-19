/**
 * Magic Bytes & File Type Sniffer
 * Detects binary file type from buffer headers and safely handles images and raw media/documents.
 */

export type FileCategory = 'image' | 'video' | 'audio' | 'document' | 'archive' | 'raw';

export interface DetectedType {
  mime: string;
  ext: string;
  category: FileCategory;
  isRasterImage: boolean; // Can be manipulated with Sharp (resize, webp etc.)
}

export function detectFileType(buffer: Buffer, originalFilename: string = '', fallbackMime: string = ''): DetectedType {
  const len = buffer.length;

  // 1. JPEG: FF D8 FF
  if (len >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg', category: 'image', isRasterImage: true };
  }

  // 2. PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    len >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mime: 'image/png', ext: 'png', category: 'image', isRasterImage: true };
  }

  // 3. GIF: 47 49 46 38 (GIF87a or GIF89a)
  if (len >= 4 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return { mime: 'image/gif', ext: 'gif', category: 'image', isRasterImage: true };
  }

  // 4. WEBP: RIFF .... WEBP
  if (
    len >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { mime: 'image/webp', ext: 'webp', category: 'image', isRasterImage: true };
  }

  // 5. AVIF / HEIC: ftypavif / ftypmif1
  if (
    len >= 12 &&
    buffer[4] === 0x66 &&
    buffer[5] === 0x74 &&
    buffer[6] === 0x79 &&
    buffer[7] === 0x70 &&
    ((buffer[8] === 0x61 && buffer[9] === 0x76 && buffer[10] === 0x69 && buffer[11] === 0x66) ||
      (buffer[8] === 0x6d && buffer[9] === 0x69 && buffer[10] === 0x66 && buffer[11] === 0x31))
  ) {
    return { mime: 'image/avif', ext: 'avif', category: 'image', isRasterImage: true };
  }

  // 6. TIFF: 49 49 2A 00 or 4D 4D 00 2A
  if (
    len >= 4 &&
    ((buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) ||
      (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a))
  ) {
    return { mime: 'image/tiff', ext: 'tiff', category: 'image', isRasterImage: true };
  }

  // 7. PDF: %PDF- (0x25 0x50 0x44 0x46 0x2D)
  if (
    len >= 5 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46 &&
    buffer[4] === 0x2d
  ) {
    return { mime: 'application/pdf', ext: 'pdf', category: 'document', isRasterImage: false };
  }

  // 8. MP4 / MOV: ftyp (bytes 4-7 = 0x66 0x74 0x79 0x70)
  if (len >= 8 && buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
    return { mime: 'video/mp4', ext: 'mp4', category: 'video', isRasterImage: false };
  }

  // 9. WebM / MKV: 1A 45 DF A3
  if (len >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return { mime: 'video/webm', ext: 'webm', category: 'video', isRasterImage: false };
  }

  // 10. MP3: ID3 (0x49 0x44 0x33) or 0xFF 0xFB
  if (
    (len >= 3 && buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) ||
    (len >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
  ) {
    return { mime: 'audio/mpeg', ext: 'mp3', category: 'audio', isRasterImage: false };
  }

  // 11. ZIP / Office Docx / Xlsx: PK 03 04 (0x50 0x4B 0x03 0x04)
  if (len >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    return { mime: 'application/zip', ext: 'zip', category: 'archive', isRasterImage: false };
  }

  // 12. SVG check: XML or <svg
  const headStr = buffer.slice(0, Math.min(len, 512)).toString('utf-8').trim().toLowerCase();
  if (headStr.includes('<svg') || (headStr.includes('<?xml') && headStr.includes('svg'))) {
    return { mime: 'image/svg+xml', ext: 'svg', category: 'image', isRasterImage: false };
  }

  // 13. Fallback based on filename extension
  const dotIdx = originalFilename.lastIndexOf('.');
  const ext = dotIdx !== -1 ? originalFilename.slice(dotIdx + 1).toLowerCase() : '';

  if (ext === 'json') return { mime: 'application/json', ext: 'json', category: 'document', isRasterImage: false };
  if (ext === 'csv') return { mime: 'text/csv', ext: 'csv', category: 'document', isRasterImage: false };
  if (ext === 'txt') return { mime: 'text/plain', ext: 'txt', category: 'document', isRasterImage: false };
  if (ext === 'pdf') return { mime: 'application/pdf', ext: 'pdf', category: 'document', isRasterImage: false };
  if (ext === 'mp4') return { mime: 'video/mp4', ext: 'mp4', category: 'video', isRasterImage: false };
  if (ext === 'zip') return { mime: 'application/zip', ext: 'zip', category: 'archive', isRasterImage: false };

  // Generic raw fallback
  const mime = fallbackMime && fallbackMime !== 'application/octet-stream' ? fallbackMime : 'application/octet-stream';
  return {
    mime,
    ext: ext || 'bin',
    category: 'raw',
    isRasterImage: false,
  };
}

/**
 * Legacy compatibility helper for existing image detection checks
 */
export function detectImageMagicBytes(buffer: Buffer): { mime: string; ext: string } | null {
  const result = detectFileType(buffer);
  if (result.isRasterImage) {
    return { mime: result.mime, ext: result.ext };
  }
  return null;
}
