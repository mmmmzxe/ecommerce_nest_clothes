import { MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument } from 'mongoose';

@Schema({ timestamps: true })
export class WhatsAppSettings {
  @Prop({ type: String, default: '' })
  accountUniqueId: string;

  @Prop({ type: String, default: '' })
  apiSecret: string;

  @Prop({ type: String, default: 'https://hashtagmarketing.agency/api' })
  apiBaseUrl: string;

  @Prop({ type: String, default: '' })
  webhookSecret: string;

  @Prop({ type: String, default: '' })
  botPhone: string;

  @Prop({ type: String, default: '' })
  instapayPhone: string;

  @Prop({ type: String, default: '' })
  vodafonePhone: string;

  @Prop({ type: Boolean, default: true })
  isEnabled: boolean;

  @Prop({ type: Boolean, default: true })
  autoSendOrderConfirmation: boolean;
}

export const whatsappSettingsSchema = SchemaFactory.createForClass(WhatsAppSettings);

export type typeWhatsAppSettings = HydratedDocument<WhatsAppSettings> & Document;

export const WhatsAppSettingsModel = MongooseModule.forFeature([
  { name: WhatsAppSettings.name, schema: whatsappSettingsSchema },
]);
