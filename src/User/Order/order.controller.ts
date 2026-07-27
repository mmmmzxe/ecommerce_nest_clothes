import { Body, Controller, Get, InternalServerErrorException, Param, Patch, Post, Req, UseGuards, UsePipes, ValidationPipe, UseInterceptors } from "@nestjs/common";
import { OrderService } from "./order.service";
import { FileInterceptor } from "@nestjs/platform-express";
import { multerOptions } from "src/common/Utility/multer";
import { CloudInterceptor } from "src/common/Interceptors/cloud.interceptor";
import { Role } from "src/common/Decorator/role.decorator";
import { AuthGuard } from "src/common/Guards/auth.guard";
import { RoleGuard } from "src/common/Guards/role.guard";
import { Request } from "express";
import { CreateOrderDTO, CreateOrderWithoutLoginDTO, UpdateStatusDTO, UpdateDepositDTO } from "./DTO";
import { OrderIdDTO } from "./order.interface";
import { Public } from "src/common/Decorator/public.decorator";

@UsePipes(new ValidationPipe({ whitelist: true }))
@Controller("order")
@Role(["user", "superAdmin", "admin"])
@UseGuards(AuthGuard, RoleGuard)
export class OrderController {
    constructor(private readonly orderService: OrderService) { }

    @Post()
    async create(
        @Body() createOrderDTO: CreateOrderDTO,
        @Req() req: Request) {
        const order = await this.orderService.createOrder(createOrderDTO, req)

        return {
            order
        }
    }

    @Public("public")
    @Post("without-login")
    async createwWithoutLogin(
        @Body() createOrderWithoutLoginDTO: CreateOrderWithoutLoginDTO) {
        const order = await this.orderService.createOrderWithoutLogin(createOrderWithoutLoginDTO)

        return {
            order
        }
    }

    @Public("public")
    @Post("upload-receipt")
    @UseInterceptors(FileInterceptor("receipt", multerOptions()), CloudInterceptor)
    async uploadReceipt(@Req() req: Request) {
        return {
            message: "Receipt uploaded successfully",
            receipt: req.body.image
        }
    }

    @Post(":orderId/paymob")
    async paymob(@Req() req: Request, @Param() params: OrderIdDTO) {
        return await this.orderService.checkOut(req, params.orderId)
    }

    @Public("public")
    @Post(":orderId/paymobWithoutLogin")
    async paymobWithoutLogin(@Param() params: OrderIdDTO) {
        return await this.orderService.checkOutWithoutLogin(params.orderId)
    }

    

    @Patch(":orderId")
    async checkOut(@Req() req: Request, @Param() params: OrderIdDTO) {
        const session = await this.orderService.checkOut(req, params.orderId)
        return {
            message: "Order Checked Out",
            session,
        }
    }

    @Patch(":orderId/cancel")
    async cancelOrder(@Req() req: Request, @Param() params: OrderIdDTO) {
        return await this.orderService.cancelOrder(req, params.orderId)
        
    }
    @Role(["admin", "superAdmin"])
    @Patch(":orderId/status")
    async updateStatus(@Param() params: OrderIdDTO, @Body() body: UpdateStatusDTO) {
        return await this.orderService.updateStatus(params.orderId, body)
    }

    @Role(["admin", "superAdmin"])
    @Patch(":orderId/deposit")
    async updateDeposit(@Param() params: OrderIdDTO, @Body() body: UpdateDepositDTO) {
        return await this.orderService.updateDeposit(params.orderId, body)
    }


    @Get("get-orders-by-user")
    async getOrderByUser(@Req() req: Request) {
        return await this.orderService.getOrderByUser(req)
    }
    @Role(["admin", "superAdmin"])
    @Get("all-orders")
    async getAllOrders() {
        try {
            return await this.orderService.getAllOrders()
        } catch (error) {
            throw new InternalServerErrorException(error)
        }
    }
}