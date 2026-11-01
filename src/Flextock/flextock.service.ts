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

// ─── Flextock product payload ─────────────────────────────────────────────────
export interface FlextockProductPayload {
  sku_code: string;
  sku_name: string;
  sku_description?: string;
  sku_image_url: string;
  price: number;
  merchant_promotional_price?: number;
}

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
    area: string;
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

    const username =
      process.env.FLEXTOCK_USERNAME ||
      process.env.EXTRACHIC_USER ||
      'Extrachic';
    const password =
      process.env.FLEXTOCK_PASSWORD ||
      process.env.EXTRACHIC_PASS ||
      'Extrachic!!@@';
    const key =
      process.env.FLEXTOCK_API_KEY ||
      process.env.EXTRACHIC_API_KEY ||
      'NcFGQuop.BheGyBpjqGZxIXUVcws7XB26fiX2iZw2';

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

  // ─── Ensure product SKUs exist in Flextock before submitting orders ──────
  async ensureProductsExist(products: FlextockProductPayload[]): Promise<void> {
    if (!products || products.length === 0) return;

    try {
      const token = await this.getAccessToken();
      const uniqueSkus = new Map<string, FlextockProductPayload>();
      for (const p of products) {
        if (!uniqueSkus.has(p.sku_code)) {
          uniqueSkus.set(p.sku_code, p);
        }
      }

      const payload = {
        products: Array.from(uniqueSkus.values()).map((p) => {
          let sku = p.sku_code || 'item';
          if (sku.length < 3) sku = `sku-${sku}`;

          let name = (p.sku_name || sku).trim();
          if (name.length < 3) name = `${name} item`;

          let desc = (p.sku_description || name).trim();
          if (desc.length < 3) desc = `${desc} product`;

          return {
            sku_code: sku,
            sku_name: name.slice(0, 100),
            sku_description: desc.slice(0, 255),
            sku_image_url:
              p.sku_image_url ||
              'https://res.cloudinary.com/dj9oy80mc/image/upload/v1/logo.png',
            price: p.price > 0 ? p.price : 1,
          };
        }),
      };

      const result = await this.httpPost<any>(
        `${FLEXTOCK_BASE_URL}/external-integration/create-products/`,
        JSON.stringify(payload),
        token,
      );
      this.logger.log(`ensureProductsExist completed: ${JSON.stringify(result)}`);
    } catch (err: any) {
      this.logger.warn(`Could not pre-create products on Flextock: ${err?.message || err}`);
    }
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

    // Helper to build a clean SKU code (must be at least 3 characters for Flextock)
    const buildSkuCode = (name: string): string => {
      let code = (name || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50);

      if (!code) {
        // If empty or non-ascii (e.g. Arabic), generate stable alphanumeric code
        const hash = Buffer.from(name || 'product').toString('hex').slice(0, 8);
        code = `prod-${hash}`;
      } else if (code.length < 3) {
        code = `sku-${code}`;
      }
      return code;
    };

    let lineItems: FlextockOrderPayload['line_items'] = [];
    const skuMetaList: FlextockProductPayload[] = [];
    let firstName = 'Customer';
    let lastName: string | undefined = undefined;
    let phone = '';
    let addressLine1 = '';
    let city = 'Cairo';
    let area = '';
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
      // Try to get name from order first, then from populated createdBy user
      if (orderDoc.firstName) {
        firstName = orderDoc.firstName;
        lastName = orderDoc.lastName || undefined;
      } else if (orderDoc.createdBy && typeof orderDoc.createdBy === 'object' && orderDoc.createdBy.name) {
        const nameParts = orderDoc.createdBy.name.trim().split(/\s+/);
        firstName = nameParts[0] || 'Customer';
        lastName = nameParts.slice(1).join(' ') || undefined;
      }

      phone = orderDoc.phone || '';
      addressLine1 = orderDoc.address || '';
      deliveryNote = orderDoc.note || undefined;

      // Check if government / city is in populated shippingId
      if (orderDoc.shippingId && typeof orderDoc.shippingId === 'object' && orderDoc.shippingId.government) {
        city = orderDoc.shippingId.government;
        area = orderDoc.shippingId.government;
      } else if (orderDoc.city) {
        city = orderDoc.city;
        area = orderDoc.city;
      }

      isPrepaid = orderDoc.paymentWay === 'card' || Boolean(orderDoc.paidAt);

      for (const prod of orderDoc.products) {
        let sku = buildSkuCode(prod.name || 'product');
        let variantDesc = '';
        if (prod.variant?.color) {
          sku += `-${buildSkuCode(prod.variant.color)}`;
          variantDesc += `Color: ${prod.variant.color}`;
        }
        if (prod.variant?.size) {
          sku += `-${buildSkuCode(prod.variant.size)}`;
          variantDesc += variantDesc ? ` / Size: ${prod.variant.size}` : `Size: ${prod.variant.size}`;
        }

        const skuName = variantDesc ? `${prod.name} (${variantDesc})` : prod.name || sku;
        const price = Number(prod.unitPrice) || Number(prod.finalPrice) || 0;
        const imageUrl =
          prod.productId?.mainImage?.secure_url ||
          'https://res.cloudinary.com/dj9oy80mc/image/upload/v1/logo.png';

        lineItems.push({
          sku_code: sku,
          quantity: Number(prod.quantity) || 1,
          sku_price: price,
        });

        skuMetaList.push({
          sku_code: sku,
          sku_name: skuName.slice(0, 100),
          sku_description: prod.name || sku,
          sku_image_url: imageUrl,
          price: price,
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
      area = orderDoc.city || 'Cairo';
      deliveryNote = orderDoc.deliveryNotes || undefined;

      for (const product of orderDoc.products) {
        const baseSku = buildSkuCode(product.productName || 'product');
        const imageUrl =
          product.productImage?.secure_url ||
          'https://res.cloudinary.com/dj9oy80mc/image/upload/v1/logo.png';
        const price = Number(product.price) || 0;

        const variants = Array.isArray(product.variants) && product.variants.length > 0
          ? product.variants
          : [{ color: product.color, size: product.size, quantity: Number(product.quantity) || 1 }];

        for (const variant of variants) {
          const qty = Number(variant.quantity) || 0;
          if (qty < 1) continue;
          let sku = baseSku;
          let variantDesc = '';
          if (variant.color) {
            sku += `-${buildSkuCode(variant.color)}`;
            variantDesc += `Color: ${variant.color}`;
          }
          if (variant.size) {
            sku += `-${buildSkuCode(variant.size)}`;
            variantDesc += variantDesc ? ` / Size: ${variant.size}` : `Size: ${variant.size}`;
          }
          const skuName = variantDesc ? `${product.productName} (${variantDesc})` : product.productName || sku;

          lineItems.push({
            sku_code: sku,
            quantity: qty,
            sku_price: price,
          });

          skuMetaList.push({
            sku_code: sku,
            sku_name: skuName.slice(0, 100),
            sku_description: product.productName || sku,
            sku_image_url: imageUrl,
            price: price,
          });
        }
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
      area = orderDoc.city || 'Cairo';
      deliveryNote = orderDoc.deliveryNotes || undefined;

      const sku = buildSkuCode(orderDoc.productName || 'product');
      const price = Number(orderDoc.price) || 0;
      const imageUrl =
        orderDoc.productImage?.secure_url ||
        'https://res.cloudinary.com/dj9oy80mc/image/upload/v1/logo.png';

      lineItems = [
        {
          sku_code: sku,
          quantity: Number(orderDoc.quantity) || 1,
          sku_price: price,
        },
      ];

      skuMetaList.push({
        sku_code: sku,
        sku_name: orderDoc.productName || sku,
        sku_description: orderDoc.productName || sku,
        sku_image_url: imageUrl,
        price: price,
      });
    }

    if (lineItems.length === 0) {
      throw new Error('Order has no valid line items to submit to Flextock.');
    }

    // ── Build order date ──────────────────────────────────────────────────
    const orderDate = orderDoc.createdAt
      ? new Date(orderDoc.createdAt).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    // ── Calculate the payload total and payment split ─────────────────────
    // Flextock validates payment_data against the values sent in this payload,
    // not against our stored finalPrice. Keep all values at two decimal places
    // so floating-point arithmetic cannot create a one-piastre mismatch.
    const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
    const lineTotal = roundMoney(
      lineItems.reduce((sum, item) => sum + item.sku_price * item.quantity, 0),
    );
    const storedOrderTotal = finalAmount > 0 ? roundMoney(finalAmount) : lineTotal;
    const shippingFees = roundMoney(Math.max(storedOrderTotal - lineTotal, 0));
    const expectedOrderTotal = roundMoney(lineTotal + shippingFees);

    // A deposit is part of the payment total. Cap it to the total we are
    // submitting so an erroneous stored deposit cannot make Flextock reject
    // the whole order.
    const prepaidAmount = isPrepaid
      ? expectedOrderTotal
      : roundMoney(Math.min(Math.max(deposit, 0), expectedOrderTotal));
    const codAmount = roundMoney(expectedOrderTotal - prepaidAmount);

    // Build payment_data: if there's a deposit, include prepaid + COD; otherwise just COD or prepaid
    const paymentData: FlextockOrderPayload['payment_data'] = [];
    if (isPrepaid) {
      paymentData.push({
        value: expectedOrderTotal,
        payment_type: 'prepaid',
        payment_method: orderDoc.paymentWay || 'card',
      });
    } else {
      if (prepaidAmount > 0) {
        paymentData.push({
          value: prepaidAmount,
          payment_type: 'prepaid',
          payment_method: 'deposit',
        });
      }
      if (codAmount > 0) {
        paymentData.push({
          value: codAmount,
          payment_type: 'cash_on_delivery',
        });
      }
      // If both deposit and codAmount are 0, ensure at least one payment entry
      if (paymentData.length === 0) {
        paymentData.push({
          value: expectedOrderTotal,
          payment_type: 'cash_on_delivery',
        });
      }
    }

    // Ensure required fields are not empty (Flextock rejects empty strings)
    const safePhone = phone || '01000000000';
    const safeFirstName = firstName || 'Customer';
    // Capitalize city/area names (Flextock requires proper capitalization)
    const capitalize = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
    const safeCity = capitalize(city || 'Cairo');
    const safeArea = capitalize(area || safeCity || 'Cairo');
    const safeAddress = addressLine1 || `${safeCity}, Egypt`;

    const payload: FlextockOrderPayload = {
      order_code: orderCode,
      order_date: orderDate,
      shipping_fees: shippingFees,
      is_free_shipping: shippingFees === 0,
      is_gift_order: false,
      order_currency: 'EGP',
      integration_source: INTEGRATION_SOURCE,
      vendor_name: INTEGRATION_SOURCE,
      customer_address: {
        country: 'Egypt',
        city: safeCity,
        area: safeArea,
        address_line1: safeAddress,
        address_line2: deliveryNote || undefined,
        first_name: safeFirstName,
        last_name: lastName,
        phone_number: safePhone,
        note: deliveryNote || undefined,
      },
      line_items: lineItems,
      payment_data: paymentData,
      requires_self_delivery: false,
    };

    const paidTotal = roundMoney(
      paymentData.reduce((sum, payment) => sum + payment.value, 0),
    );
    if (paidTotal !== expectedOrderTotal) {
      throw new Error(
        `Invalid Flextock payment total: ${paidTotal} does not match expected ${expectedOrderTotal}.`,
      );
    }

    // ── Detailed debug logging ────────────────────────────────────────────
    this.logger.log(`=== FLEXTOCK PAYLOAD DEBUG for order ${orderId} ===`);
    this.logger.log(`Payload: ${JSON.stringify(payload, null, 2)}`);

    // 1. Ensure all product SKUs exist on Flextock before submitting the order
    await this.ensureProductsExist(skuMetaList);

    const token = await this.getAccessToken();
    const body = JSON.stringify(payload);

    try {
      const rawResponse = await this.httpPost<any>(
        `${FLEXTOCK_BASE_URL}${CREATE_ORDER_ENDPOINT}`,
        body,
        token,
      );

      this.logger.log(
        `Flextock order submitted. order_code=${orderCode} response=${JSON.stringify(rawResponse)}`,
      );

      return orderCode;
    } catch (err: any) {
      const errMsg = err?.message || String(err);

      // ── "Already exists" recovery ──────────────────────────────────────────
      // The order_code is deterministic (EXC-{mongoId}). If Flextock says it
      // already exists, a previous attempt actually succeeded. Treat as success.
      const alreadyExists =
        /already exists/i.test(errMsg) ||
        /duplicate/i.test(errMsg) ||
        errMsg.includes(orderCode);
      if (alreadyExists) {
        this.logger.warn(
          `Flextock reported order_code ${orderCode} already exists — treating as successful submission.`,
        );
        return orderCode;
      }

      // ── Missing SKU recovery — create SKU on-demand and retry ─────────────
      const skuMatch = errMsg.match(/SKU\s+([^\s]+)\s+not exists/i);
      if (skuMatch && skuMatch[1]) {
        const rawSku = skuMatch[1].replace(/[^a-zA-Z0-9_-]/g, '');
        let safeSku = rawSku;
        if (safeSku.length < 3) safeSku = `sku-${safeSku}`;
        const safeName = rawSku.length < 3 ? `${rawSku} item` : rawSku;
        const safeDesc = `${safeName} product item`;

        this.logger.warn(`SKU ${rawSku} reported missing by Flextock. Auto-creating (${safeSku}) and retrying...`);
        await this.ensureProductsExist([
          {
            sku_code: safeSku,
            sku_name: safeName,
            sku_description: safeDesc,
            sku_image_url: 'https://res.cloudinary.com/dj9oy80mc/image/upload/v1/logo.png',
            price: 1,
          },
        ]);

        let retryBody = body;
        if (safeSku !== rawSku) {
          retryBody = body.replace(new RegExp(`"sku_code":\\s*"${rawSku}"`, 'g'), `"sku_code": "${safeSku}"`);
        }

        const retryResponse = await this.httpPost<any>(
          `${FLEXTOCK_BASE_URL}${CREATE_ORDER_ENDPOINT}`,
          retryBody,
          token,
        );
        this.logger.log(
          `Flextock order submitted on retry. order_code=${orderCode} response=${JSON.stringify(retryResponse)}`,
        );
        return orderCode;
      }

      throw err;
    }
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
              // Capture ALL error information from Flextock
              let msg: string;
              if (typeof parsed === 'string') {
                msg = parsed;
              } else if (Array.isArray(parsed)) {
                msg = JSON.stringify(parsed);
              } else {
                // Try known error fields
                const parts: string[] = [];
                if (parsed?.message) parts.push(typeof parsed.message === 'string' ? parsed.message : JSON.stringify(parsed.message));
                if (parsed?.error) parts.push(typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error));
                if (parsed?.detail) parts.push(typeof parsed.detail === 'string' ? parsed.detail : JSON.stringify(parsed.detail));
                if (parsed?.errors) parts.push(JSON.stringify(parsed.errors));
                if (parsed?.non_field_errors) parts.push(JSON.stringify(parsed.non_field_errors));
                // If no known fields matched, dump the whole response
                msg = parts.length > 0 ? parts.join(' | ') : JSON.stringify(parsed);
              }
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
