import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateWhatsAppSettingsDto {
  @IsOptional()
  @IsString()
  accountUniqueId?: string;

  @IsOptional()
  @IsString()
  apiSecret?: string;

  @IsOptional()
  @IsString()
  apiBaseUrl?: string;

  @IsOptional()
  @IsString()
  webhookSecret?: string;

  @IsOptional()
  @IsString()
  botPhone?: string;

  @IsOptional()
  @IsString()
  instapayPhone?: string;

  @IsOptional()
  @IsString()
  vodafonePhone?: string;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  autoSendOrderConfirmation?: boolean;
}

export class SendTestWhatsAppMessageDto {
  @IsString()
  recipient: string;

  @IsOptional()
  @IsString()
  message?: string;
}
