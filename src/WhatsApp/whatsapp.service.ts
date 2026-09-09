import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order } from 'src/DB/models/Order/order.model';
import { typeOrder } from 'src/DB/models/Order/order.model';
import { OrderStatus } from 'src/User/Order/order.interface';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { WhatsAppClient } from './whatsapp.client';
import {
  orderConfirmationRequestTemplate,
  getConfirmationButtons,
  depositRequestTemplate,
  depositConfirmedTemplate,
  depositReceiptReceivedTemplate,
  orderCancelledTemplate,
  orderAlreadyCancelledTemplate,
  orderAlreadyConfirmedTemplate,
  multipleOrdersTemplate,
  noOrderFoundTemplate,
  unknownCommandTemplate,
  OrderMessageData,
} from './whatsapp.templates';

// ─── Phone Normalization ──────────────────────────────────────────────────────

/**
 * Convert an Egyptian or E.164 phone number to E.164 (+20XXXXXXXXXX).
 * Strips all non-digit characters except leading '+'.
 * Handles formats: 01001234567 / +201001234567 / 00201001234567 / 201001234567 / 1001234567
 */
export function normalizeEgyptianPhone(raw: string): string | null {
  if (!raw) return null;
  let phone = raw.replace(/[\s\-().]/g, '');

  // Already E.164 with + prefix
  if (phone.startsWith('+')) {
    const digits = phone.slice(1).replace(/\D/g, '');
    return digits.length >= 10 ? `+${digits}` : null;
  }
  // International without + (0020...)
  if (phone.startsWith('00')) {
    const digits = phone.slice(2).replace(/\D/g, '');
    return `+${digits}`;
  }
  // Egyptian with country code (201...)
  if (phone.startsWith('20') && phone.length >= 12) {
    const digits = phone.replace(/\D/g, '');
    return `+${digits}`;
  }
  // Egyptian local starting with 0 (01...)
  if (phone.startsWith('0') && phone.length >= 11) {
    const digits = phone.replace(/\D/g, '');
    return `+20${digits.slice(1)}`;
  }
  // Bare number starting with 1 (Egyptian mobile, 10 digits)
  if (phone.startsWith('1') && phone.length === 10) {
    const digits = phone.replace(/\D/g, '');
    return `+20${digits}`;
  }

  const allDigits = phone.replace(/\D/g, '');
  if (allDigits.length >= 10) {
    return `+${allDigits}`;
  }
  return null;
}

// ─── Order Reference ──────────────────────────────────────────────────────────

/**
 * Generate a short, human-readable reference from a MongoDB ObjectId string.
 * Uses the last 6 hex characters uppercased.
 * Example: "ORD-A1B2C3"
 */
export function buildOrderRef(orderId: string): string {
  const hex = orderId.toString().slice(-6).toUpperCase();
  return `ORD-${hex}`;
}

/**
 * Extract a REF-XXXX pattern from an incoming WhatsApp message body.
 */
