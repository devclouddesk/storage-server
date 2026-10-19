#!/usr/bin/env node
import { env } from './config/env.js';
import { filesStore } from './core/files-store.js';
import { keysStore } from './core/keys-store.js';
import { cacheManager } from './storage/cache-manager.js';
import type { ApiKeyPermission } from './types/index.js';

const args = process.argv.slice(2);
const command = args[0] || 'help';

function printHelp() {
  console.log(`
📦 Storage Server CLI - Command Line Tool
Usage: storage-server <command> [arguments] [options]

Commands:
  keys:list                     List all active API keys and their permissions
  keys:create [name] [options]  Create a new API key
                                Options:
                                  --role <secret|public>   Key permission type (default: secret)
                                  --rate <number>          Rate limit requests/min (default: 120)
  keys:revoke <keyId>           Revoke and delete an API key by ID
  stats                         Show storage usage, files count, and cache stats
  health                        Check local server health endpoint
  help                          Show this help message

Examples:
  storage-server keys:create "My Backend App" --role secret
  storage-server keys:create "Mobile Client" --role public --rate 60
  storage-server keys:list
  storage-server stats
`);
}

async function main() {
  try {
    switch (command) {
      case 'keys:list':
      case 'keys': {
        const keys = keysStore.listApiKeys();
        if (keys.length === 0) {
          console.log('No API keys found. Run "storage-server keys:create" to create one.');
          return;
        }

        console.log(`\n🔑 API Keys (${keys.length} total):\n`);
        console.table(
          keys.map((k) => ({
            ID: k.id,
            Prefix: `${k.keyPrefix}...`,
            Name: k.name,
            Type: k.type,
            Permissions: (k.permissions || []).join(', '),
            RateLimit: `${k.rateLimit}/min`,
            Created: new Date(k.createdAt * 1000).toLocaleString(),
          }))
        );
        break;
      }

      case 'keys:create': {
        const nameArg = args[1] && !args[1].startsWith('--') ? args[1] : 'CLI API Key';
        let role: 'public' | 'secret' = 'secret';
        let rateLimit = 120;

        for (let i = 1; i < args.length; i++) {
          if (args[i] === '--role' && args[i + 1]) {
            role = args[i + 1] === 'public' ? 'public' : 'secret';
          }
          if (args[i] === '--rate' && args[i + 1]) {
            rateLimit = parseInt(args[i + 1], 10) || 120;
          }
        }

        const permissions: ApiKeyPermission[] =
          role === 'public' ? ['read', 'write'] : ['read', 'write', 'delete', 'admin'];

        const { key, record } = keysStore.createKey(nameArg, permissions, rateLimit);

        console.log('\n✅ API Key Created Successfully:');
        console.log('─────────────────────────────────────────────────────────────────');
        console.log(`  Key:         ${key}`);
        console.log(`  Name:        ${record.name}`);
        console.log(`  Type:        ${record.type}`);
        console.log(`  Permissions: ${(record.permissions || []).join(', ')}`);
        console.log(`  Rate Limit:  ${record.rateLimit} req/min`);
        console.log('─────────────────────────────────────────────────────────────────');
        console.log('⚠️  Make sure to copy your API key now. You won\'t be able to see it again!\n');
        break;
      }

      case 'keys:revoke':
      case 'keys:delete': {
        const id = args[1];
        if (!id) {
          console.error('❌ Error: Missing key ID. Usage: storage-server keys:revoke <keyId>');
          process.exit(1);
        }

        const success = keysStore.deleteApiKey(id);
        if (success) {
          console.log(`\n✅ Key ${id} has been revoked and removed.\n`);
        } else {
          console.error(`\n❌ Error: Key with ID "${id}" not found.\n`);
          process.exit(1);
        }
        break;
      }

      case 'stats': {
        const fileStats = await filesStore.getMediaStats();
        const cacheStats = await cacheManager.getStats();
        const formatBytes = (bytes: number) => {
          if (bytes === 0) return '0 B';
          const k = 1024;
          const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
          const i = Math.floor(Math.log(bytes) / Math.log(k));
          return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
        };

        console.log('\n📊 Storage Server Statistics:');
        console.log('─────────────────────────────────────────────────────────────────');
        console.log(`  Total Files:       ${fileStats.totalFiles}`);
        console.log(`  Total Storage:     ${formatBytes(fileStats.totalBytes)}`);
        console.log(`  Cache Variants:    ${cacheStats.variantsCount}`);
        console.log(`  Cache Storage:     ${formatBytes(cacheStats.totalBytes)}`);
        console.log(`  Data Directory:    ${env.DATA_DIR}`);
        console.log('─────────────────────────────────────────────────────────────────\n');
        break;
      }

      case 'health': {
        const port = env.PORT || 7100;
        try {
          const res = await fetch(`http://127.0.0.1:${port}/health`);
          if (res.ok) {
            const data = await res.json();
            console.log(`\n✅ Server is Healthy (HTTP ${res.status} on port ${port})`);
            console.log(JSON.stringify(data, null, 2));
          } else {
            console.log(`\n⚠️  Server returned HTTP ${res.status}`);
          }
        } catch {
          console.log(`\n❌ Server is NOT running on port ${port} (connection refused)`);
        }
        break;
      }

      case 'help':
      case '--help':
      case '-h':
      default:
        printHelp();
        break;
    }
  } catch (err: any) {
    console.error('❌ CLI Error:', err.message || err);
    process.exit(1);
  }
}

main();
