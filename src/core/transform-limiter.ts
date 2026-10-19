/**
 * In-Memory Sliding Window Rate Limiter for Image Transformations
 * Protects VPS CPU from Transformation Bombing / DoS attacks.
 * Only CACHE MISSES (which invoke Sharp) consume quota.
 * Cache hits bypass this limiter with zero overhead.
 */

interface ClientBucket {
  count: number;
  resetAt: number;
}

class TransformationRateLimiter {
  private buckets = new Map<string, ClientBucket>();
  private readonly windowMs: number;
  private readonly maxTransformationsPerWindow: number;

  constructor(windowMs = 60000, maxTransformationsPerWindow = 60) {
    this.windowMs = windowMs;
    this.maxTransformationsPerWindow = maxTransformationsPerWindow;

    // Periodic sweep to clean up stale buckets every 2 minutes
    setInterval(() => this.cleanup(), 120000).unref();
  }

  /**
   * Checks if client IP is within transformation rate limit.
   * Returns true if allowed, false if rate limited.
   */
  allow(clientIp: string): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(clientIp);

    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 1, resetAt: now + this.windowMs };
      this.buckets.set(clientIp, bucket);
      return true;
    }

    if (bucket.count >= this.maxTransformationsPerWindow) {
      return false;
    }

    bucket.count += 1;
    return true;
  }

  getRemaining(clientIp: string): { remaining: number; resetInSeconds: number } {
    const now = Date.now();
    const bucket = this.buckets.get(clientIp);
    if (!bucket || now >= bucket.resetAt) {
      return { remaining: this.maxTransformationsPerWindow, resetInSeconds: Math.ceil(this.windowMs / 1000) };
    }
    return {
      remaining: Math.max(0, this.maxTransformationsPerWindow - bucket.count),
      resetInSeconds: Math.max(0, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [ip, bucket] of this.buckets.entries()) {
      if (now >= bucket.resetAt) {
        this.buckets.delete(ip);
      }
    }
  }
}

export const transformLimiter = new TransformationRateLimiter(60000, 60);
