import { Global, Module } from '@nestjs/common';
import { SettingsService } from './settings.service.js';

/** Global settings (PASSO 20), read by auth, assistant, voice and admin. */
@Global()
@Module({
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
