import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  inspectImageMetadata,
  negotiateFormat,
  resolveQuality,
  transformImageBuffer,
} from '../src/core/sharp-pipeline.js';

describe('Sharp Pipeline (High-Performance Image Transforms & Content Negotiation)', () => {
  // Generate a test 200x100 solid red JPEG
  const createTestImage = async (width = 200, height = 100) => {
    return sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .jpeg()
      .toBuffer();
  };

  describe('negotiateFormat', () => {
    it('returns explicit format when requested', () => {
      expect(negotiateFormat('webp')).toEqual({ format: 'webp', mimeType: 'image/webp' });
      expect(negotiateFormat('avif')).toEqual({ format: 'avif', mimeType: 'image/avif' });
      expect(negotiateFormat('png')).toEqual({ format: 'png', mimeType: 'image/png' });
      expect(negotiateFormat('jpeg')).toEqual({ format: 'jpeg', mimeType: 'image/jpeg' });
    });

    it('negotiates modern formats via HTTP Accept header when auto is requested', () => {
      expect(negotiateFormat('auto', 'text/html,image/avif,image/webp,*/*')).toEqual({
        format: 'avif',
        mimeType: 'image/avif',
      });

      expect(negotiateFormat('auto', 'text/html,image/webp,*/*')).toEqual({
        format: 'webp',
        mimeType: 'image/webp',
      });

      expect(negotiateFormat('auto', '*/*')).toEqual({
        format: 'jpeg',
        mimeType: 'image/jpeg',
      });
    });
  });

  describe('resolveQuality', () => {
    it('respects numeric quality settings', () => {
      expect(resolveQuality(65, 'webp')).toBe(65);
      expect(resolveQuality(95, 'jpeg')).toBe(95);
    });

    it('applies calibrated auto quality per format', () => {
      expect(resolveQuality('auto', 'avif')).toBe(70);
      expect(resolveQuality('auto', 'webp')).toBe(80);
      expect(resolveQuality('auto', 'jpeg')).toBe(82);
    });
  });

  describe('inspectImageMetadata', () => {
    it('inspects dimensions and format from buffer', async () => {
      const imgBuffer = await createTestImage(320, 240);
      const meta = await inspectImageMetadata(imgBuffer);

      expect(meta.width).toBe(320);
      expect(meta.height).toBe(240);
      expect(meta.format).toBe('jpeg');
    });
  });

  describe('transformImageBuffer', () => {
    it('resizes image to target dimensions', async () => {
      const original = await createTestImage(400, 200);
      const result = await transformImageBuffer(original, {
        width: 100,
        height: 50,
        cropMode: 'fill',
        format: 'webp',
      });

      expect(result.mimeType).toBe('image/webp');
      expect(result.format).toBe('webp');
      expect(result.width).toBe(100);
      expect(result.height).toBe(50);
      expect(result.buffer.length).toBeGreaterThan(0);
    });

    it('converts format and applies grayscale', async () => {
      const original = await createTestImage(150, 150);
      const result = await transformImageBuffer(original, {
        grayscale: true,
        format: 'png',
      });

      expect(result.mimeType).toBe('image/png');
      expect(result.format).toBe('png');
      expect(result.width).toBe(150);
      expect(result.height).toBe(150);
    });
  });
});
