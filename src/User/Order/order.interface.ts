import { IsMongoId } from "class-validator";
import { Types } from "mongoose";

export enum OrderStatus {
    pending="pending",
    placed="placed",
    onWay="on_way",
    cancelled="cancelled",
    delivered="delivered",
}


export enum PaymentWay {
    cash= "cash",
    card="card"
}
export class OrderIdDTO {
    @IsMongoId()
    orderId:Types.ObjectId
}
export interface IorderProduct {
    _id?:Types.ObjectId,
    name:string,
    productId:Types.ObjectId,
    variantId:Types.ObjectId,
    sizeId:Types.ObjectId,
    variant?: {
        color: string,
        size: string,
    },
    quantity:number,
    unitPrice:number,
    finalPrice:number,
}
export interface IOrderInputs {
    address:string,
    phone:string,
    note?: string,
    paymentWay:PaymentWay,
    depositReceipt?: { secure_url: string; public_id: string }
}

export interface IOrder extends IOrderInputs {
    _id?:Types.ObjectId,

    createdBy: Types.ObjectId,
    updatedBy?: Types.ObjectId,
    
    paidAt?:Date,

    rejectedReason?:string,

    products:IorderProduct[],

    status:OrderStatus
    subTotal:number,
    discountAmount?:number,
    finalPrice:number,
    intentId?: string,
    deposit?: number,
    depositReceipt?: { secure_url: string; public_id: string },
    updatedAt:Date,
    createdAt:Date
}