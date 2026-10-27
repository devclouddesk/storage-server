import { describe, expect, it } from 'vitest';
import {
  getMimeFromExtension,
  getMimeFromPath,
  getResourceTypeFromMime,
  isImageMime,
  isRasterImageMime,
} from '../src/core/mime.js';

describe('MIME & Format Utilities', () => {
  it('maps file extensions to correct MIME types', () => {
    expect(getMimeFromExtension('jpg')).toBe('image/jpeg');
    expect(getMimeFromExtension('.jpeg')).toBe('image/jpeg');
    expect(getMimeFromExtension('png')).toBe('image/png');
    expect(getMimeFromExtension('webp')).toBe('image/webp');
    expect(getMimeFromExtension('avif')).toBe('image/avif');
    expect(getMimeFromExtension('svg')).toBe('image/svg+xml');
    expect(getMimeFromExtension('pdf')).toBe('application/pdf');
    expect(getMimeFromExtension('mp4')).toBe('video/mp4');
    expect(getMimeFromExtension('zip')).toBe('application/zip');
    expect(getMimeFromExtension('unknown_ext')).toBe('application/octet-stream');
  });

  it('resolves MIME type from full file paths', () => {
    expect(getMimeFromPath('/uploads/users/avatar.PNG')).toBe('image/png');
    expect(getMimeFromPath('documents/report_2026.pdf')).toBe('application/pdf');
    expect(getMimeFromPath('backup.tar.gz')).toBe('application/gzip');
    expect(getMimeFromPath('no_extension_file')).toBe('application/octet-stream');
  });

  it('accurately identifies image MIMEs vs raster images', () => {
    expect(isImageMime('image/jpeg')).toBe(true);
    expect(isImageMime('image/png')).toBe(true);
    expect(isImageMime('image/svg+xml')).toBe(true);
    expect(isImageMime('application/pdf')).toBe(false);

    // Raster vs Vector (Sharp can manipulate raster, but SVG is vector)
    expect(isRasterImageMime('image/jpeg')).toBe(true);
    expect(isRasterImageMime('image/webp')).toBe(true);
    expect(isRasterImageMime('image/svg+xml')).toBe(false);
  });

  it('classifies resource types accurately', () => {
    expect(getResourceTypeFromMime('image/jpeg')).toBe('image');
    expect(getResourceTypeFromMime('image/svg+xml')).toBe('raw');
    expect(getResourceTypeFromMime('video/mp4')).toBe('video');
    expect(getResourceTypeFromMime('audio/mpeg')).toBe('audio');
    expect(getResourceTypeFromMime('application/pdf')).toBe('document');
    expect(getResourceTypeFromMime('text/csv')).toBe('document');
    expect(getResourceTypeFromMime('application/zip')).toBe('archive');
    expect(getResourceTypeFromMime('application/octet-stream')).toBe('raw');
  });
});