export function extractOrderRef(text: string): string | null {
  if (!text) return null;
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
   * Sends interactive button message (with fallback to text + wa.me links).
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
      const buttons = getConfirmationButtons(data);

      const result = await this.client.sendButtonMessage(
        phone,
        message,
        buttons,
        'Extra Chic Store',
        1,
      );
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
      this.logger.debug(`[handleIncomingMessage] raw payload keys: ${Object.keys(payload || {}).join(', ')}`);

      let messages: any[] = [];

      if (Array.isArray(payload)) {
        // Root-level array of messages
        messages = payload;
      } else if (Array.isArray(payload?.data)) {
        // Hashtag wraps in { data: [...] }
        messages = payload.data;
      } else if (payload?.data && typeof payload.data === 'object') {
        // Single message under { data: {...} }
        messages = [payload.data];
      } else if (payload?.account || payload?.phone || payload?.message !== undefined) {
        // Message object delivered directly at root level
        messages = [payload];
      } else {
        this.logger.warn('[handleIncomingMessage] Could not extract messages from payload, skipping.');
        return;
      }

      for (const msg of messages) {
        await this.processMessage(msg);
      }
    } catch (err) {
      this.logger.error('[handleIncomingMessage] Unhandled error:', err?.message ?? err);
    }
  }

  private async processMessage(msg: any): Promise<void> {
    // Hashtag received chat shape: { id, account (sender), message, attachment, ... }
    const rawPhone: string = msg?.account || msg?.phone || '';
    const body: string = (msg?.message || '').trim();
    const messageId: string = String(msg?.id || '');
    const attachmentUrl: string = (
      msg?.attachment ||
      msg?.media_url ||
      msg?.media ||
      msg?.file ||
      msg?.image ||
      msg?.url ||
      ''
    ).toString().trim();

    this.logger.log(`[processMessage] Inbound: rawPhone="${rawPhone}", body="${body}", attachment="${attachmentUrl}"`);

    if (!rawPhone || (!body && !attachmentUrl)) {
      this.logger.debug('[processMessage] Missing phone or payload content, skipping.');
      return;
    }

    const phone = normalizeEgyptianPhone(rawPhone);
    if (!phone) {
      this.logger.warn(`[processMessage] Could not normalize phone: "${rawPhone}"`);
      return;
    }

    const ref = extractOrderRef(body);
    const upper = body.toUpperCase();

    // 1. If an image/attachment is present -> it's the deposit receipt screenshot!
    if (attachmentUrl && attachmentUrl !== 'false') {
      this.logger.log(`[processMessage] Detected receipt screenshot from ${phone}: ${attachmentUrl}`);
      await this.handleDepositScreenshot(phone, attachmentUrl, ref, messageId);
      return;
    }

    // 2. Deposit confirmation keywords (Arabic & English)
    const isDepositConfirm =
      upper.startsWith('CONFIRM_DEPOSIT') ||
      upper.includes('تأكيد العربون') ||
      upper.includes('تاكيد العربون') ||
      upper.includes('تم التحويل') ||
      upper.includes('تم الدفع') ||
      upper.includes('دفعت') ||
      upper.includes('حولتم') ||
      upper.includes('حولت');

    // 3. Order cancel keywords (Arabic & English)
    const isOrderCancel =
      upper.trim() === '2' ||
      upper.startsWith('CANCEL') ||
      upper.includes('CANCEL') ||
      upper.includes('إلغاء') ||
      upper.includes('الغاء') ||
      upper.includes('يلغي') ||
      upper.includes('ملغي') ||
      upper.trim() === 'لا' ||
      upper.includes('مش عايز');

    // 4. Order confirmation keywords (Arabic & English)
    const isOrderConfirm =
      upper.trim() === '1' ||
      upper.startsWith('CONFIRM') ||
      upper.includes('CONFIRM') ||
      upper.includes('تأكيد') ||
      upper.includes('تاكيد') ||
      upper.includes('موافق') ||
      upper.includes('نعم') ||
      upper.trim() === 'تم' ||
      upper.includes('تمام') ||
      /^ORD-[A-F0-9]{6}$/i.test(body.trim());

    if (isDepositConfirm) {
      await this.handleDepositConfirm(phone, ref, messageId);
    } else if (isOrderCancel) {
      await this.handleOrderCancel(phone, ref, messageId);
    } else if (isOrderConfirm) {
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
   * Handle "CONFIRM [ref]" / "تأكيد [ref]" / "1" message.
   * If already pending_deposit, re-sends deposit instructions.
   */
  async handleOrderConfirm(phone: string, ref: string | null, messageId: string): Promise<void> {
    const order = await this.findEligibleOrder(
      phone,
      [OrderStatus.pending, OrderStatus.pending_deposit],
      ref,
    );
    if (!order) return;

    // If order was already confirmed and awaiting deposit, re-send deposit instructions
    if (order.status === OrderStatus.pending_deposit || order.whatsappConfirmation?.confirmedAt) {
      this.logger.log(`[handleOrderConfirm] Order ${order._id} already confirmed/pending_deposit, re-sending deposit request.`);
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
   * Handle "2" / "إلغاء" message — cancel the pending order.
   * Idempotent: if already cancelled, silently returns.
   */
  async handleOrderCancel(phone: string, ref: string | null, messageId: string): Promise<void> {
    let order = await this.findEligibleOrder(
      phone,
      [OrderStatus.pending, OrderStatus.pending_deposit],
      ref,
      true,
    );

    if (!order) {
      await this.safeSend(phone, noOrderFoundTemplate());
      return;
    }

    // Idempotency: already cancelled
    if (order.status === OrderStatus.cancelled) {
      this.logger.debug(`[handleOrderCancel] Order ${order._id} already cancelled, skipping.`);
      return;
    }

    order.status = OrderStatus.cancelled;
    (order as any).whatsappConfirmation = {
      ...(order.whatsappConfirmation || {}),
      cancelledVia: 'whatsapp',
      cancelledAt: new Date(),
      whatsappPhone: phone,
      whatsappMessageId: messageId,
    };
    await order.save();

    this.logger.log(`[handleOrderCancel] Order ${order._id} cancelled via WhatsApp by ${phone}`);

    const orderRef = buildOrderRef(String((order as any)._id));
    const customerName = order.firstName || 'عزيزي العميل';
    await this.safeSend(phone, orderCancelledTemplate(orderRef, customerName));
  }

  /**
   * Handle "CONFIRM_DEPOSIT [ref]" message.
   * Idempotent: if deposit already confirmed, silently returns.
   */
  async handleDepositConfirm(phone: string, ref: string | null, messageId: string): Promise<void> {
    const order = await this.findEligibleOrder(
      phone,
      [OrderStatus.pending_deposit, OrderStatus.pending],
      ref,
    );
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

  /**
   * Handle incoming deposit screenshot from WhatsApp.
   * Downloads image, stores it to local uploads/receipts, updates order.depositReceipt,
   * sets depositConfirmed: true, and notifies customer.
   */
  async handleDepositScreenshot(
    phone: string,
    imageUrl: string,
    ref: string | null,
    messageId: string,
  ): Promise<void> {
    let order = await this.findEligibleOrder(
      phone,
      [OrderStatus.pending_deposit, OrderStatus.pending],
      ref,
      true,
    );

    if (!order) {
      this.logger.warn(`[handleDepositScreenshot] No order awaiting deposit found for ${phone}`);
      await this.safeSend(phone, noOrderFoundTemplate());
      return;
    }

    try {
      const savedPath = await this.downloadAndSaveReceipt(imageUrl);

      order.depositReceipt = {
        secure_url: savedPath,
        public_id: savedPath,
      };
      order.status = OrderStatus.pending_deposit;
      (order as any).depositConfirmation = {
        depositConfirmed: true,
        confirmedVia: 'whatsapp',
        confirmedAt: new Date(),
        whatsappMessageId: messageId,
      };

      // Also ensure whatsappConfirmation is marked if not already
      if (!order.whatsappConfirmation?.confirmedAt) {
        (order as any).whatsappConfirmation = {
          confirmedVia: 'whatsapp',
          confirmedAt: new Date(),
          whatsappPhone: phone,
          whatsappMessageId: messageId,
        };
      }

      await order.save();

      this.logger.log(`[handleDepositScreenshot] Successfully saved deposit receipt for order ${order._id}: ${savedPath}`);

      const orderRef = buildOrderRef(String((order as any)._id));
      const customerName = order.firstName || 'عزيزي العميل';
      await this.safeSend(phone, depositReceiptReceivedTemplate(orderRef, customerName));
    } catch (err) {
      this.logger.error(`[handleDepositScreenshot] Failed to download or save receipt for order ${order._id}:`, err);
    }
  }

  /**
   * Download receipt from remote WhatsApp URL and save to local uploads/receipts/
   */
  private async downloadAndSaveReceipt(imageUrl: string): Promise<string> {
    if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
      return imageUrl;
    }

    const receiptsDir = join(process.cwd(), 'uploads', 'receipts');
    if (!existsSync(receiptsDir)) {
      mkdirSync(receiptsDir, { recursive: true });
    }

    const extMatch = imageUrl.split('?')[0].match(/\.(jpg|jpeg|png|webp|gif|pdf)$/i);
    const ext = extMatch ? extMatch[1] : 'jpg';
    const filename = `wa_receipt_${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
    const filePath = join(receiptsDir, filename);

    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      throw new Error(`Failed to download receipt image: HTTP ${res.status}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    writeFileSync(filePath, buffer);

    return `/api/uploads/receipts/${filename}`;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Find the correct order for a given phone + status (or statuses).
   * 1. If ref is provided, looks up order directly by ObjectId 6-char hex suffix.
   * 2. Otherwise searches by phone (all candidate formats + regex).
   */
  private async findEligibleOrder(
    phone: string,
    status: OrderStatus | OrderStatus[],
    ref: string | null,
    silent = false,
  ): Promise<typeOrder | null> {
    const statusArray = Array.isArray(status) ? status : [status];

    // 1. If ref is provided (e.g. ORD-F7FDB7), match directly by ObjectId suffix
    if (ref) {
      const suffix = ref.replace('ORD-', '').trim().toUpperCase();
      const allOrders = await this.orderModel
        .find({})
        .sort({ createdAt: -1 })
        .limit(100)
        .exec();

      const matchedByRef = allOrders.find((o) =>
        String((o as any)._id).toUpperCase().endsWith(suffix),
      );

      if (matchedByRef) {
        if (statusArray.includes(matchedByRef.status)) {
          return matchedByRef;
        }
        if (matchedByRef.status === OrderStatus.cancelled) {
          if (!silent) {
            this.logger.log(`[findEligibleOrder] Order ${ref} is already cancelled.`);
            await this.safeSend(phone, orderAlreadyCancelledTemplate(ref));
          }
          return null;
        }
        if (
          matchedByRef.status === OrderStatus.placed ||
          matchedByRef.status === OrderStatus.onWay ||
          matchedByRef.status === OrderStatus.delivered
        ) {
          if (!silent) {
            this.logger.log(`[findEligibleOrder] Order ${ref} is already active/completed (${matchedByRef.status}).`);
            await this.safeSend(phone, orderAlreadyConfirmedTemplate(ref));
          }
          return null;
        }
      }
    }

    // 2. Search by phone conditions
    const possiblePhones = this.phoneCandidates(phone);
    const rawDigits = phone.replace(/\D/g, '');
    const last9 = rawDigits.slice(-9);

    const phoneConditions: any[] = [{ phone: { $in: possiblePhones } }];
    if (last9.length === 9) {
      phoneConditions.push({ phone: { $regex: last9 } });
    }

    const orders = await this.orderModel
      .find({
        $or: phoneConditions,
        status: { $in: statusArray },
      })
      .sort({ createdAt: -1 })
      .exec();

    if (orders.length === 0) {
      if (!silent) {
        this.logger.warn(`[findEligibleOrder] No order with status [${statusArray.join(', ')}] found for phone ${phone}`);
        await this.safeSend(phone, noOrderFoundTemplate());
      }
      return null;
    }

    if (ref) {
      const suffix = ref.replace('ORD-', '').trim().toUpperCase();
      const matched = orders.find((o) => String((o as any)._id).toUpperCase().endsWith(suffix));
      if (!matched) {
        if (!silent) {
          this.logger.warn(`[findEligibleOrder] Ref ${ref} not found among ${orders.length} orders for ${phone}`);
          await this.safeSend(phone, noOrderFoundTemplate());
        }
        return null;
      }
      return matched;
    }

    // No ref provided and exactly 1 order
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
   * Covers E.164 (+20...), local Egyptian (01...), bare digits, 0020... formats.
   */
  private phoneCandidates(e164: string): string[] {
    const rawDigits = e164.replace(/\D/g, '');
    const list = new Set<string>();

    list.add(e164);
    if (rawDigits) {
      list.add(rawDigits);
      list.add(`+${rawDigits}`);
      // If Egyptian (country code 20)
      if (rawDigits.startsWith('20') && rawDigits.length >= 12) {
        const local = '0' + rawDigits.slice(2);
        list.add(local);
        list.add(`+20${rawDigits.slice(2)}`);
        list.add(`0020${rawDigits.slice(2)}`);
        list.add(rawDigits.slice(2)); // bare 10 digits
      }
      // If starts with 0 (local 01...)
      if (rawDigits.startsWith('0') && rawDigits.length >= 11) {
        list.add(`+20${rawDigits.slice(1)}`);
        list.add(`20${rawDigits.slice(1)}`);
        list.add(`0020${rawDigits.slice(1)}`);
        list.add(rawDigits.slice(1)); // bare 10 digits
      }
    }

    return Array.from(list);
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
