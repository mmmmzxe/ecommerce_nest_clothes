import { MongooseModule, Prop, raw, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, SchemaTypes, Types } from "mongoose";
import { ICartProduct } from "src/User/Cart/cart.interface";
import { IOrder, IorderProduct, OrderStatus, PaymentWay } from "src/User/Order/order.interface";



@Schema({ timestamps: true })
export class Order {

    @Prop({ type: String, required: false })
    firstName?: string;

    @Prop({ type: String, required: false })
    lastName?: string;


    @Prop({ type: String, required: true })
    address: string;

    @Prop({ type: String, required: false })
    email: string;

    @Prop({ type: String, required: true })
    phone: string;

    @Prop({ type: String, required: false })
    note?: string;


    @Prop({ type: String, required: false })
    rejectedReason: string;

    @Prop({ type: Date, required: false })
    paidAt?: Date;

    @Prop({ type: Types.ObjectId, ref: "User", required: false })
    createdBy?: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: "User", required: false })
    updatedBy?: Types.ObjectId;

    @Prop({ type: Number, required: false })
    discountAmount?: number;


    @Prop({ type: Number, required: true })
    subTotal: number;


    @Prop({type: String, enum:OrderStatus, default: OrderStatus.pending})
    status:OrderStatus

    @Prop({type: String, enum:PaymentWay, default: PaymentWay.cash})
    paymentWay: PaymentWay;

    @Prop(raw([{
        name:{type:String,  required: true},
        productId:{type: Types.ObjectId, ref:"Product", required: true},
        unitPrice:{type: Number, required: true},
        quantity:{type: Number, required: true},
        variantId:{type: Types.ObjectId, required: true},
        sizeId:{type: Types.ObjectId, required: true},
        variant:{ color: { type: String, required: false }, size: { type: String, required: false } },
        finalPrice:{type: Number, default: function (this: IorderProduct) {
            return this.quantity * this.unitPrice;
        }, }

    }]))
    products: IorderProduct[];

    @Prop({type: Number, required: true})
    finalPrice:number

    @Prop({type: String, required: false})
    intentId?: string;

    @Prop({type: Types.ObjectId, ref:"Shipping", required: false})
    shippingId?: Types.ObjectId;

    @Prop({ type: Number, required: false, default: 0 })
    deposit?: number;

    @Prop(raw({
        secure_url: { type: String, required: false },
        public_id: { type: String, required: false }
    }))
    depositReceipt?: { secure_url: string; public_id: string };

}

const orderSchema = SchemaFactory.createForClass(Order)

export const OrderModel = MongooseModule.forFeature([
    { name: Order.name, schema: orderSchema }
])
export type typeOrder = Order & Document;