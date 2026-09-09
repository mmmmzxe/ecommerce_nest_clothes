/**
 * HTTP client for the Hashtag WhatsApp Bot API using native fetch.
 * All credentials are read from environment variables — never hardcoded.
 */
export class WhatsAppClient {
  private readonly baseURL: string;
  private readonly secret: string;
  private readonly accountUniqueId: string;

  constructor() {
    this.baseURL = process.env.WHATSAPP_API_BASE_URL || 'https://hashtagmarketing.agency/api';
    this.secret = process.env.WHATSAPP_API_SECRET || '';
    this.accountUniqueId = process.env.WHATSAPP_ACCOUNT_UNIQUE_ID || '';

    if (!this.secret || !this.accountUniqueId) {
      console.warn('[WhatsApp] WHATSAPP_API_SECRET or WHATSAPP_ACCOUNT_UNIQUE_ID is not set.');
    }
  }

  /**
   * Send a single WhatsApp text message.
   * Uses x-www-form-urlencoded as required by POST /send/whatsapp.
   *
   * @param recipient  E.164 formatted phone number (e.g. +201001234567)
   * @param message    Plain text body
   * @param priority   1 = send immediately, 2 = queued (default)
   * @returns          The Hashtag API response data
   */
  async sendTextMessage(recipient: string, message: string, priority: 1 | 2 = 1): Promise<any> {
    const form = new URLSearchParams();
    form.append('secret', this.secret);
    form.append('account', this.accountUniqueId);
    form.append('recipient', recipient);
    form.append('type', 'text');
    form.append('message', message);
    form.append('priority', String(priority));

    const response = await fetch(`${this.baseURL}/send/whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`WhatsApp API error ${response.status}: ${errorText}`);
    }

    return response.json();
  }

  /**
   * Retrieve a list of WhatsApp accounts linked to this API key.
   */
  async getAccounts(): Promise<any> {
    const url = new URL(`${this.baseURL}/get/wa.accounts`);
    url.searchParams.append('secret', this.secret);

    const response = await fetch(url.toString(), {
      method: 'GET',
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`WhatsApp API error ${response.status}: ${errorText}`);
    }

    return response.json();
  }
}

