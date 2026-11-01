import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSocialOrderDto {
  // ─── Seller ─────────────────────────────────────────────────────────────────
  @IsEnum(['Fatma', 'Mariam', 'Zeinab', 'Sara'])
  @IsNotEmpty()
  createdBy: 'Fatma' | 'Mariam' | 'Zeinab' | 'Sara';

  // ─── Products (New Multi-product Array or JSON string) ───────────────────────
  @IsOptional()
  products?: any;

  // ─── Legacy Flat Fields (Optional for backward compatibility) ────────────────
  @IsString()
  @IsOptional()
  productName?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  price?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  deposit?: number;

  @IsString()
  @IsOptional()
  color?: string;

  @IsString()
  @IsOptional()
  size?: string;

  @IsNumber()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  quantity?: number;

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
