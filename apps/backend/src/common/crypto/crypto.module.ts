import { Global, Module } from '@nestjs/common';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { CREDENTIAL_VAULT, CredentialVault } from './credential-vault.js';

/** Provides the credential vault, or null when no encryption key is configured. */
@Global()
@Module({
  providers: [
    {
      provide: CREDENTIAL_VAULT,
      inject: [APP_ENV],
      useFactory: (env: AppEnv) =>
        env.ENCRYPTION
          ? new CredentialVault(env.ENCRYPTION.keys, env.ENCRYPTION.activeVersion)
          : null,
    },
  ],
  exports: [CREDENTIAL_VAULT],
})
export class CryptoModule {}
