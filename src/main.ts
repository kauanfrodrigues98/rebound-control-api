import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { allowedOrigins, env } from './config/env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('Origin not allowed by CORS'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
  });

  app.setGlobalPrefix('api/v1');

  await app.listen(env.PORT, env.HOST);
  console.log(`Rebound Control API on http://${env.HOST}:${env.PORT}/api/v1`);
}
bootstrap();
