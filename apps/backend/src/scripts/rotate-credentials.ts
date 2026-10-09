/**
 * Re-encrypts stored credentials with the active key version.
 *
 *   1. Add DATA_ENCRYPTION_KEY_V2 and set DATA_ENCRYPTION_KEY_ACTIVE_VERSION=v2 (keep V1).
 *   2. Restart the backend (new writes use v2; old values stay readable with v1).
 *   3. Run `pnpm credentials:rotate`.
 *   4. When it reports nothing left to rotate, V1 can be removed from the environment.
 */
import { rotateAiCredentials } from '../ai/ai.service.js';
import { CredentialVault } from '../common/crypto/credential-vault.js';
import { loadEnv } from '../config/env.js';
import { createPrismaClientOptions } from '../database/prisma-options.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { rotateGoogleCredentials } from '../google/google-connection.service.js';

async function main(): Promise<void> {
  const env = loadEnv(process.env);
  if (!env.ENCRYPTION) {
    throw new Error('No DATA_ENCRYPTION_KEY_V<n> configured: nothing to rotate with.');
  }
  const vault = new CredentialVault(env.ENCRYPTION.keys, env.ENCRYPTION.activeVersion);
  const prisma = new PrismaClient(createPrismaClientOptions(env.DATABASE_URL));

  try {
    const google = await rotateGoogleCredentials(prisma, vault);
    const ai = await rotateAiCredentials(prisma, vault);
    console.info(
      `Active key ${vault.activeVersion}. Google connections: ${google.checked} checked, ${google.rotated} re-encrypted, ${google.failed} unreadable. ` +
        `AI keys: ${ai.checked} checked, ${ai.rotated} re-encrypted, ${ai.failed} unreadable.`,
    );
    if (google.failed + ai.failed > 0) {
      console.error(
        'Some credentials could not be decrypted with the configured keys and were left untouched. ' +
          'Do not remove old key versions until this reports 0.',
      );
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // Never print credential material: only the error message.
  console.error(error instanceof Error ? error.message : 'rotation failed');
  process.exit(1);
});
