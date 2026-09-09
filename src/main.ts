
import { config } from "dotenv"
import { resolve, join } from "path"
import { existsSync } from "fs"

// Load environment file: prefer config/.env, fall back to project root .env
const configPath = existsSync(resolve("config/.env")) ? resolve("config/.env") : resolve(".env");
config({ path: configPath });
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as express from "express";
import { NestExpressApplication } from "@nestjs/platform-express";

async function bootstrap() {

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors()
  app.use("/paymob/webhook", express.raw({ type: 'application/json' }))
  app.use(express.urlencoded({ extended: true }))
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/api/uploads' })
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
