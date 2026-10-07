import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.BACKEND_PORT ?? 3000);

  app.setGlobalPrefix('api/v1');
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
