import { Module } from "@nestjs/common";
import { OrderController } from "./order.controller";
import { OrderService } from "./order.service";
import { CartRepository } from "src/DB/models/Cart/cart.repository";
import { CartModel } from "src/DB/models/Cart/cart.model";
import { OrderModel } from "src/DB/models/Order/order.model";
import { ProductModel } from "src/DB/models/Product/product.model";
import { OrderRepository } from "src/DB/models/Order/order.repository";
import { ProductRepository } from "src/DB/models/Product/product.repository";
import { CartService } from "../Cart/cart.service";
import { PaymentService } from "src/common/service/payment.service";
import { UserModel } from "src/DB/models/User/user.model";
import { UserRepository } from "src/DB/models/User/user.repository";
import { PaymobModule } from "src/Payment/paymob.module";
import { ShippingRepository } from "src/DB/models/Shipping/shipping.repository";
import { ShippingModel } from "src/DB/models/Shipping/shipping.model";
import { CloudService } from "src/common/service/cloud.service";

@Module({
    imports:[CartModel, ProductModel, OrderModel, UserModel, PaymobModule, ShippingModel],
    controllers:[OrderController],
    providers:[
        OrderService,
        CartRepository, 
        OrderRepository, 
        ProductRepository, 
        CartService,
        PaymentService,
        UserRepository,
        ShippingRepository,
        CloudService,
    ],
})
export class OrderModule {}