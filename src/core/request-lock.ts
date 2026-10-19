/**
 * In-Flight Request Collapsing (Thundering Herd / Cache Stampede Guard)
 *
 * When multiple concurrent HTTP requests arrive for the exact same uncached image variant,
 * this lock ensures that the expensive Sharp image transformation is performed only ONCE.
 * All subsequent concurrent requests attach to the ongoing Promise and receive the same Buffer.
 */

export class RequestLock {
  private activeJobs = new Map<string, Promise<{ buffer: Buffer; mimeType: string }>>();

  /**
   * Executes or shares an ongoing processing job for the specified cache key.
   */
  async acquire(
    cacheKey: string,
    factory: () => Promise<{ buffer: Buffer; mimeType: string }>
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const existing = this.activeJobs.get(cacheKey);
    if (existing) {
      return existing;
    }

    const jobPromise = factory()
      .finally(() => {
        // Clean up once transformation is complete (either success or failure)
        this.activeJobs.delete(cacheKey);
      });

    this.activeJobs.set(cacheKey, jobPromise);
    return jobPromise;
  }

  /**
   * Returns current count of in-flight transformations
   */
  get activeCount(): number {
    return this.activeJobs.size;
  }
}

export const requestLock = new RequestLock();
