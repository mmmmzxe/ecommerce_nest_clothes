import { EventEmitter } from 'events';

/**
 * Dedicated EventEmitter for WhatsApp-related events.
 *
 * Decouples OrderService from WhatsAppService:
 *   - OrderService emits 'OrderCreated' → WhatsApp picks it up asynchronously.
 *   - A failure in WhatsApp message sending NEVER affects the order creation response.
 *
 * The listener is registered when the WhatsApp module is initialized via
 * WhatsAppModule.forRoot() or simply by importing the module.
 */
export const whatsappEvent = new EventEmitter();

/**
 * Register all WhatsApp event listeners.
 * Called once from WhatsAppModule constructor.
 */
export function registerWhatsAppListeners(
  sendOrderConfirmationMessage: (order: any) => Promise<void>,
): void {
  whatsappEvent.on('OrderCreated', async (data: { order: any }) => {
    try {
      await sendOrderConfirmationMessage(data.order);
    } catch (err) {
      // Errors are already logged inside the service; swallow here to be safe.
      console.error('[whatsappEvent] OrderCreated handler error:', err?.message ?? err);
    }
  });
}
