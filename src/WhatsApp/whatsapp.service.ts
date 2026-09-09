import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order } from 'src/DB/models/Order/order.model';
import { typeOrder } from 'src/DB/models/Order/order.model';
import { OrderStatus } from 'src/User/Order/order.interface';
import { WhatsAppClient } from './whatsapp.client';
import {
  orderConfirmationRequestTemplate,
  depositRequestTemplate,
  depositConfirmedTemplate,
  multipleOrdersTemplate,
  noOrderFoundTemplate,
  unknownCommandTemplate,
  OrderMessageData,
} from './whatsapp.templates';

// ─── Phone Normalization ──────────────────────────────────────────────────────

/**
 * Convert an Egyptian or E.164 phone number to E.164 (+20XXXXXXXXXX).
 * Strips spaces, dashes, and parentheses.
 * Handles formats: 01001234567 / +201001234567 / 00201001234567
 */
export function normalizeEgyptianPhone(raw: string): string | null {
  if (!raw) return null;
  let phone = raw.replace(/[\s\-().]/g, '');

  // Already E.164 with + prefix
  if (phone.startsWith('+')) {
    return phone.length >= 10 ? phone : null;
  }
  // International without + (0020...)
  if (phone.startsWith('00')) {
    return '+' + phone.slice(2);
  }
  // Egyptian local starting with 0 (01...)
  if (phone.startsWith('0')) {
    return '+20' + phone.slice(1);
  }
  // Bare number starting with 1 (Egyptian mobile)
  if (phone.startsWith('1') && phone.length === 10) {
    return '+20' + phone;
  }
  return null;
}

// ─── Order Reference ──────────────────────────────────────────────────────────

/**
 * Generate a short, human-readable reference from a MongoDB ObjectId string.
 * Uses the last 6 hex characters uppercased — collision probability is negligible
 * within the active order window.
 * Example: "ORD-A1B2C3"
 */
export function buildOrderRef(orderId: string): string {
  const hex = orderId.toString().slice(-6).toUpperCase();
  return `ORD-${hex}`;
}

/**
 * Extract a REF-XXXX pattern from an incoming WhatsApp message body.
 */
