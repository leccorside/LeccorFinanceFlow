import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { EnvValidationError, loadEnv } from './config/env.js';

async function bootstrap(): Promise<void> {
  // Fail fast with a readable message before Nest starts wiring modules.
  const env = loadEnv(process.env);
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  await app.listen(env.BACKEND_PORT, '0.0.0.0');
}

bootstrap().catch((error: unknown) => {
  if (error instanceof EnvValidationError) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
});
