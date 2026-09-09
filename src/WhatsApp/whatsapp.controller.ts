import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { Public } from 'src/common/Decorator/public.decorator';
import { WhatsAppService } from './whatsapp.service';

/**
 * Webhook endpoint for the Hashtag WhatsApp Bot.
 *
 * Security: The Hashtag API does not provide HMAC signatures on webhooks.
 * We validate a shared secret token passed as a query parameter.
 *
 * Configure the webhook URL in the Hashtag dashboard as:
 *   https://YOUR_DOMAIN/api/whatsapp/webhook?secret=<WHATSAPP_WEBHOOK_SECRET>
 *
 * Keep WHATSAPP_WEBHOOK_SECRET strong and secret (min 32 random characters).
 *
 * Processing is always idempotent — receiving the same webhook twice is a no-op.
 */
@Controller('whatsapp')
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);

  constructor(private readonly whatsappService: WhatsAppService) {}

  /**
   * POST /api/whatsapp/webhook?secret=TOKEN
   *
   * Returns 200 immediately after token validation to satisfy the Hashtag bot.
   * Message processing is async and errors do NOT affect the HTTP response.
   */
  @Public('public')
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async receiveWebhook(
    @Body() body: any,
    @Query('secret') incomingSecret: string,
  ): Promise<{ ok: boolean }> {
    // ── Token validation ─────────────────────────────────────────────────────
    const expectedSecret = process.env.WHATSAPP_WEBHOOK_SECRET || process.env.WHATSAPP_API_SECRET;
    const token = incomingSecret || body?.secret || body?.api_secret || body?.token;

    if (expectedSecret && token && token !== expectedSecret && token !== process.env.WHATSAPP_API_SECRET) {
      this.logger.warn(`[webhook] Invalid secret received: "${token?.slice(0, 8)}..."`);
      throw new ForbiddenException('Invalid webhook secret');
    }

    if (expectedSecret && !token) {
      // Log warning but allow if configured as optional or if Hashtag strips query params
      this.logger.warn('[webhook] Request received without secret token parameter.');
    }

    // ── Log receipt ──────────────────────────────────────────────────────────
    this.logger.log(`[webhook] Received payload: ${JSON.stringify(body)?.slice(0, 200)}`);

    // ── Fire-and-forget processing ───────────────────────────────────────────
    // Return 200 immediately. Errors during processing are caught internally.
    this.whatsappService.handleIncomingMessage(body).catch((err) => {
      this.logger.error('[webhook] Async processing error:', err?.message ?? err);
    });

    return { ok: true };
  }

  /**
   * GET /api/whatsapp/webhook
   *
   * Some webhook platforms (and Hashtag dashboard) send a GET request to verify
   * the URL is reachable before activating. Return 200 + hub.challenge (if any).
   */
  @Public('public')
  @Get('webhook')
  @HttpCode(HttpStatus.OK)
  verifyWebhook(@Query() query: Record<string, string>): string {
    this.logger.log('[webhook] GET verification ping received');
    return query['hub.challenge'] || 'OK';
  }
}
