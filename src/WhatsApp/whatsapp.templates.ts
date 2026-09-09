/**
 * WhatsApp message templates for the order flow.
 * All messages use text-only (Hashtag API does not support interactive buttons).
 * Numbered options simulate buttons: customer replies 1 or 2.
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

// InstaPay number for deposit transfers
const INSTAPAY_PHONE = process.env.INSTAPAY_PHONE || '01128560748';

function itemsLine(items: Array<{ name: string; quantity: number }>): string {
  return items.map((i) => `  • ${i.name} × ${i.quantity}`).join('\n');
}

/**
 * Sent immediately after a new order is created.
 * Shows two text "buttons": 1️⃣ Confirm  |  2️⃣ Cancel
 * Customer replies with 1 or 2 (or Arabic keywords).
 */
export function orderConfirmationRequestTemplate(data: OrderMessageData): string {
  return [
    `🛍️ مرحباً ${data.customerName}!`,
    ``,
    `تم استلام طلبك بنجاح.`,
    `رقم الطلب: *${data.orderRef}*`,
    ``,
    `📦 المنتجات:`,
    itemsLine(data.items),
    ``,
    `💰 الإجمالي: *${data.totalEGP.toLocaleString('ar-EG')} EGP*`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `اختر أحد الخيارات التالية:`,
    ``,
    `1️⃣  *تأكيد الطلب*`,
    `  ← اضغط هنا أو أرسل: *1*`,
    ``,
    `2️⃣  *إلغاء الطلب*`,
    `  ← اضغط هنا أو أرسل: *2*`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
  ].join('\n');
}

/**
 * Sent after the customer confirms the order.
 * Shows InstaPay phone prominently and instructs to send receipt screenshot.
 */
export function depositRequestTemplate(data: OrderMessageData): string {
  const depositAmount = data.depositAmountEGP && data.depositAmountEGP > 0 ? data.depositAmountEGP : 50;

  return [
    `✅ تم تأكيد طلبك رقم *${data.orderRef}* بنجاح!`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `💳 لتأكيد الحجز، يرجى سداد العربون:`,
    ``,
    `💰 المبلغ: *${depositAmount.toLocaleString('ar-EG')} EGP*`,
    ``,
    `📱 *رقم InstaPay / فودافون كاش:*`,
    `👉 *${INSTAPAY_PHONE}*`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `📸 *بعد التحويل:*`,
    `أرسل *صورة إيصال التحويل* هنا مباشرةً وسيتم تأكيد الطلب تلقائياً ✅`,
    ``,
    `شكراً لك! 💜`,
  ].join('\n');
}

/**
 * Sent after the customer sends an image / screenshot of their deposit receipt.
 */
export function depositReceiptReceivedTemplate(orderRef: string, customerName: string): string {
  return [
    `🎉 شكراً ${customerName}!`,
    ``,
    `تم استلام صورة إيصال العربون لطلبك رقم *${orderRef}* بنجاح! ✅`,
    `تم إرفاق الإيصال في النظام وتأكيد الحجز، وجاري تجهيز طلبك بعناية. 🌸`,
    ``,
    `سنقوم بإشعارك فور شحن الطلب إليك. نشكرك على ثقتك بنا! 💜`,
  ].join('\n');
}

/**
 * Sent after the customer confirms the deposit via text command.
 */
export function depositConfirmedTemplate(orderRef: string, customerName: string): string {
  return [
    `✅ شكراً ${customerName}!`,
    ``,
    `تم استلام تأكيد العربون لطلبك رقم *${orderRef}*.`,
    `سيتم مراجعة الدفع والتواصل معك قريباً لترتيب التسليم.`,
    ``,
    `نشكرك على ثقتك بنا! 💜`,
  ].join('\n');
}

/**
 * Sent after the customer cancels via WhatsApp (replies 2 or إلغاء).
 */
export function orderCancelledTemplate(orderRef: string, customerName: string): string {
  return [
    `❌ تم إلغاء طلبك رقم *${orderRef}*.`,
    ``,
    `نأسف لذلك ${customerName}. إذا غيّرت رأيك أو أردت طلب جديد، يسعدنا خدمتك دائماً! 🛍️`,
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
    `اختر:`,
    `1️⃣ أرسل *1* لتأكيد أحدث طلب`,
    `2️⃣ أرسل *2* لإلغاء أحدث طلب`,
  ].join('\n');
}

/**
 * Sent when no eligible order is found for the phone number.
 */
export function noOrderFoundTemplate(): string {
  return `لم نتمكن من العثور على طلب قيد الانتظار مرتبط برقمك. يرجى مراجعة خدمة العملاء.`;
}

/**
 * Sent for unrecognised messages.
 */
export function unknownCommandTemplate(): string {
  return [
    `أهلاً بك! 👋`,
    ``,
    `لتأكيد طلبك: أرسل *1* أو *تأكيد*`,
    `لإلغاء طلبك: أرسل *2* أو *إلغاء*`,
    `لتأكيد الدفع: أرسل صورة إيصال التحويل مباشرةً هنا.`,
  ].join('\n');
}
