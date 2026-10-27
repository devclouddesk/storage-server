import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance } from 'fastify';
import { env } from './config/env.js';
import { errorHandler } from './middleware/error-handler.js';
import { adminRoutes } from './routes/admin.route.js';
import { healthRoutes } from './routes/health.route.js';
import { transformRoutes } from './routes/transform.route.js';
import { uploadRoutes } from './routes/upload.route.js';

export interface BuildAppOptions {
  logger?: boolean;
}

/**
 * Standardized Fastify Application Factory
 * Modularized for both live server runtime and fast in-memory integration testing
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const server = Fastify({
    logger: options.logger ?? (env.NODE_ENV !== 'test'),
    trustProxy: true,
  });

  // Global Error Handler
  server.setErrorHandler(errorHandler);

  // Gracefully handle empty body with application/json header
  server.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body: string, done) => {
    if (!body || body.trim() === '') {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(body));
    } catch (err: any) {
      done(err, undefined);
    }
  });

  // CORS for public web clients
  await server.register(cors, {
    origin: true, // Allow any origin for public media delivery
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Api-Key',
      'x-admin-key',
      'X-Upload-Token',
      'X-Upload-Signature',
      'If-None-Match',
    ],
    exposedHeaders: [
      'ETag',
      'Vary',
      'X-Storage-Cache',
      'X-Storage-Delivery',
      'X-DCD-Cache',
      'X-DCD-Delivery',
      'Content-Length',
      'Content-Type',
      'Content-Disposition',
    ],
  });

  // Multipart Streaming Uploads with max file size limit
  await server.register(multipart, {
    limits: {
      fileSize: env.MAX_FILE_SIZE_MB * 1024 * 1024,
      files: 1, // 1 file per upload request
    },
  });

  // Register Routes
  await server.register(healthRoutes);
  await server.register(uploadRoutes);
  await server.register(transformRoutes);
  await server.register(adminRoutes);

  return server;
}
