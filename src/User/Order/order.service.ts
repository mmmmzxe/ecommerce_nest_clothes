/* eslint-disable no-unsafe-optional-chaining */
/*  */
/*  */
import { BadRequestException, HttpException, Injectable, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import { CartRepository } from "src/DB/models/Cart/cart.repository";
import { CreateOrderDTO, CreateOrderWithoutLoginDTO, UpdateStatusDTO, UpdateDepositDTO } from "./DTO";
import { Request } from "express";
import { IorderProduct, OrderIdDTO, OrderStatus, PaymentWay } from "./order.interface";
import { ProductRepository } from "src/DB/models/Product/product.repository";
import { Matches } from "class-validator";
import { OrderRepository } from "src/DB/models/Order/order.repository";
import { CartService } from "../Cart/cart.service";
import { Types } from "mongoose";
import { PaymentService } from "src/common/service/payment.service";
import Stripe from "stripe";
import { PaymobService } from "src/Payment/paymob.service";
import { UserRepository } from "src/DB/models/User/user.repository";
import { emailEvent } from "src/common/Utility/email.event";
import { emit } from "process";
import { ShippingRepository } from "src/DB/models/Shipping/shipping.repository";

@Injectable()
export class OrderService {
    constructor(
        private readonly cartRepository: CartRepository,
        private readonly productRepository: ProductRepository,
        private readonly orderRepository: OrderRepository,
        private readonly cartService: CartService,
        private readonly paymentService: PaymentService,
        private readonly userRepository: UserRepository,
        private readonly paymobService: PaymobService,
        private readonly shippingRepository: ShippingRepository
    ) { }

    private getSelection(product: { variant?: { color?: string; size?: string } }, fallback?: { color?: string; size?: string }) {
        const color = product.variant?.color || fallback?.color;
        const size = product.variant?.size || fallback?.size;
        if (!color || !size) {
            throw new BadRequestException("Variant color and size are required");
        }
        return { color, size };
    }

    private buildProductFilter(productId: Types.ObjectId, selection: { color: string; size: string }, quantity: number) {
        return {
            _id: productId,
            variants: {
                $elemMatch: {
                    color: selection.color,
                    size: { $elemMatch: { size: selection.size, stock: { $gte: quantity } } },
                },
            },
        };
    }

    private buildArrayFilters(selection: { color: string; size: string }, quantity: number) {
        return [
            { "v.color": selection.color },
            { "s.size": selection.size, "s.stock": { $gte: quantity } }
        ];
    }

    async createOrder(createOrderDTO: CreateOrderDTO, req: Request) {
        try {
            const cart = await this.cartRepository.findOne({ createdBy: req["user"]._id })
            if (!cart?.products?.length) {
                throw new NotFoundException("Cart Empty")
            }

            let subTotal: number = 0
            const products: IorderProduct[] = []
            for (const product of cart.products) {
                const selection = this.getSelection(product as any, product.variant);
                const checkProduct = await this.productRepository.findOne(
                    this.buildProductFilter(new Types.ObjectId(product.productId as any), selection, product.quantity)
                )
                if (!checkProduct) {
                    throw new BadRequestException(`In-Valid Product or out of stock ${product.productId}`)
                }
                products.push({
                    name: checkProduct.titleEnglish,
                    productId: checkProduct._id,
                    variantId: product.variantId,
                    sizeId: product.sizeId,
                    variant: selection,
                    quantity: product.quantity,
                    unitPrice: checkProduct.finalPrice,
                    finalPrice: checkProduct.finalPrice * product.quantity
                })
                subTotal += checkProduct.finalPrice * product.quantity
            }
            const shipping = await this.shippingRepository.findOne({ _id: createOrderDTO.shippingId })
            if (!shipping) {
                throw new BadRequestException("Shipping not found")
            }
            subTotal += shipping.price
            let finalPrice = subTotal


            const order = await this.orderRepository.create({
                ...createOrderDTO,
                subTotal,
                discountAmount: createOrderDTO.discountPercent,
                products,
                createdBy: req["user"]._id,
                finalPrice,
                shippingId: createOrderDTO.shippingId,
                depositReceipt: createOrderDTO.depositReceipt
            })
            await this.cartService.clearCart(req)

            for (const product of products) {
                const selection = product.variant as { color: string; size: string };
                await this.productRepository.updateOne(
                    { _id: product.productId },
                    {
                        $inc: {
                            "variants.$[v].size.$[s].stock": -product.quantity,
                            sellCount: product.quantity
                        },


                    },
                    {
                        arrayFilters: this.buildArrayFilters(selection, product.quantity)
                    }
                );
            }
            emailEvent.emit("CreateOrder", { email: req["user"].email, order, userName: req["user"].name })
            emailEvent.emit("CreateOrderAdmin", { email: process.env.EMAIL, order, userName: req["user"].name, customerEmail: req["user"].email })
            return { order }
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            throw new InternalServerErrorException(error)
        }

    }

    async checkOut(req: Request, orderId: Types.ObjectId)
        : Promise<{ provider: string; url: string } | undefined> {

        try {
            const order = await this.orderRepository.findOne({
                _id: orderId,
                createdBy: req["user"]._id,
                status: OrderStatus.pending,
                paymentWay: PaymentWay.card
            })

            if (!order) {
                throw new BadRequestException("Order not found")
            }
            // If you want to use Paymob for card payments instead of Stripe

            const amountCents = Math.round(order.finalPrice * 100);
            const merchantOrderId = `${String(orderId)}-${Date.now()}`;

            // Create Intention
            const result = await this.paymobService.createIntention(
                amountCents,
                "EGP",
                {
                    email: req["user"].email,
                    phone_number: order.phone,
                    street: order.address || "NA",
                    city: "",
                    country: "EG",
                    postal_code: "",
                    state: "",
                    first_name: (req["user"].name?.split(" ")[0]) || "User",
                    last_name: (req["user"].name?.split(" ").slice(1).join(" ") || "NA"),
                },
                merchantOrderId
            );

            // We don't get a separate order ID from intention API immediately in the response in the same way,
            // but we can track the merchantOrderId or handle webhooks. 
            // For now, let's just save the intention/reference if needed?
            // The intention response might have an ID.
            // But the webhook will send the order ID.
            // Let's assume we proceed.

            if (!order.intentId) {
                await this.orderRepository.updateOne({ _id: order._id }, { intentId: merchantOrderId });
            }

            return { provider: "paymob", url: result.url };

        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            throw new InternalServerErrorException(error)
        }


    }

    async checkOutWithoutLogin(orderId: Types.ObjectId) {
        try {
            const order = await this.orderRepository.findOne({
                _id: orderId,
                status: OrderStatus.pending,
                paymentWay: PaymentWay.card
            })

            if (!order) {
                throw new BadRequestException("Order not found or not eligible for payment")
            }

            const amountCents = Math.round(order.finalPrice * 100);
            const merchantOrderId = `${String(orderId)}-${Date.now()}`;

            const result = await this.paymobService.createIntention(
                amountCents,
                "EGP",
                {
                    email: order.email as string,
                    phone_number: order.phone as string,
                    street: order.address || "NA",
                    city: "",
                    country: "EG",
                    postal_code: "",
                    state: "",
                    first_name: order.firstName || "User",
                    last_name: order.lastName || "",
                },
                merchantOrderId
            );

            if (!order.intentId) {
                await this.orderRepository.updateOne({ _id: order._id }, { intentId: merchantOrderId });
            }

            return { provider: "paymob", url: result.url };
        } catch (error) {
            throw new InternalServerErrorException(error)
        }
    }

    async cancelOrder(req: Request, orderId: Types.ObjectId) {


        const order = await this.orderRepository.findOne({
            _id: orderId,
            createdBy: req["user"]._id,
            $or: [
                { status: OrderStatus.pending },
                { status: OrderStatus.placed }
            ],
        })


        for (const product of order?.products as IorderProduct[]) {
            await this.productRepository.updateOne(
                { _id: product.productId },
                {
                    $inc: {
                        "variants.$[v].size.$[s].stock": product.quantity,
                        sellCount: -product.quantity
                    }
                },
                {
                    arrayFilters: [
                        { "v._id": product.variantId },
                        { "s._id": product.sizeId }
                    ]
                }
            );
        }

        await this.orderRepository.updateOne(
            { _id: orderId },
            {
                status: OrderStatus.cancelled,
                updatedBy: req["user"]._id
            }
        )

        if (!order) {
            throw new BadRequestException("Order not found")
        }

        return { message: "Done" }
    }

    async createOrderWithoutLogin(createOrderWithoutLoginDTO: CreateOrderWithoutLoginDTO) {
        try {
            let subTotal: number = 0
            const products: IorderProduct[] = []
            for (const product of createOrderWithoutLoginDTO.products) {
                const selection = this.getSelection(product as any, product.variant);
                const checkProduct = await this.productRepository.findOne(
                    this.buildProductFilter(new Types.ObjectId(product.productId), selection, product.quantity))
                if (!checkProduct) {
                    throw new BadRequestException("Product not found or out of stock")
                }
                products.push({
                    name: checkProduct.titleEnglish,
                    productId: checkProduct._id,
                    variantId: product.variantId,
                    sizeId: product.sizeId,
                    variant: selection,
                    quantity: product.quantity,
                    unitPrice: checkProduct.finalPrice,
                    finalPrice: checkProduct.finalPrice * product.quantity
                })
                subTotal += checkProduct.finalPrice * product.quantity
            }
            const shipping = await this.shippingRepository.findOne({ _id: createOrderWithoutLoginDTO.shippingId })
            if (!shipping) {
                throw new BadRequestException("Shipping not found")
            }
            subTotal += shipping.price
            let finalPrice = subTotal

            const { email, address, phone, note, paymentWay, firstName, lastName } = createOrderWithoutLoginDTO
            const order = await this.orderRepository.create({
                email,
                address,
                phone,
                note,
                paymentWay,
                products,
                subTotal,
                finalPrice,
                firstName: firstName,
                lastName: lastName,
                shippingId: createOrderWithoutLoginDTO.shippingId,
                depositReceipt: createOrderWithoutLoginDTO.depositReceipt
            })

            for (const product of products) {
                const selection = product.variant as { color: string; size: string };
                await this.productRepository.updateOne(
                    { _id: product.productId },
                    {
                        $inc: {
                            "variants.$[v].size.$[s].stock": -product.quantity,
                            sellCount: product.quantity
                        }
                    },
                    {
                        arrayFilters: this.buildArrayFilters(selection, product.quantity)
                    }
                );
            }
            emailEvent.emit("CreateOrder", { email: order.email, order, userName: order.firstName + " " + order.lastName })
            emailEvent.emit("CreateOrderAdmin", { email: process.env.EMAIL, order, userName: order.firstName + " " + order.lastName, customerEmail: order.email })
            return order
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            throw new InternalServerErrorException(error)
        }
    }

    async getOrderByUser(req: Request) {
        const orders = await this.orderRepository.findAll({
            filter: { createdBy: req["user"]._id },
            population: [{ path: "shippingId" }]
        })
        return orders
    }

    async getAllOrders() {
        try {
            const orders = await this.orderRepository.findAll({
                filter: {},
                population: [{ path: "createdBy" }, { path: "shippingId" }]
            })
            return orders
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            throw new InternalServerErrorException(error)
        }
    }

    async updateStatus(orderId: Types.ObjectId, body: UpdateStatusDTO) {
        try {
            const order = await this.orderRepository.findOne({ _id: orderId })
            if (!order) {
                throw new BadRequestException("Order not found")
            }
            order.status = body.status

            await order.save()
            if (order.email) {
                emailEvent.emit("OrderStatus", { email: order.email, order, userName: order.firstName })
            }
            else {
                const user = await this.userRepository.findOne({ _id: order.createdBy })
                emailEvent.emit("OrderStatus", { email: user?.email, order, userName: user?.name })
            }



            if (body.status === OrderStatus.cancelled) {
                for (const product of order?.products as IorderProduct[]) {
                    const selection = this.getSelection(product as any, product.variant);
                    await this.productRepository.updateOne(
                        { _id: product.productId },
                        {
                            $inc: { "variants.$[v].size.$[s].stock": product.quantity }
                        },
                        {
                            arrayFilters: [
                                { "v.color": selection.color },
                                { "s.size": selection.size }
                            ]
                        }
                    );
                }
            }
            return order
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            throw new InternalServerErrorException(error)
        }
    }

    async updateDeposit(orderId: Types.ObjectId, body: UpdateDepositDTO) {
        try {
            const order = await this.orderRepository.findOne({ _id: orderId })
            if (!order) {
                throw new BadRequestException("Order not found")
            }
            order.deposit = body.deposit
            await order.save()
            return order
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            throw new InternalServerErrorException(error)
        }
    }
}