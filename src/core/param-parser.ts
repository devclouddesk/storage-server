import type { CropMode, SupportedFormat, TransformationParams } from '../types/index.js';

const VALID_FORMATS = new Set<SupportedFormat>(['auto', 'webp', 'avif', 'jpeg', 'png']);
const VALID_CROPS = new Set<CropMode>(['fill', 'fit', 'crop', 'scale']);

export function parseTransformationParams(rawParams: string): TransformationParams {
  const result: TransformationParams = {};
  if (!rawParams || rawParams.trim() === '' || rawParams === 'original') {
    return result;
  }

  const tokens = rawParams.split(',');

  for (const token of tokens) {
    const trimmed = token.trim();
    if (!trimmed) continue;

    // Width: w_400 (Clamped to 4096 max to prevent memory exhaustion)
    if (trimmed.startsWith('w_')) {
      const val = parseInt(trimmed.slice(2), 10);
      if (!isNaN(val) && val > 0) {
        result.width = Math.min(val, 4096);
      }
    }
    // Height: h_300 (Clamped to 4096 max to prevent memory exhaustion)
    else if (trimmed.startsWith('h_')) {
      const val = parseInt(trimmed.slice(2), 10);
      if (!isNaN(val) && val > 0) {
        result.height = Math.min(val, 4096);
      }
    }
    // Crop Mode: c_fill, c_fit, c_crop, c_scale
    else if (trimmed.startsWith('c_')) {
      const mode = trimmed.slice(2) as CropMode;
      if (VALID_CROPS.has(mode)) {
        result.cropMode = mode;
      }
    }
    // Format: f_auto, f_webp, f_avif, f_jpeg, f_png
    else if (trimmed.startsWith('f_')) {
      const fmt = trimmed.slice(2).toLowerCase() as SupportedFormat;
      if (VALID_FORMATS.has(fmt)) {
        result.format = fmt;
      }
    }
    // Quality: q_auto, q_85
    else if (trimmed.startsWith('q_')) {
      const qVal = trimmed.slice(2);
      if (qVal.toLowerCase() === 'auto') {
        result.quality = 'auto';
      } else {
        const num = parseInt(qVal, 10);
        if (!isNaN(num) && num >= 1 && num <= 100) {
          result.quality = num;
        }
      }
    }
    // Effects: e_blur_5, e_blur, e_grayscale, e_gray, e_sharpen
    else if (trimmed.startsWith('e_')) {
      const effect = trimmed.slice(2).toLowerCase();
      if (effect === 'grayscale' || effect === 'gray') {
        result.grayscale = true;
      } else if (effect === 'sharpen') {
        result.sharpen = true;
      } else if (effect.startsWith('blur')) {
        const parts = effect.split('_');
        const blurSigma = parts.length > 1 ? parseFloat(parts[1]) : 5;
        result.blur = isNaN(blurSigma) ? 5 : Math.min(Math.max(blurSigma, 0.3), 100);
      }
    }
    // Rotation: r_90, r_180, r_270, r_auto
    else if (trimmed.startsWith('r_')) {
      const rVal = trimmed.slice(2).toLowerCase();
      if (rVal === 'auto') {
        result.rotation = 'auto';
      } else {
        const num = parseInt(rVal, 10);
        if (num === 90 || num === 180 || num === 270) {
          result.rotation = num;
        }
      }
    }
  }

  return result;
}

/**
 * Normalizes transformation params into a canonical deterministic string key
 * Used for LRU cache lookup and hashing.
 */
export function normalizeParamsKey(params: TransformationParams): string {
  const parts: string[] = [];

  if (params.width) parts.push(`w_${params.width}`);
  if (params.height) parts.push(`h_${params.height}`);
  if (params.cropMode) parts.push(`c_${params.cropMode}`);
  if (params.format) parts.push(`f_${params.format}`);
  if (params.quality) parts.push(`q_${params.quality}`);
  if (params.blur) parts.push(`e_blur_${params.blur}`);
  if (params.grayscale) parts.push('e_gray');
  if (params.sharpen) parts.push('e_sharp');
  if (params.rotation) parts.push(`r_${params.rotation}`);

  return parts.length > 0 ? parts.join(',') : 'original';
}
