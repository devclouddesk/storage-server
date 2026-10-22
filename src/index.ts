import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import { env } from './config/env.js';
import { keysStore } from './core/keys-store.js';
import { runLegacyDbMigration } from './core/migration.js';
import { errorHandler } from './middleware/error-handler.js';
import { adminRoutes } from './routes/admin.route.js';
import { healthRoutes } from './routes/health.route.js';
import { transformRoutes } from './routes/transform.route.js';
import { uploadRoutes } from './routes/upload.route.js';
import { diskGuard } from './storage/disk-guard.js';

async function bootstrap() {
  const server = Fastify({
    logger: env.NODE_ENV !== 'test',
    trustProxy: true,
  });

  // Global Error Handler
  server.setErrorHandler(errorHandler);

  // Gracefully handle empty body with application/json header (e.g. DELETE/GET proxies)
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
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Api-Key', 'x-admin-key', 'X-Upload-Token', 'X-Upload-Signature', 'If-None-Match'],
    exposedHeaders: ['ETag', 'Vary', 'X-Storage-Cache', 'X-Storage-Delivery', 'X-DCD-Cache', 'X-DCD-Delivery', 'Content-Length', 'Content-Type', 'Content-Disposition'],
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

  // Migrate any legacy SQLite database & ensure default keys in keys.json
  await runLegacyDbMigration();
  const defaultKeys = keysStore.ensureDefaultKeys();
  if (defaultKeys.publicKey && defaultKeys.secretKey) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔑 INITIAL API KEYS GENERATED:');
    console.log(`   Public Key (Client Uploads): ${defaultKeys.publicKey}`);
    console.log(`   Secret Key (Admin & Server): ${defaultKeys.secretKey}`);
    console.log('   Save these keys! Manage anytime via CLI (storage-server keys) or Admin API.');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }

  // Start low-disk-space background protection
  diskGuard.startMonitoring();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[Server] Received ${signal}. Shutting down gracefully...`);
    diskGuard.stopMonitoring();
    await server.close();
    console.log('[Server] Shutdown complete.');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Start listening
  try {
    const address = await server.listen({ port: env.PORT, host: env.HOST });
    console.log(`🚀 Storage Server running at: ${address}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

bootstrap();
