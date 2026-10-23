import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as https from 'https';
import * as http from 'http';
import * as url from 'url';

// ─── Flextock API constants (never exposed to frontend) ──────────────────────
const FLEXTOCK_BASE_URL = 'https://api.flextock.com';
const AUTH_ENDPOINT = '/base/auth/';
const CREATE_ORDER_ENDPOINT = '/external-integration/create-order/';
const ORDER_STATUS_ENDPOINT = '/external-integration/order-status/';
const INTEGRATION_SOURCE = 'Extrachic';

// ─── Token cache ─────────────────────────────────────────────────────────────
interface TokenCache {
  accessToken: string;
  /** Expire 5 minutes before the actual JWT expiry to avoid race conditions */
  expiresAt: number;
}
let tokenCache: TokenCache | null = null;

// ─── Flextock order payload ───────────────────────────────────────────────────
export interface FlextockOrderPayload {
  order_code: string;
  order_date: string;          // YYYY-MM-DD
  shipping_fees?: number;
  is_free_shipping?: boolean;
  is_gift_order?: boolean;
  order_currency?: string;
  integration_source: string;
  vendor_name?: string;
  customer_address: {
    country?: string;
    city: string;
    area?: string;
    address_line1: string;
    address_line2?: string;
    building_no?: string;
    floor_no?: string;
    apartment_no?: string;
    is_work_address?: boolean;
    first_name: string;
    last_name?: string;
    phone_number: string;
    secondary_phone_number?: string;
    note?: string;
  };
  line_items: {
    sku_code: string;
    quantity: number;
    sku_price: number;
    sku_promotional_price?: number | null;
  }[];
  extra_fees?: { name: string; value: number }[];
  payment_data?: {
    value: number;
    payment_type: 'cash_on_delivery' | 'prepaid';
    payment_method?: string;
    payment_reference?: string;
    payment_timestamp?: string;
  }[];
  discounts_data?: {
    value: number;
    discount_type: string;
    discount_code?: string;
  }[];
  requires_self_delivery?: boolean;
}

// ─── Flextock submission result stored on the order ──────────────────────────
export type FlextockStatus = 'not_submitted' | 'submitted' | 'failed';

export interface FlextockSubmission {
  status: FlextockStatus;
  submittedAt?: Date;
  flextockOrderCode?: string;
  lastError?: string;
  attempts: number;
}

@Injectable()
export class FlextockService {
  private readonly logger = new Logger(FlextockService.name);

  // ─── Authenticate & obtain an access token ──────────────────────────────
  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid
    if (tokenCache && Date.now() < tokenCache.expiresAt) {
      return tokenCache.accessToken;
    }

    const username = process.env.FLEXTOCK_USERNAME || 'Extrachic';
    const password = process.env.FLEXTOCK_PASSWORD || 'Extrachic!!@@';
    const key = process.env.FLEXTOCK_API_KEY || 'NcFGQuop.BheGyBpjqGZxIXUVcws7XB26fiX2iZw2';

    if (!username || !password || !key) {
      throw new Error(
        'Flextock credentials are not configured. Set FLEXTOCK_USERNAME, FLEXTOCK_PASSWORD and FLEXTOCK_API_KEY.',
      );
    }

    const body = JSON.stringify({ username, password, key });
    const result = await this.httpPost<{ access: string; refresh: string }>(
      `${FLEXTOCK_BASE_URL}${AUTH_ENDPOINT}`,
      body,
    );

    if (!result?.access) {
      throw new Error('Flextock authentication did not return an access token.');
    }

    // Decode JWT expiry (JWT payload is base64url)
    let expiresAt = Date.now() + 60 * 60 * 1000; // default 1 hour
    try {
      const payload = JSON.parse(
        Buffer.from(result.access.split('.')[1], 'base64url').toString('utf8'),
      );
      if (payload?.exp) {
        // Subtract 5 minutes as a safety margin
        expiresAt = payload.exp * 1000 - 5 * 60 * 1000;
      }
    } catch {
      // keep the default
    }