function extractOrderRef(text: string): string | null {
  const match = text.match(/ORD-([A-F0-9]{6})/i);
  return match ? `ORD-${match[1].toUpperCase()}` : null;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly client = new WhatsAppClient();

  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<typeOrder>,
  ) {}

  // ──────────────────────────────────────────────────────────────────────────
  // OUTBOUND
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Called after a new order is successfully created.
   * Fire-and-forget: failures are logged but never re-thrown.
   */
  async sendOrderConfirmationMessage(order: typeOrder): Promise<void> {
    try {
      const rawPhone = order.phone;
      const phone = normalizeEgyptianPhone(rawPhone);
      if (!phone) {
        this.logger.warn(`[sendOrderConfirmationMessage] Invalid phone on order ${order._id}: "${rawPhone}"`);
        return;
      }

      const orderRef = buildOrderRef(String((order as any)._id));
      const items = (order.products || []).map((p) => ({ name: p.name, quantity: p.quantity }));
      const data: OrderMessageData = {
        orderRef,
        customerName: order.firstName || 'عزيزي العميل',
        totalEGP: order.finalPrice,
        items,
        depositAmountEGP: order.deposit ?? 0,
      };

      const message = orderConfirmationRequestTemplate(data);
      const result = await this.client.sendTextMessage(phone, message, 1);
      this.logger.log(`[sendOrderConfirmationMessage] Sent to ${phone}, ref=${orderRef}, result=${JSON.stringify(result?.status)}`);
    } catch (err) {
      this.logger.error(`[sendOrderConfirmationMessage] Failed for order ${order._id}:`, err?.message ?? err);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // INBOUND — Webhook dispatcher
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Entry point for all incoming WhatsApp messages from the Hashtag webhook.
   * Extracts phone + body from the Hashtag payload and dispatches.
   */
  async handleIncomingMessage(payload: any): Promise<void> {
    try {
      // Hashtag webhook delivers an array under `data` or a single object
      const messages: any[] = Array.isArray(payload?.data)
        ? payload.data
        : payload?.data
        ? [payload.data]
        : [];

      for (const msg of messages) {
        await this.processMessage(msg);
      }
    } catch (err) {
      this.logger.error('[handleIncomingMessage] Unhandled error:', err?.message ?? err);
    }
  }

  private async processMessage(msg: any): Promise<void> {
    // Hashtag received chat shape: { id, account (sender), message, ... }
    const rawPhone: string = msg?.account || msg?.phone || '';
    const body: string = (msg?.message || '').trim();
    const messageId: string = String(msg?.id || '');

    if (!rawPhone || !body) {
      this.logger.debug('[processMessage] Missing phone or body, skipping.');
      return;
    }

    const phone = normalizeEgyptianPhone(rawPhone);
    if (!phone) {
      this.logger.warn(`[processMessage] Could not normalize phone: "${rawPhone}"`);
      return;
    }

    const upper = body.toUpperCase();

    if (upper.startsWith('CONFIRM_DEPOSIT')) {
      const ref = extractOrderRef(body);
      await this.handleDepositConfirm(phone, ref, messageId);
    } else if (upper.startsWith('CONFIRM')) {
      const ref = extractOrderRef(body);
      await this.handleOrderConfirm(phone, ref, messageId);
    } else {
      this.logger.debug(`[processMessage] Unrecognised command from ${phone}: "${body.slice(0, 50)}"`);
      await this.safeSend(phone, unknownCommandTemplate());
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // INBOUND handlers
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Handle "CONFIRM [ref]" message.
   * Idempotent: if order already confirmed, silently returns.
   */
  async handleOrderConfirm(phone: string, ref: string | null, messageId: string): Promise<void> {
    const order = await this.findEligibleOrder(phone, OrderStatus.pending, ref);
    if (!order) return;

    // Idempotency: already confirmed
    if (order.whatsappConfirmation?.confirmedAt) {
      this.logger.debug(`[handleOrderConfirm] Order ${order._id} already confirmed, skipping.`);
      return;
    }

    // Update order status + store confirmation metadata
    order.status = OrderStatus.pending_deposit;
    (order as any).whatsappConfirmation = {
      confirmedVia: 'whatsapp',
      confirmedAt: new Date(),
      whatsappPhone: phone,
      whatsappMessageId: messageId,
    };
    await order.save();

    this.logger.log(`[handleOrderConfirm] Order ${order._id} confirmed via WhatsApp by ${phone}`);

    // Send deposit request
    const orderRef = buildOrderRef(String((order as any)._id));
    const items = (order.products || []).map((p) => ({ name: p.name, quantity: p.quantity }));
    const data: OrderMessageData = {
      orderRef,
      customerName: order.firstName || 'عزيزي العميل',
      totalEGP: order.finalPrice,
      items,
      depositAmountEGP: order.deposit ?? 0,
    };
    await this.safeSend(phone, depositRequestTemplate(data));
  }

  /**
   * Handle "CONFIRM_DEPOSIT [ref]" message.
   * Idempotent: if deposit already confirmed, silently returns.
   */
  async handleDepositConfirm(phone: string, ref: string | null, messageId: string): Promise<void> {
    const order = await this.findEligibleOrder(phone, OrderStatus.pending_deposit, ref);
    if (!order) return;

    // Idempotency: already deposit-confirmed
    if ((order as any).depositConfirmation?.depositConfirmed === true) {
      this.logger.debug(`[handleDepositConfirm] Order ${order._id} deposit already confirmed, skipping.`);
      return;
    }

    (order as any).depositConfirmation = {
      depositConfirmed: true,
      confirmedVia: 'whatsapp',
      confirmedAt: new Date(),
      whatsappMessageId: messageId,
    };
    await order.save();

    this.logger.log(`[handleDepositConfirm] Deposit confirmed for order ${order._id} via WhatsApp by ${phone}`);

    const orderRef = buildOrderRef(String((order as any)._id));
    const customerName = order.firstName || 'عزيزي العميل';
    await this.safeSend(phone, depositConfirmedTemplate(orderRef, customerName));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Find the correct pending order for a given phone + status.
   * If a ref is provided, match it against the order ObjectId suffix.
   * If multiple orders exist without a ref, prompt the user to specify.
   * Returns null if nothing actionable is found (after sending an appropriate reply).
   */
  private async findEligibleOrder(
    phone: string,
    status: OrderStatus,
    ref: string | null,
  ): Promise<typeOrder | null> {
    // Normalize phone variants to search against stored phone values
    // The DB may store local (01...) or E.164 (+20...)
    const possiblePhones = this.phoneCandidates(phone);

    const orders = await this.orderModel
      .find({ phone: { $in: possiblePhones }, status })
      .sort({ createdAt: -1 })
      .exec();

    if (orders.length === 0) {
      this.logger.warn(`[findEligibleOrder] No ${status} order found for phone ${phone}`);
      await this.safeSend(phone, noOrderFoundTemplate());
      return null;
    }

    if (ref) {
      // Match by last 6 hex chars of ObjectId
      const suffix = ref.replace('ORD-', '').toUpperCase();
      const matched = orders.find((o) => String((o as any)._id).toUpperCase().endsWith(suffix));
      if (!matched) {
        this.logger.warn(`[findEligibleOrder] Ref ${ref} not found among ${orders.length} orders for ${phone}`);
        await this.safeSend(phone, noOrderFoundTemplate());
        return null;
      }
      return matched;
    }

    // No ref provided
    if (orders.length === 1) {
      return orders[0];
    }

    // Multiple orders — ask customer to specify
    const refs = orders.map((o) => buildOrderRef(String((o as any)._id)));
    await this.safeSend(phone, multipleOrdersTemplate(refs));
    return null;
  }

  /**
   * Build phone number variants to search in DB.
   * Covers E.164 (+20...) and local Egyptian (01...) formats.
   */
  private phoneCandidates(e164: string): string[] {
    const candidates: string[] = [e164];
    if (e164.startsWith('+20')) {
      candidates.push('0' + e164.slice(3)); // 01XXXXXXXXX
    }
    return candidates;
  }

  /**
   * Send a message and swallow errors (always logs).
   */
  private async safeSend(phone: string, message: string): Promise<void> {
    try {
      await this.client.sendTextMessage(phone, message, 1);
    } catch (err) {
      this.logger.error(`[safeSend] Failed to send to ${phone}:`, err?.message ?? err);
    }
  }
}
