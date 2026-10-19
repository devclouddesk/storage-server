import type { FastifyInstance } from 'fastify';
import { getStorageProviderName } from '../storage/index.js';

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async () => {
    return {
      status: 'healthy',
      service: 'devclouddesk-media-server',
      version: '1.0.0',
      uptime: Math.floor(process.uptime()),
      storage: getStorageProviderName(),
      timestamp: new Date().toISOString(),
    };
  });
}
