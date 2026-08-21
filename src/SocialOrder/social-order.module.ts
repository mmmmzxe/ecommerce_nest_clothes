import { Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserModel } from 'src/DB/models/User/user.model';
import { UserRepository } from 'src/DB/models/User/user.repository';
import { CloudService } from 'src/common/service/cloud.service';
import { TokenService } from 'src/common/service/token.service';
import { SocialOrderController } from './social-order.controller';
import { SocialOrderModel } from './social-order.model';
import { SocialOrderRepository } from './social-order.repository';
import { SocialOrderService } from './social-order.service';

@Module({
  imports: [SocialOrderModel, UserModel],
  controllers: [SocialOrderController],
  providers: [
    SocialOrderService,
    SocialOrderRepository,
    CloudService,
    TokenService,
    UserRepository,
    JwtService,
  ],
})
export class SocialOrderModule {}
