import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSocialOrderDto {
  // ─── Seller ─────────────────────────────────────────────────────────────────
  @IsEnum(['Fatma', 'Mariam', 'Zeinab'])
  @IsNotEmpty()
  createdBy: 'Fatma' | 'Mariam' | 'Zeinab';

  // ─── Product ─────────────────────────────────────────────────────────────────
  @IsString()
  @IsNotEmpty()
  productName: string;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  price: number;

  @IsString()
  @IsOptional()
  color?: string;

  @IsString()
  @IsOptional()
  size?: string;

  @IsNumber()
  @Min(1)
  @Type(() => Number)
  quantity: number;

  @IsString()
  @IsOptional()
  productNotes?: string;

  // ─── Customer / Delivery ─────────────────────────────────────────────────────
  @IsString()
  @IsNotEmpty()
  customerName: string;

  @IsString()
  @IsNotEmpty()
  customerPhone: string;

  @IsString()
  @IsNotEmpty()
  customerAddress: string;

  @IsString()
  @IsNotEmpty()
  city: string;

  @IsString()
  @IsOptional()
  deliveryNotes?: string;
}
