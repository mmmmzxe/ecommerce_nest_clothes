/**
 * WhatsApp message templates for the Extra Chic order flow.
 * Formats full customer, product (size, color, price), and address details.
 */

export interface OrderItemData {
  name: string;
  quantity: number;
  unitPrice?: number;
  finalPrice?: number;
  color?: string;
  size?: string;
}

export interface OrderMessageData {
  /** Short alphanumeric reference shown to the customer, e.g. ORD-A1B2C3 */
  orderRef: string;
  customerName: string;
  email?: string;
  phone?: string;
  address?: string;
  government?: string;
  paymentMethod?: string;
  items: OrderItemData[];
  subTotalEGP?: number;
  shippingFeeEGP?: number;
  totalEGP: number;
  depositAmountEGP?: number;
}

// Bot WhatsApp phone for wa.me links
const BOT_PHONE = process.env.WHATSAPP_BOT_PHONE || '201286198016';

// InstaPay number for deposit transfers
const INSTAPAY_PHONE = process.env.INSTAPAY_PHONE || '01128560748';

/**
 * Helper to build the comprehensive order breakdown block.
 */
function formatOrderBreakdown(data: OrderMessageData): string[] {
  const lines: string[] = [];

  // 1. Customer Information
  lines.push(`👤 *بيانات العميل (Customer Information):*`);
  lines.push(`• *الاسم (Name):* ${data.customerName}`);
  if (data.phone) lines.push(`• *الهاتف (Phone):* ${data.phone}`);
  if (data.email) lines.push(`• *البريد (Email):* ${data.email}`);

  // 2. Shipping Address
  if (data.address || data.government) {
    lines.push(``);
    lines.push(`📍 *عنوان التوصيل (Shipping Address):*`);
    if (data.address) lines.push(`• *العنوان:* ${data.address}`);
    if (data.government) lines.push(`• *المحافظة (Government):* ${data.government}`);
  }

  // 3. Payment Information
  lines.push(``);
  lines.push(`💳 *معلومات الدفع (Payment Information):*`);
  const methodText = data.paymentMethod === 'card' ? 'بطاقة بنكية (Card)' : 'الدفع عند الاستلام (Cash)';
  lines.push(`• *طريقة الدفع (Method):* ${methodText}`);

  // 4. Order Items (including Size, Color, Quantity, Unit price)
  lines.push(``);
  lines.push(`📦 *المنتجات المطلوبة (Order Items):*`);
  data.items.forEach((item, idx) => {
    lines.push(`*${idx + 1}. ${item.name}*`);
    lines.push(`   - *الكمية (Quantity):* ${item.quantity}`);
    if (item.unitPrice) lines.push(`   - *سعر القطعة (Unit):* ${item.unitPrice.toLocaleString('ar-EG')} EGP`);
    if (item.color) lines.push(`   - *اللون (Color):* ${item.color}`);
    if (item.size) lines.push(`   - *المقاس (Size):* ${item.size}`);
    if (item.finalPrice) lines.push(`   - *الإجمالي للقطعة:* ${item.finalPrice.toLocaleString('ar-EG')} EGP`);
  });

  // 5. Order Summary
  lines.push(``);
  lines.push(`💰 *ملخص الحساب (Order Summary):*`);
  if (data.subTotalEGP !== undefined) {
    lines.push(`• *المجموع الفرعي (Subtotal):* ${data.subTotalEGP.toLocaleString('ar-EG')} EGP`);
  }
  if (data.shippingFeeEGP !== undefined) {
    lines.push(`• *مصاريف الشحن (Shipping):* ${data.shippingFeeEGP.toLocaleString('ar-EG')} EGP`);
  }
  lines.push(`• *الإجمالي الكلي (Total):* *${data.totalEGP.toLocaleString('ar-EG')} EGP*`);

  return lines;
}

/**
 * Returns interactive buttons array for the confirmation template.
 */
export function getConfirmationButtons(data: OrderMessageData): Array<{ id: string; text: string }> {
  return [
    { id: '1', text: '✅ تأكيد الطلب' },
    { id: '2', text: '❌ إلغاء الطلب' },
  ];
}

