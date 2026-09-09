/**
 * WhatsApp message templates for the order flow.
 * All messages use text-only (Hashtag API does not support interactive buttons).
 * Each message embeds a short order reference so the customer can reply unambiguously.
 */

export interface OrderMessageData {
  /** Short alphanumeric reference shown to the customer, e.g. ORD-A1B2C3 */
  orderRef: string;
  customerName: string;
  totalEGP: number;
  /** Array of product names + quantities for the summary line */
  items: Array<{ name: string; quantity: number }>;
  depositAmountEGP?: number;
}

function itemsLine(items: Array<{ name: string; quantity: number }>): string {
  return items.map((i) => `  • ${i.name} × ${i.quantity}`).join('\n');
}

/**
 * Sent immediately after a new order is created.
 * Customer must reply with: CONFIRM <orderRef>
 */
export function orderConfirmationRequestTemplate(data: OrderMessageData): string {
  return [
    `🛍️ مرحباً ${data.customerName}!`,
    ``,
    `تم إنشاء طلبك بنجاح.`,
    `رقم الطلب: *${data.orderRef}*`,
    ``,
    `📦 المنتجات:`,
    itemsLine(data.items),
    ``,
    `💰 الإجمالي: *${data.totalEGP.toLocaleString('ar-EG')} EGP*`,
    ``,
    `لتأكيد طلبك، يرجى الرد بـ:`,
    `*CONFIRM ${data.orderRef}*`,
    ``,
    `لإلغاء الطلب، تواصل معنا مباشرة.`,
  ].join('\n');
}

/**
 * Sent after the customer confirms the order.
 * Informs them a deposit is required and how to confirm it.
 */
export function depositRequestTemplate(data: OrderMessageData): string {
  const depositAmount = data.depositAmountEGP ?? 0;
  return [
    `✅ تم تأكيد طلبك رقم *${data.orderRef}* بنجاح!`,
    ``,
    `لمتابعة تنفيذ الطلب، يرجى سداد مقدم (عربون) بقيمة:`,
    `*${depositAmount.toLocaleString('ar-EG')} EGP*`,
    ``,
    `بعد السداد، أرسل إيصال الدفع وأكد بالرد بـ:`,
    `*CONFIRM_DEPOSIT ${data.orderRef}*`,
    ``,
    `شكراً لتعاملك معنا! 🙏`,
  ].join('\n');
}

/**
 * Sent after the customer confirms the deposit.
 */
export function depositConfirmedTemplate(orderRef: string, customerName: string): string {
  return [
    `✅ شكراً ${customerName}!`,
    ``,
    `تم استلام تأكيد العربون لطلبك رقم *${orderRef}*.`,
    `سيتم التواصل معك قريباً لترتيب التسليم.`,
    ``,
    `نشكرك على ثقتك بنا! 💜`,
  ].join('\n');
}

/**
 * Sent when the phone matches multiple pending orders.
 */
export function multipleOrdersTemplate(refs: string[]): string {
  const list = refs.map((r) => `  • ${r}`).join('\n');
  return [
    `لديك أكثر من طلب قيد الانتظار:`,
    list,
    ``,
    `يرجى الرد بـ: *CONFIRM <رقم الطلب>*`,
    `مثال: CONFIRM ORD-A1B2C3`,
  ].join('\n');
}

/**
 * Sent when no eligible order is found for the phone number.
 */
export function noOrderFoundTemplate(): string {
  return `لم نتمكن من العثور على طلب مفتوح مرتبط برقمك. يرجى التواصل معنا مباشرة.`;
}

/**
 * Sent for unrecognised messages.
 */
export function unknownCommandTemplate(): string {
  return [
    `عذراً، لم نفهم رسالتك.`,
    ``,
    `للتأكيد على طلب: *CONFIRM <رقم الطلب>*`,
    `لتأكيد العربون: *CONFIRM_DEPOSIT <رقم الطلب>*`,
  ].join('\n');
}
