import { describe, expect, it } from 'vitest';
import { transformLimiter } from '../src/core/transform-limiter.js';

describe('TransformationRateLimiter (Anti-CPU Bombing Protection)', () => {
  it('allows requests within limit quota', () => {
    const ip = '198.51.100.1';
    expect(transformLimiter.allow(ip)).toBe(true);

    const status = transformLimiter.getRemaining(ip);
    expect(status.remaining).toBeLessThanOrEqual(59);
    expect(status.resetInSeconds).toBeGreaterThan(0);
  });

  it('correctly tracks independent quotas per client IP', () => {
    const ipA = '198.51.100.2';
    const ipB = '198.51.100.3';

    transformLimiter.allow(ipA);
    transformLimiter.allow(ipA);

    const remainingA = transformLimiter.getRemaining(ipA).remaining;
    const remainingB = transformLimiter.getRemaining(ipB).remaining;

    expect(remainingA).toBe(58);
    expect(remainingB).toBe(60); // ipB hasn't consumed quota
  });

  it('blocks client when quota is completely exhausted', () => {
    const ip = '198.51.100.99';

    // Consume all 60 permits
    for (let i = 0; i < 60; i++) {
      expect(transformLimiter.allow(ip)).toBe(true);
    }

    // 61st request should be blocked
    expect(transformLimiter.allow(ip)).toBe(false);

    const remaining = transformLimiter.getRemaining(ip);
    expect(remaining.remaining).toBe(0);
    expect(remaining.resetInSeconds).toBeGreaterThan(0);
  });
});
