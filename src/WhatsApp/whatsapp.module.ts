import { Module, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { Order, OrderModel } from 'src/DB/models/Order/order.model';
import { UserModel } from 'src/DB/models/User/user.model';
import { UserRepository } from 'src/DB/models/User/user.repository';
import { TokenService } from 'src/common/service/token.service';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';
import { registerWhatsAppListeners } from './whatsapp.event';

@Module({
  imports: [
    OrderModel,
    UserModel,
  ],
  controllers: [WhatsAppController],
  providers: [
    WhatsAppService,
    TokenService,
    UserRepository,
    JwtService,
  ],
  exports: [WhatsAppService],
})
export class WhatsAppModule implements OnModuleInit {
  constructor(private readonly whatsappService: WhatsAppService) {}

  /**
   * Register EventEmitter listeners once the module (and all providers) are ready.
   * This ensures WhatsAppService is fully injected before any event fires.
   */
  onModuleInit(): void {
    registerWhatsAppListeners(
      this.whatsappService.sendOrderConfirmationMessage.bind(this.whatsappService),
    );
  }
}
