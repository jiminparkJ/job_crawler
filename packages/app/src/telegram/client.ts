/**
 * Telegram Bot API client (sendMessage + callback handling).
 *
 * Minimal, dependency-light: direct REST calls over undici with retry and
 * timeout. Secrets are constructor-injected and never logged.
 */

import type { HttpClient } from '../sources/http.js';

export interface TelegramMessageOptions {
  chatId: string;
  text: string;
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  disableWebPagePreview?: boolean;
  replyMarkup?: TelegramInlineKeyboard;
}

export interface TelegramInlineKeyboard {
  inline_keyboard: { text: string; callback_data: string }[][];
}

export interface TelegramSendMessageResult {
  message_id: number;
  chat: { id: number };
  date: number;
}

interface TgApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export interface TelegramClient {
  sendMessage(options: TelegramMessageOptions): Promise<TelegramSendMessageResult>;
  getWebhookInfo(): Promise<{ url: string; pending_update_count: number }>;
  deleteWebhook(): Promise<boolean>;
  getUpdates(offset?: number): Promise<TgUpdate[]>;
  answerCallbackQuery(id: string, text?: string): Promise<boolean>;
}

export interface TgUpdate {
  update_id: number;
  callback_query?: {
    id: string;
    from: { id: number; first_name?: string };
    data: string;
    message?: { chat: { id: number }; message_id: number };
  };
  message?: { chat: { id: number }; text?: string };
}

export class TelegramBotClient implements TelegramClient {
  private readonly http: HttpClient;
  private readonly token: string;
  private readonly apiBase: string;

  constructor(http: HttpClient, token: string, apiBase = 'https://api.telegram.org') {
    this.http = http;
    this.token = token;
    this.apiBase = apiBase;
  }

  private async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const res = await this.http.requestJson<TgApiResponse<T>>(`/bot${this.token}/${method}`, {
      method: 'POST',
      body,
    });
    if (!res.ok) {
      const err = new Error(
        `Telegram ${method} failed: ${res.error_code ?? '?'} ${res.description ?? 'unknown'}`,
      );
      (err as Error & { telegramErrorCode?: number }).telegramErrorCode = res.error_code;
      throw err;
    }
    return res.result as T;
  }

  async sendMessage(options: TelegramMessageOptions): Promise<TelegramSendMessageResult> {
    return this.call<TelegramSendMessageResult>('sendMessage', {
      chat_id: options.chatId,
      text: options.text,
      parse_mode: options.parseMode ?? 'HTML',
      disable_web_page_preview: options.disableWebPagePreview ?? true,
      ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
    });
  }

  async getWebhookInfo(): Promise<{ url: string; pending_update_count: number }> {
    return this.call('getWebhookInfo', {});
  }

  async deleteWebhook(): Promise<boolean> {
    return this.call('deleteWebhook', {});
  }

  async getUpdates(offset?: number): Promise<TgUpdate[]> {
    return this.call<TgUpdate[]>('getUpdates', {
      timeout: 0,
      ...(offset != null ? { offset } : {}),
    });
  }

  async answerCallbackQuery(id: string, text?: string): Promise<boolean> {
    return this.call('answerCallbackQuery', { callback_query_id: id, ...(text ? { text } : {}) });
  }
}

/** 429/timeout-aware wait helper: parse retry_after seconds when present. */
export function telegramRetryAfterMs(err: unknown): number | null {
  const e = err as { telegramErrorCode?: number; message?: string };
  if (e?.telegramErrorCode === 429) {
    const m = /retry after (\d+)/i.exec(e.message ?? '');
    if (m) return Number(m[1]) * 1000;
    return 30_000;
  }
  return null;
}
