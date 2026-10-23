import { MongooseModule, Prop, raw, Schema, SchemaFactory } from '@nestjs/mongoose';
import { FlextockStatus } from 'src/Flextock/flextock.service';
import { Document, Types } from 'mongoose';

export type SellerName = 'Fatma' | 'Mariam' | 'Zeinab' | 'Sara';

export interface EditHistoryEntry {
  editedBy: string;
  editedByUserId?: Types.ObjectId;
  editedAt: Date;
  summary: string;
  previousState?: Record<string, any>;
}

// ─── Flextock Integration Tracking ──────────────────────────────────────────
export interface FlextockSubmission {
  status: FlextockStatus;
  submittedAt?: Date;
  flextockOrderCode?: string;
  lastError?: string;
  attempts: number;
  lastStatusNote?: string;
  lastSyncedAt?: Date;
}

@Schema({ timestamps: true })
export class SocialOrder {
  // ─── Seller Info ────────────────────────────────────────────────────────────
  @Prop({ type: String, enum: ['Fatma', 'Mariam', 'Zeinab', 'Sara'], required: true })
  createdBy: SellerName;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdByUserId: Types.ObjectId;

  // ─── Status ──────────────────────────────────────────────────────────────────
  @Prop({ type: String, enum: ['pending', 'confirmed', 'cancelled'], default: 'pending' })
  status: 'pending' | 'confirmed' | 'cancelled';

  // ─── Edit History Audit Log ──────────────────────────────────────────────────
  @Prop({
    type: [
      raw({
        editedBy: { type: String, required: true },
        editedByUserId: { type: Types.ObjectId, ref: 'User' },
        editedAt: { type: Date, default: Date.now },
        summary: { type: String, required: true },
        previousState: { type: Object },
      }),
    ],
    default: [],
  })
  editHistory: EditHistoryEntry[];

  // ─── Product Info ────────────────────────────────────────────────────────────
  @Prop({ type: String, required: true })
  productName: string;

  @Prop(
    raw({
      secure_url: { type: String, required: false },
      public_id: { type: String, required: false },
    }),
  )
  productImage?: { secure_url: string; public_id: string };

  @Prop({ type: Number, required: true })
  price: number;

  @Prop({ type: Number, required: false, default: 0 })
  deposit?: number;

  @Prop(
    raw({
      secure_url: { type: String, required: false },
      public_id: { type: String, required: false },
    }),
  )
  depositImage?: { secure_url: string; public_id: string };

  @Prop({ type: String, required: false })
  color?: string;

  @Prop({ type: String, required: false })
  size?: string;

  @Prop({ type: Number, required: true, min: 1 })
  quantity: number;

  @Prop({ type: String, required: false })
  productNotes?: string;

  // ─── Customer / Delivery Info ────────────────────────────────────────────────
  @Prop({ type: String, required: true })
  customerName: string;

  @Prop({ type: String, required: true })
  customerPhone: string;

  @Prop({ type: String, required: true })
  customerAddress: string;

  @Prop({ type: String, required: true })
  city: string;

  @Prop({ type: String, required: false })
  deliveryNotes?: string;

  // ─── Flextock Integration ────────────────────────────────────────────────────
  @Prop(
    raw({
      status: { type: String, enum: ['not_submitted', 'submitted', 'failed'], default: 'not_submitted' },
      submittedAt: { type: Date },
      flextockOrderCode: { type: String },
      lastError: { type: String },
      attempts: { type: Number, default: 0 },
      lastStatusNote: { type: String },
      lastSyncedAt: { type: Date },
    }),
  )
  flextockSubmission?: FlextockSubmission;
}

const socialOrderSchema = SchemaFactory.createForClass(SocialOrder);

export const SocialOrderModel = MongooseModule.forFeature([
  { name: SocialOrder.name, schema: socialOrderSchema },
]);

export type TypeSocialOrder = SocialOrder & Document;
