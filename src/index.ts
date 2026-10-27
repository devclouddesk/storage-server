import { buildApp } from './app.js';
import { env } from './config/env.js';
import { keysStore } from './core/keys-store.js';
import { runLegacyDbMigration } from './core/migration.js';
import { diskGuard } from './storage/disk-guard.js';

async function bootstrap() {
  const server = await buildApp();

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
