import os from 'node:os';
import sharp from 'sharp';
import { env } from '../config/env.js';
import type { SupportedFormat, TransformationParams } from '../types/index.js';

// Reserve at least 1 core for the host VPS OS and other services
const safeConcurrency = Math.max(1, os.cpus().length - 1);
sharp.concurrency(safeConcurrency);
sharp.cache({ memory: 64, items: 100, files: 50 });

export interface TransformResult {
  buffer: Buffer;
  mimeType: string;
  width?: number;
  height?: number;
  format: string;
}

/**
 * Negotiates optimal output format based on user requested format and HTTP Accept header.
 */
export function negotiateFormat(
  requestedFormat: SupportedFormat | undefined,
  acceptHeader: string = ''
): { format: 'avif' | 'webp' | 'jpeg' | 'png'; mimeType: string } {
  if (requestedFormat && requestedFormat !== 'auto') {
    switch (requestedFormat) {
      case 'avif':
        return { format: 'avif', mimeType: 'image/avif' };
      case 'webp':
        return { format: 'webp', mimeType: 'image/webp' };
      case 'png':
        return { format: 'png', mimeType: 'image/png' };
      case 'jpeg':
      default:
        return { format: 'jpeg', mimeType: 'image/jpeg' };
    }
  }

  // Auto-negotiation via Accept header
  if (acceptHeader.includes('image/avif')) {
    return { format: 'avif', mimeType: 'image/avif' };
  }
  if (acceptHeader.includes('image/webp')) {
    return { format: 'webp', mimeType: 'image/webp' };
  }

  return { format: 'jpeg', mimeType: 'image/jpeg' };
}

/**
 * Resolves optimal quality setting
 */
export function resolveQuality(
  quality: number | 'auto' | undefined,
  format: string
): number {
  if (typeof quality === 'number') {
    return quality;
  }

  // Defaults for 'auto'
  switch (format) {
    case 'avif':
      return 70; // AVIF has superior compression at lower quality values
    case 'webp':
      return 80;
    default:
      return 82;
  }
}

/**
 * Transforms an image buffer through Sharp pipeline with strict edge-case safety.
 */
export async function transformImageBuffer(
  inputBuffer: Buffer,
  params: TransformationParams,
  acceptHeader: string = ''
): Promise<TransformResult> {
  // Edge Case 1: Limit input pixels to prevent Decompression/Pixel Bombs
  let pipeline = sharp(inputBuffer, {
    failOn: 'none',
    limitInputPixels: env.MAX_INPUT_PIXELS,
  });

  // 1. Exif auto-orientation
  if (params.rotation === 'auto' || params.rotation === undefined) {
    pipeline = pipeline.rotate();
  } else if (typeof params.rotation === 'number') {
    pipeline = pipeline.rotate(params.rotation);
  }

  // 2. Resize and crop
  if (params.width || params.height) {
    let fit: 'cover' | 'inside' | 'fill' = 'cover';
    let position: string = 'entropy'; // Smart crop focus

    if (params.cropMode === 'fit') {
      fit = 'inside';
    } else if (params.cropMode === 'scale') {
      fit = 'fill';
    } else if (params.cropMode === 'crop') {
      fit = 'cover';
      position = 'centre';
    }

    pipeline = pipeline.resize({
      width: params.width,
      height: params.height,
      fit,
      position,
      withoutEnlargement: false,
    });
  }

  // 3. Visual Effects
  if (params.blur) {
    pipeline = pipeline.blur(params.blur);
  }
  if (params.grayscale) {
    pipeline = pipeline.grayscale();
  }
  if (params.sharpen) {
    pipeline = pipeline.sharpen();
  }

  // 4. Format & Quality Encoding
  const { format, mimeType } = negotiateFormat(params.format, acceptHeader);
  const quality = resolveQuality(params.quality, format);

  switch (format) {
    case 'avif':
      pipeline = pipeline.avif({ quality, effort: 4 });
      break;
    case 'webp':
      pipeline = pipeline.webp({ quality, effort: 4 });
      break;
    case 'png':
      pipeline = pipeline.png({ compressionLevel: 8 });
      break;
    case 'jpeg':
    default:
      pipeline = pipeline.jpeg({ quality, mozjpeg: true });
      break;
  }

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

  return {
    buffer: data,
    mimeType,
    width: info.width,
    height: info.height,
    format: info.format,
  };
}

/**
 * Inspects image metadata safely (dimensions, format, color space)
 */
export async function inspectImageMetadata(inputBuffer: Buffer) {
  const metadata = await sharp(inputBuffer, {
    failOn: 'none',
    limitInputPixels: env.MAX_INPUT_PIXELS,
  }).metadata();

  return {
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    hasAlpha: metadata.hasAlpha,
    orientation: metadata.orientation,
  };
}
