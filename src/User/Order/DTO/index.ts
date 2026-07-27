import { IsArray, IsEmail, IsEnum, IsMongoId, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, Matches, Max, MaxLength, MinLength, ValidateNested, Min } from "class-validator";
import { IOrderInputs, OrderStatus, PaymentWay } from "../order.interface";
import { ICartProduct } from "src/User/Cart/cart.interface";
import { Type } from "class-transformer";
import { Types } from "mongoose";

export class CreateOrderDTO implements IOrderInputs{

    @IsString()
    @MinLength(2)
    @MaxLength(1000)
    address:string;

    @IsString()
    @IsNotEmpty()
    phone:string;


    @IsString()
    @MinLength(2)
    @MaxLength(1000)
    note?: string;

    @IsString()
    @IsEnum(PaymentWay)
    paymentWay: PaymentWay;

    @IsNumber()
    @IsPositive()
    @Max(100)
    @IsOptional()
    discountPercent: number
 

    @IsMongoId()
    @Type(() => Types.ObjectId)
    shippingId: Types.ObjectId;

    @IsOptional()
    depositReceipt?: { secure_url: string; public_id: string };
}

export class CartVariantDTO {
    @IsString()
    color: string;

    @IsString()
    size: string;
}

export class CartProductDTO {
    @IsMongoId()
    @Type(() => Types.ObjectId)
    productId: Types.ObjectId;

    @IsMongoId()
    @Type(() => Types.ObjectId)
    variantId: Types.ObjectId;

    @IsMongoId()
    @Type(() => Types.ObjectId)
    sizeId: Types.ObjectId;

    @IsNumber()
    @IsPositive()
    quantity: number;

    @ValidateNested()
    @Type(() => CartVariantDTO)
    @IsOptional()
    variant?: CartVariantDTO;
    
}
export class CreateOrderWithoutLoginDTO {

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CartProductDTO)
    products:   CartProductDTO[];

    @IsNotEmpty()
    @IsString()
    @IsEmail()
    email:string;

    @IsString()
    @MinLength(2)
    @MaxLength(1000)
    address:string;

    @IsString()
    phone:string;


    @IsString()
    @MinLength(2)
    @MaxLength(1000)
    note?: string;

    @IsString()
    @IsEnum(PaymentWay)
    paymentWay: PaymentWay;

    @IsMongoId()
    @Type(() => Types.ObjectId)
    shippingId: Types.ObjectId;

    @IsString()
    firstName: string;

    @IsString()
    lastName: string;

    @IsOptional()
    depositReceipt?: { secure_url: string; public_id: string };
}

export class UpdateStatusDTO {
    @IsEnum(OrderStatus)
    status: OrderStatus;
}

export class UpdateDepositDTO {
    @IsNumber()
    @Min(0)
    deposit: number;
}