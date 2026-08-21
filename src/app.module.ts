/*  */

import { config } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { Module } from '@nestjs/common';
import { AuthModule } from './Auth/auth.module';
import { MongooseModule } from '@nestjs/mongoose';
import { UserModule } from './User/user.module';
import { DashboardModule } from './Dachboard/dashboard.module';
import { SellerModule } from './Seller/seller.module';
import { SupportModule } from './Support/support.module';
import { ShippingModule } from './Shipping/shipping.module';
import { AnnouncementModule } from './Announcement/announcement.module';
import { SocialOrderModule } from './SocialOrder/social-order.module';
import { CacheModule } from '@nestjs/cache-manager';
import { createKeyv } from '@keyv/redis';
import { AppController } from './app.controller';

const configPath = existsSync(resolve('config/.env')) ? resolve('config/.env') : resolve('.env');
config({ path: configPath });

const databaseUrl = process.env.DB_MODE === 'local'
  ? process.env.DB_URL_LOCAL
  : process.env.DB_URL;

if (!databaseUrl) {
  throw new Error('Missing database connection string. Set DB_URL or DB_URL_LOCAL in the backend environment.');
}

@Module({
  controllers :[AppController],
  imports: [
    AuthModule, 
    MongooseModule.forRoot(databaseUrl),
    CacheModule.registerAsync({
      useFactory: async () => {
        return {
          store: createKeyv('redis://localhost:6379')
        }
      },
      isGlobal : true
    }),
    UserModule,
    DashboardModule,
    SellerModule,
    SupportModule,
    ShippingModule,
    AnnouncementModule,
    SocialOrderModule,
  ],
  providers: [],
})
export class AppModule {}