/**
 * Sent immediately after a new order is created.
 * Displays full customer info, products with size/color, and shipping address.
 */
export function orderConfirmationRequestTemplate(data: OrderMessageData): string {
  const confirmLink = `https://wa.me/${BOT_PHONE}?text=${encodeURIComponent(`تأكيد ${data.orderRef}`)}`;
  const cancelLink = `https://wa.me/${BOT_PHONE}?text=${encodeURIComponent(`إلغاء ${data.orderRef}`)}`;

  return [
    `🛍️ مرحباً ${data.customerName}!`,
    `تم استلام طلبك رقم *${data.orderRef}* بنجاح في متجر *Extra Chic*.`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    ...formatOrderBreakdown(data),
    `━━━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `اختر أحد الخيارات لتأكيد الطلب أو إلغائه:`,
    ``,
    `✅ *لتأكيد الطلب اضغط على الرابط التالي:*`,
    confirmLink,
    ``,
    `❌ *لإلغاء الطلب اضغط على الرابط التالي:*`,
    cancelLink,
    ``,
    `أو يمكنك الرد برقم: *1* للتأكيد أو *2* للإلغاء`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
  ].join('\n');
}

/**
 * Sent after the customer confirms the order (or requests deposit details).
 * Displays full order details and prominent InstaPay payment instructions.
 */
export function depositRequestTemplate(data: OrderMessageData): string {
  const depositAmount = data.depositAmountEGP && data.depositAmountEGP > 0 ? data.depositAmountEGP : 50;
  const remaining = Math.max(0, data.totalEGP - depositAmount);

  return [
    `✅ تم تأكيد استلام طلبك رقم *${data.orderRef}* بنجاح!`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    ...formatOrderBreakdown(data),
    `━━━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `💳 *لتأكيد الحجز وتجهيز الشحن، يرجى سداد العربون:*`,
    ``,
    `💰 *مبلغ العربون المطلوب:* *${depositAmount.toLocaleString('ar-EG')} EGP*`,
    `💵 *المبلغ المتبقي عند الاستلام:* *${remaining.toLocaleString('ar-EG')} EGP*`,
    ``,
    `📱 *رقم InstaPay / فودافون كاش:*`,
    `👉 *${INSTAPAY_PHONE}*`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `📸 *بعد التحويل:*`,
    `أرسل *صورة إيصال التحويل (Screenshot)* هنا مباشرةً وسيتم تأكيد طلبك تلقائياً في لوحة التحكم وتجهيزه للشحن! ✅`,
    ``,
    `شكراً لتسوقك معنا! 💜`,
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
    `تم إرفاق الإيصال في النظام وتأكيد الحجز في لوحة التحكم، وجاري تجهيز طلبك بعناية فائقة. 🌸`,
    ``,
    `سنقوم بإشعارك فور شحن الطلب إليك مع مندوب التوصيل. نشكرك على ثقتك بنا! 💜`,
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
 * Sent when customer tries to take action on an already cancelled order.
 */
export function orderAlreadyCancelledTemplate(orderRef: string): string {
  return [
    `طلبك رقم *${orderRef}* ملغي بالفعل مسبقاً ❌.`,
    ``,
    `إذا كنت ترغب في عمل طلب جديد، نسعد بخدمتك دائماً من خلال موقعنا! 🛍️`,
  ].join('\n');
}

/**
 * Sent when customer tries to confirm an order that is already confirmed and active.
 */
export function orderAlreadyConfirmedTemplate(orderRef: string): string {
  return [
    `طلبك رقم *${orderRef}* مؤكد بالفعل وجاري تجهيزه للشحن والتوصيل! 🚚📦`,
    ``,
    `سنقوم بإشعارك بأي تحديثات قادمة فور شحن الطلب. نشكرك على ثقتك بنا! 💜`,
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
    `أهلاً بك في Extra Chic! 👋`,
    ``,
    `لتأكيد طلبك: أرسل *1* أو *تأكيد*`,
    `لإلغاء طلبك: أرسل *2* أو *إلغاء*`,
    `لتأكيد دفع العربون: أرسل صورة إيصال التحويل (Screenshot) مباشرةً هنا.`,
  ].join('\n');
}
