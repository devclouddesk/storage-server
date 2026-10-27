import { describe, expect, it } from 'vitest';
import { RequestLock } from '../src/core/request-lock.js';

describe('RequestLock (Thundering Herd / Stampede Protection)', () => {
  it('deduplicates concurrent requests so the factory only runs once', async () => {
    const lock = new RequestLock();
    let executionCount = 0;

    const slowFactory = async () => {
      executionCount++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { buffer: Buffer.from('transformed_image'), mimeType: 'image/webp' };
    };

    // Trigger 5 concurrent requests for the exact same cache variant
    const cacheKey = 'avatar_w_300_webp';
    const promises = [
      lock.acquire(cacheKey, slowFactory),
      lock.acquire(cacheKey, slowFactory),
      lock.acquire(cacheKey, slowFactory),
      lock.acquire(cacheKey, slowFactory),
      lock.acquire(cacheKey, slowFactory),
    ];

    expect(lock.activeCount).toBe(1);

    const results = await Promise.all(promises);

    // Factory must have executed exactly ONCE
    expect(executionCount).toBe(1);

    // All callers must receive identical result
    for (const res of results) {
      expect(res.buffer.toString()).toBe('transformed_image');
      expect(res.mimeType).toBe('image/webp');
    }

    // Active jobs cleaned up after completion
    expect(lock.activeCount).toBe(0);
  });

  it('cleans up in-flight jobs even if the factory throws an error', async () => {
    const lock = new RequestLock();

    const failingFactory = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new Error('Sharp processing failed');
    };

    const cacheKey = 'corrupt_img';
    const p1 = lock.acquire(cacheKey, failingFactory);
    const p2 = lock.acquire(cacheKey, failingFactory);

    await expect(p1).rejects.toThrow('Sharp processing failed');
    await expect(p2).rejects.toThrow('Sharp processing failed');

    // Cleaned up
    expect(lock.activeCount).toBe(0);
  });
});