    tokenCache = { accessToken: result.access, expiresAt };
    this.logger.log('Flextock access token obtained and cached.');
    return result.access;
  }

  // ─── Submit an order to Flextock (supports regular Order and SocialOrder) ──
  /**
   * Builds the Flextock payload from an Order or SocialOrder document and calls
   * the create-order endpoint. Returns the Flextock order code on success or throws.
   */
  async submitOrder(orderDoc: any): Promise<string> {
    const orderId = orderDoc._id.toString();

    // Deterministic, unique order_code from MongoDB _id
    const orderCode = `EXC-${orderId}`;

    // Helper to build a clean SKU code
    const buildSkuCode = (name: string): string =>
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'item';

    let lineItems: FlextockOrderPayload['line_items'] = [];
    let firstName = 'Customer';
    let lastName: string | undefined = undefined;
    let phone = '';
    let addressLine1 = '';
    let city = 'Cairo';
    let deliveryNote: string | undefined = undefined;
    let isPrepaid = false;
    let deposit = Number(orderDoc.deposit) || 0;
    let finalAmount = Number(orderDoc.finalPrice) || 0;

    // Detect if this is a regular Order (from cart/website) or a SocialOrder
    const isRegularOrder = Boolean(
      orderDoc.phone || orderDoc.address || (Array.isArray(orderDoc.products) && orderDoc.products[0]?.productId)
    );

    if (isRegularOrder && orderDoc.products && Array.isArray(orderDoc.products) && orderDoc.products.length > 0 && orderDoc.products[0]?.productId) {
      // ── Regular Order Mapping ──────────────────────────────────────────
      firstName = orderDoc.firstName || 'Customer';
      lastName = orderDoc.lastName || undefined;
      phone = orderDoc.phone || '';
      addressLine1 = orderDoc.address || '';
      deliveryNote = orderDoc.note || undefined;

      // Check if government / city is in populated shippingId
      if (orderDoc.shippingId && typeof orderDoc.shippingId === 'object' && orderDoc.shippingId.government) {
        city = orderDoc.shippingId.government;
      } else if (orderDoc.city) {
        city = orderDoc.city;
      }

      isPrepaid = orderDoc.paymentWay === 'card' || Boolean(orderDoc.paidAt);

      for (const prod of orderDoc.products) {
        let sku = buildSkuCode(prod.name || 'product');
        if (prod.variant?.color) sku += `-${buildSkuCode(prod.variant.color)}`;
        if (prod.variant?.size) sku += `-${buildSkuCode(prod.variant.size)}`;

        lineItems.push({
          sku_code: sku,
          quantity: Number(prod.quantity) || 1,
          sku_price: Number(prod.unitPrice) || Number(prod.finalPrice) || 0,
          sku_promotional_price: null,
        });
      }
    } else if (Array.isArray(orderDoc.products) && orderDoc.products.length > 0) {
      // ── SocialOrder Multi-product Schema ──────────────────────────────
      const fullName = (orderDoc.customerName || '').trim();
      const parts = fullName.split(/\s+/);
      firstName = parts[0] || fullName || 'Customer';
      lastName = parts.slice(1).join(' ') || undefined;
      phone = orderDoc.customerPhone || '';
      addressLine1 = orderDoc.customerAddress || '';
      city = orderDoc.city || 'Cairo';
      deliveryNote = orderDoc.deliveryNotes || undefined;

      for (const product of orderDoc.products) {
        const baseSku = buildSkuCode(product.productName || 'product');
        const totalQty = (product.variants || []).reduce(
          (s: number, v: any) => s + (Number(v.quantity) || 0),
          0,
        );
        if (totalQty < 1) continue;
        lineItems.push({
          sku_code: baseSku,
          quantity: totalQty,
          sku_price: Number(product.price) || 0,
          sku_promotional_price: null,
        });
      }
    } else {
      // ── SocialOrder Legacy Flat Fields ─────────────────────────────────
      const fullName = (orderDoc.customerName || '').trim();
      const parts = fullName.split(/\s+/);
      firstName = parts[0] || fullName || 'Customer';
      lastName = parts.slice(1).join(' ') || undefined;
      phone = orderDoc.customerPhone || '';
      addressLine1 = orderDoc.customerAddress || '';
      city = orderDoc.city || 'Cairo';
      deliveryNote = orderDoc.deliveryNotes || undefined;

      lineItems = [
        {
          sku_code: buildSkuCode(orderDoc.productName || 'product'),
          quantity: Number(orderDoc.quantity) || 1,
          sku_price: Number(orderDoc.price) || 0,
          sku_promotional_price: null,
        },
      ];
    }

    if (lineItems.length === 0) {
      throw new Error('Order has no valid line items to submit to Flextock.');
    }

    // ── Build order date ──────────────────────────────────────────────────
    const orderDate = orderDoc.createdAt
      ? new Date(orderDoc.createdAt).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    // ── Calculate COD / Payment amount ───────────────────────────────────
    const lineTotal = lineItems.reduce((sum, i) => sum + i.sku_price * i.quantity, 0);
    const orderTotal = finalAmount > 0 ? finalAmount : lineTotal;
    const codAmount = isPrepaid ? 0 : Math.max(orderTotal - deposit, 0);

    const paymentData: FlextockOrderPayload['payment_data'] = isPrepaid
      ? [
          {
            value: orderTotal,
            payment_type: 'prepaid',
            payment_method: orderDoc.paymentWay || 'card',
          },
        ]
      : [
          {
            value: codAmount,
            payment_type: 'cash_on_delivery',
          },
        ];

    const payload: FlextockOrderPayload = {
      order_code: orderCode,
      order_date: orderDate,
      shipping_fees: 0,
      is_free_shipping: true,
      is_gift_order: false,
      order_currency: 'EGP',
      integration_source: INTEGRATION_SOURCE,
      vendor_name: INTEGRATION_SOURCE,
      customer_address: {
        country: 'Egypt',
        city: city || 'Cairo',
        area: city || undefined,
        address_line1: addressLine1 || 'Cairo, Egypt',
        address_line2: deliveryNote || undefined,
        first_name: firstName,
        last_name: lastName,
        phone_number: phone || '',
        note: deliveryNote || undefined,
      },
      line_items: lineItems,
      payment_data: paymentData,
      requires_self_delivery: false,
    };

    const token = await this.getAccessToken();
    const body = JSON.stringify(payload);

    const rawResponse = await this.httpPost<any>(
      `${FLEXTOCK_BASE_URL}${CREATE_ORDER_ENDPOINT}`,
      body,
      token,
    );

    this.logger.log(
      `Flextock order submitted. order_code=${orderCode} response=${JSON.stringify(rawResponse)}`,
    );

    // The API returns { message: "Order created successfully." } on success
    return orderCode;
  }

  // ─── Get order status from Flextock ────────────────────────────────────
  async getOrderStatus(
    orderCode: string,
  ): Promise<{ order_status: string; courier_name?: string; tracking_number?: string; tracking_url?: string } | null> {
    try {
      const token = await this.getAccessToken();
      const body = JSON.stringify({ order_code: orderCode });
      const result = await this.httpPost<any>(
        `${FLEXTOCK_BASE_URL}${ORDER_STATUS_ENDPOINT}`,
        body,
        token,
      );
      return result ?? null;
    } catch (error: any) {
      this.logger.warn(`Could not fetch status for ${orderCode}: ${error.message}`);
      return null;
    }
  }

  // ─── Generic HTTPS POST helper ──────────────────────────────────────────
  private httpPost<T>(
    targetUrl: string,
    body: string,
    bearerToken?: string,
    timeoutMs = 15_000,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const parsed = url.parse(targetUrl);
      const isHttps = parsed.protocol === 'https:';
      const transport = isHttps ? https : http;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body).toString(),
        Accept: 'application/json',
      };
      if (bearerToken) {
        headers['Authorization'] = `Bearer ${bearerToken}`;
      }

      const options: https.RequestOptions = {
        hostname: parsed.hostname!,
        port: parsed.port ? parseInt(parsed.port) : isHttps ? 443 : 80,
        path: parsed.path!,
        method: 'POST',
        headers,
      };

      const req = transport.request(options, (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          try {
            const parsed = JSON.parse(raw);
            if (status >= 200 && status < 300) {
              resolve(parsed as T);
            } else {
              const msg =
                parsed?.message ||
                parsed?.detail ||
                JSON.stringify(parsed) ||
                `HTTP ${status}`;
              reject(new Error(`Flextock API error (${status}): ${msg}`));
            }
          } catch {
            if (status >= 200 && status < 300) {
              resolve(raw as unknown as T);
            } else {
              reject(new Error(`Flextock API error (${status}): ${raw}`));
            }
          }
        });
      });

      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`Flextock request timed out after ${timeoutMs}ms`));
      });

      req.on('error', (err) => reject(err));
      req.write(body);
      req.end();
    });
  }
}
