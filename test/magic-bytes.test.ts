import { describe, expect, it } from 'vitest';
import { detectFileType } from '../src/core/magic-bytes.js';

describe('detectFileType', () => {
  it('detects JPEG from magic bytes', () => {
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const detected = detectFileType(buffer, 'photo.jpg');
    expect(detected.mime).toBe('image/jpeg');
    expect(detected.ext).toBe('jpg');
    expect(detected.category).toBe('image');
    expect(detected.isRasterImage).toBe(true);
  });

  it('detects PNG from magic bytes', () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const detected = detectFileType(buffer, 'icon.png');
    expect(detected.mime).toBe('image/png');
    expect(detected.ext).toBe('png');
    expect(detected.category).toBe('image');
    expect(detected.isRasterImage).toBe(true);
  });

  it('detects WEBP from magic bytes', () => {
    const buffer = Buffer.from([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x00, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50, // WEBP
    ]);
    const detected = detectFileType(buffer);
    expect(detected.mime).toBe('image/webp');
    expect(detected.ext).toBe('webp');
    expect(detected.category).toBe('image');
    expect(detected.isRasterImage).toBe(true);
  });

  it('detects PDF document from magic bytes', () => {
    const buffer = Buffer.from('%PDF-1.4 sample content');
    const detected = detectFileType(buffer, 'document.pdf');
    expect(detected.mime).toBe('application/pdf');
    expect(detected.category).toBe('document');
    expect(detected.isRasterImage).toBe(false);
  });

  it('falls back to filename extension for text or json', () => {
    const buffer = Buffer.from('{"hello":"world"}');
    const detected = detectFileType(buffer, 'data.json');
    expect(detected.mime).toBe('application/json');
    expect(detected.ext).toBe('json');
    expect(detected.isRasterImage).toBe(false);
  });
});
