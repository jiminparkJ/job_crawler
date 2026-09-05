/**
 * Telegram update listener: polls getUpdates (no webhook infrastructure
 * needed — PROMPT §13 "no queue"), processes:
 *   - callback queries from the Save / Not Relevant buttons
 *   - text commands (/profile, /set, /clear, /pause, /resume, /help)
 * Failures never crash the app.
 */

import type { Logger } from 'pino';
import type { TelegramClient } from './client.js';
import type { NotificationService } from './notificationService.js';
import { acknowledgedKeyboard } from './messages.js';
import type { ProfileBotCommands } from './profileCommands.js';
import type { SettingsMenu } from './settingsMenu.js';

export interface TelegramListenerStats {
  processed: number;
  answered: number;
  saved: number;
  notRelevant: number;
  ignored: number;
  commands: number;
}

export class TelegramUpdateListener {
  private offset: number | null = null;
  private running = false;

  constructor(
    private readonly telegram: TelegramClient,
    private readonly notifications: NotificationService,
    private readonly options: {
      pollMs?: number;
      logger?: Logger;
      profileCommands?: ProfileBotCommands;
      settingsMenu?: SettingsMenu;
    } = {},
  ) {}

  /** Poll once: fetch new updates, process callbacks, advance the offset. */
  async pollOnce(): Promise<TelegramListenerStats> {
    const stats: TelegramListenerStats = {
      processed: 0,
      answered: 0,
      saved: 0,
      notRelevant: 0,
      ignored: 0,
      commands: 0,
    };

    const updates = await this.telegram.getUpdates(this.offset != null ? this.offset : undefined);

    for (const update of updates) {
      stats.processed++;
      // Advance offset past this update so Telegram drops it from the queue.
      this.offset = update.update_id + 1;

      // Text commands (/profile, /set, ...) — handled by ProfileBotCommands.
      const msg = update.message;

      // Plain text (no slash): menu edit-mode input, else ignored.
      if (msg?.text && !msg.text.startsWith('/')) {
        const chatId = String(msg.chat.id);
        if (this.options.settingsMenu?.editingField(chatId)) {
          try {
            const consumed = await this.options.settingsMenu.submitText(chatId, msg.text);
            if (consumed) stats.commands++;
          } catch (err) {
            this.options.logger?.warn({ err }, 'menu text input failed');
          }
        }
        continue;
      }

      // Text commands (/profile, /set, /settings, ...).
      if (msg?.text?.startsWith('/')) {
        const chatId = String(msg.chat.id);
        try {
          if (/^\/(settings|menu)/.test(msg.text)) {
            await this.options.settingsMenu?.open(chatId);
            stats.commands++;
          } else if (this.options.profileCommands) {
            const reply = await this.options.profileCommands.handle(msg.text, msg.from?.id ?? 0);
            await this.telegram.sendMessage({
              chatId,
              text: reply,
              parseMode: 'HTML',
              disableWebPagePreview: true,
            });
            stats.commands++;
          }
        } catch (err) {
          this.options.logger?.warn(
            { err: err instanceof Error ? err.message : String(err) },
            'command handling failed',
          );
          stats.ignored++;
        }
        continue;
      }

      const cb = update.callback_query;
      if (!cb) continue;

      // Always answer the callback first so the user's spinner stops,
      // regardless of the processing outcome.
      try {
        await this.telegram.answerCallbackQuery(cb.id);
        stats.answered++;
      } catch {
        // answerCallbackQuery has a short window; a miss is harmless.
      }

      // Menu callbacks (menu:*) — SettingsMenu renders/edits itself.
      if (cb.data.startsWith('menu:') && this.options.settingsMenu && cb.message) {
        try {
          await this.options.settingsMenu.handleCallback(
            cb.data,
            String(cb.message.chat.id),
            cb.from.id,
          );
        } catch (err) {
          this.options.logger?.warn({ err }, 'menu callback failed');
        }
        continue;
      }

      try {
        const result = await this.notifications.handleCallback(cb.data, cb.from.id);
        if (result === 'saved') stats.saved++;
        else if (result === 'not_relevant') stats.notRelevant++;
        else stats.ignored++;

        // Replace the two-button keyboard with a confirmation chip so the
        // user sees the press was processed.
        if (cb.message && (result === 'saved' || result === 'not_relevant')) {
          try {
            await this.telegram.editMessageReplyMarkup({
              chatId: String(cb.message.chat.id),
              messageId: cb.message.message_id,
              replyMarkup: acknowledgedKeyboard(result),
            });
          } catch {
            // Message too old / already edited: cosmetic, not an error.
          }
        }
      } catch (err) {
        this.options.logger?.warn(
          { data: cb.data, err: err instanceof Error ? err.message : String(err) },
          'callback processing failed',
        );
        stats.ignored++;
      }
    }

    return stats;
  }

  /** Continuous loop; safe to start/stop; swallows polling errors. */
  start(): void {
    if (this.running) return;
    this.running = true;
    const pollMs = this.options.pollMs ?? 5000;
    this.options.logger?.info({ pollMs }, 'telegram listener started');

    const loop = async () => {
      while (this.running) {
        try {
          await this.pollOnce();
        } catch (err) {
          // Network hiccup / Telegram down: back off briefly and continue.
          this.options.logger?.debug(
            { err: err instanceof Error ? err.message : String(err) },
            'telegram poll failed — retrying',
          );
        }
        await new Promise((r) => setTimeout(r, pollMs));
      }
    };
    void loop();
  }

  stop(): void {
    this.running = false;
    this.options.logger?.info('telegram listener stopped');
  }
}
