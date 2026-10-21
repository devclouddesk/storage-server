import { describe, expect, it } from 'vitest';
import { parseTransformationParams } from '../src/core/param-parser.js';

describe('parseTransformationParams', () => {
  it('returns empty object for empty or "original" string', () => {
    expect(parseTransformationParams('')).toEqual({});
    expect(parseTransformationParams('original')).toEqual({});
    expect(parseTransformationParams('   ')).toEqual({});
  });

  it('parses dimensions correctly and clamps to 4096', () => {
    const params = parseTransformationParams('w_800,h_600');
    expect(params.width).toBe(800);
    expect(params.height).toBe(600);

    const clamped = parseTransformationParams('w_10000,h_5000');
    expect(clamped.width).toBe(4096);
    expect(clamped.height).toBe(4096);
  });

  it('parses crop modes correctly', () => {
    expect(parseTransformationParams('c_fill').cropMode).toBe('fill');
    expect(parseTransformationParams('c_fit').cropMode).toBe('fit');
    expect(parseTransformationParams('c_crop').cropMode).toBe('crop');
    expect(parseTransformationParams('c_scale').cropMode).toBe('scale');
  });

  it('parses output formats', () => {
    expect(parseTransformationParams('f_webp').format).toBe('webp');
    expect(parseTransformationParams('f_avif').format).toBe('avif');
    expect(parseTransformationParams('f_jpeg').format).toBe('jpeg');
    expect(parseTransformationParams('f_auto').format).toBe('auto');
  });

  it('parses quality correctly', () => {
    expect(parseTransformationParams('q_auto').quality).toBe('auto');
    expect(parseTransformationParams('q_85').quality).toBe(85);
    expect(parseTransformationParams('q_120').quality).toBeUndefined(); // Out of 1-100 range
  });

  it('parses effects like blur, grayscale, and sharpen', () => {
    const res = parseTransformationParams('e_blur_10,e_gray,e_sharpen');
    expect(res.blur).toBe(10);
    expect(res.grayscale).toBe(true);
    expect(res.sharpen).toBe(true);
  });

  it('parses complex compound transformation string', () => {
    const res = parseTransformationParams('w_400,h_300,c_fill,q_80,f_webp,e_blur_3');
    expect(res).toEqual({
      width: 400,
      height: 300,
      cropMode: 'fill',
      quality: 80,
      format: 'webp',
      blur: 3,
    });
  });
});
