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
 * Provides a 1-tap WhatsApp Click-to-Chat confirmation link and supports Arabic text.
 */
export function orderConfirmationRequestTemplate(data: OrderMessageData): string {
  const botPhone = (process.env.WHATSAPP_BOT_PHONE || '201128560748').replace(/\D/g, '');
  const encodedText = encodeURIComponent(`CONFIRM ${data.orderRef}`);
  const oneTapLink = `https://wa.me/${botPhone}?text=${encodedText}`;

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
    `👉 *لتأكيد الطلب بضغطة واحدة، اضغط هنا:*`,
    oneTapLink,
    ``,
    `أو يمكنك الرد مباشرة بكلمة: *تأكيد* أو *CONFIRM ${data.orderRef}*`,
    ``,
    `لإلغاء الطلب أو الاستفسار، تفضل بمراسلتنا مباشرة.`,
  ].join('\n');
}

/**
 * Sent after the customer confirms the order.
 * Informs them a deposit is required and instructs them to send the payment screenshot.
 */
export function depositRequestTemplate(data: OrderMessageData): string {
  const depositAmount = data.depositAmountEGP && data.depositAmountEGP > 0 ? data.depositAmountEGP : 50;
  const botPhone = (process.env.WHATSAPP_BOT_PHONE || '201128560748').replace(/\D/g, '');
  const encodedText = encodeURIComponent(`CONFIRM_DEPOSIT ${data.orderRef}`);
  const oneTapDepositLink = `https://wa.me/${botPhone}?text=${encodedText}`;

  return [
    `✅ تم تأكيد طلبك رقم *${data.orderRef}* بنجاح!`,
    ``,
    `لمتابعة حجز وتشغيل الطلب، يرجى سداد مقدم (عربون):`,
    `💰 *${depositAmount.toLocaleString('ar-EG')} EGP*`,
    ``,
    `طرق الدفع المتاحة:`,
    `📱 فودافون كاش / إنستاباي`,
    ``,
    `📸 *هام جداً*: بعد التحويل، برجاء إرسال **صورة / سكرين شوت إيصال التحويل** هنا في الشات وسيتم تأكيده وإرفاقه بطلبك تلقائياً.`,
    ``,
    `👉 أو اضغط هنا للتأكيد بدون صورة:`,
    oneTapDepositLink,
  ].join('\n');
}

/**
 * Sent after the customer sends an image / screenshot of their deposit receipt.
 */
export function depositReceiptReceivedTemplate(orderRef: string, customerName: string): string {
  return [
    `🎉 شكراً ${customerName}!`,
    ``,
    `تم استلام صورة إيصال العربون لطلبك رقم *${orderRef}* بنجاح!`,
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
 * Sent when the phone matches multiple pending orders.
 */
export function multipleOrdersTemplate(refs: string[]): string {
  const list = refs.map((r) => `  • ${r}`).join('\n');
  return [
    `لديك أكثر من طلب قيد الانتظار:`,
    list,
    ``,
    `يرجى الرد بـ: *CONFIRM <رقم الطلب>* (مثال: CONFIRM ORD-A1B2C3)`,
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
    `أهلاً بك!`,
    `• لتأكيد طلبك: أرسل كلمة *تأكيد* أو *CONFIRM*`,
    `• لإرسال إيصال العربون: أرسل صورة الإيصال (سكرين شوت) مباشرة هنا.`,
  ].join('\n');
}

