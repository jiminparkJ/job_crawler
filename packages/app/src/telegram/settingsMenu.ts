/**
 * Interactive settings menu (Telegram inline keyboards).
 *
 * A single message acts as the menu: its buttons navigate between screens
 * (main menu → field editor → value picker), re-rendering via editMessageText.
 * The per-chat menu state tracks which message belongs to the menu and which
 * field is being edited, so plain text replies can be captured as input.
 *
 * Callback data grammar (≤64 bytes):
 *   menu:main / menu:field:<field> / menu:toggle / menu:clear:<field> /
 *   menu:threshold:<n> / menu:presets:<preset> / menu:noop
 */

import { PrismaClient } from '@prisma/client';
import type { TelegramClient, TelegramInlineKeyboard } from './client.js';

interface MenuState {
  /** Chat message id currently displaying the menu. */
  messageId?: number;
  /** Field awaiting a plain-text value (edit mode). */
  editing?: string;
}

const FIELDS: Record<string, { label: string; column: string }> = {
  titles: { label: '🎯 Titles', column: 'targetTitles' },
  required: { label: '📌 Required', column: 'requiredKeywords' },
  preferred: { label: '⭐ Preferred', column: 'preferredKeywords' },
  excluded: { label: '🚫 Excluded', column: 'excludedKeywords' },
  locations: { label: '📍 Locations', column: 'locations' },
  types: { label: '💼 Types', column: 'employmentTypes' },
};

const PRESETS: Record<string, { label: string; apply: Record<string, unknown> }> = {
  backend: {
    label: '🎯 Backend focus',
    apply: {
      targetTitles: ['Backend Developer', 'Node.js Developer', 'Backend Engineer'],
      requiredKeywords: ['Node.js'],
      preferredKeywords: ['TypeScript', 'PostgreSQL', 'Docker'],
      excludedKeywords: ['PHP', 'WordPress'],
      minimumMatchScore: 60,
    },
  },
  strict: {
    label: '🔒 Strict (min 80)',
    apply: { minimumMatchScore: 80 },
  },
  broad: {
    label: '🌊 Everything (min 40)',
    apply: { minimumMatchScore: 40 },
  },
  remote_only: {
    label: '🏠 Remote only',
    apply: { locations: ['Remote', 'دورکاری'] },
  },
};

function kb(rows: { text: string; data: string }[][]): TelegramInlineKeyboard {
  return {
    inline_keyboard: rows.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))),
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

type ProfileRow = {
  id: string;
  name: string;
  active: boolean;
  targetTitles: string[];
  requiredKeywords: string[];
  preferredKeywords: string[];
  excludedKeywords: string[];
  locations: string[];
  employmentTypes: string[];
  minimumMatchScore: number;
};

export class SettingsMenu {
  /** Per-chat menu state (single-user MVP: one menu at a time per chat). */
  private state = new Map<string, MenuState>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly telegram: TelegramClient,
  ) {}

  /** Is this chat's menu currently waiting for a plain-text value? */
  editingField(chatId: string): string | undefined {
    return this.state.get(chatId)?.editing;
  }

  /** Handle a menu callback; returns true if the callback was consumed. */
  async handleCallback(data: string, chatId: string, fromId: number): Promise<boolean> {
    if (!data.startsWith('menu:')) return false;
    const action = data.slice('menu:'.length);

    const state = this.getOrCreate(chatId);
    const profile = await this.getProfile(chatId);

    switch (action) {
      case 'main':
        await this.render(chatId, state, profile);
        return true;

      case 'toggle': {
        if (!profile) return true;
        await this.prisma.searchProfile.update({
          where: { id: profile.id },
          data: { active: !profile.active },
        });
        await this.render(chatId, state, { ...profile, active: !profile.active });
        return true;
      }

      default: {
        if (action.startsWith('field:')) {
          const field = action.slice('field:'.length);
          if (!FIELDS[field]) return true;
          state.editing = field;
          await this.render(chatId, state, profile);
          return true;
        }
        if (action.startsWith('clear:')) {
          const field = action.slice('clear:'.length);
          if (!FIELDS[field] || !profile) return true;
          await this.prisma.searchProfile.update({
            where: { id: profile.id },
            data: { [FIELDS[field].column]: [] },
          });
          state.editing = undefined;
          await this.answerOk(fromId, `${FIELDS[field].label} cleared`);
          await this.render(chatId, state, await this.getProfile(chatId));
          return true;
        }
        if (action.startsWith('threshold:')) {
          const n = Number(action.slice('threshold:'.length));
          if (!profile || !Number.isInteger(n) || n < 0 || n > 100) return true;
          await this.prisma.searchProfile.update({
            where: { id: profile.id },
            data: { minimumMatchScore: n },
          });
          await this.answerOk(fromId, `Min score: ${n}`);
          await this.render(chatId, state, await this.getProfile(chatId));
          return true;
        }
        if (action.startsWith('presets:')) {
          const preset = PRESETS[action.slice('presets:'.length)];
          if (!preset || !profile) return true;
          await this.prisma.searchProfile.update({
            where: { id: profile.id },
            data: preset.apply as Record<string, never>,
          });
          await this.answerOk(fromId, preset.label);
          await this.render(chatId, state, await this.getProfile(chatId));
          return true;
        }
        return true; // unknown menu action: consume silently
      }
    }
  }

  /** Submit a plain-text value for the field being edited. */
  async submitText(chatId: string, text: string): Promise<boolean> {
    const state = this.state.get(chatId);
    const field = state?.editing;
    if (!field) return false;
    const profile = await this.getProfile(chatId);
    if (!profile) return false;

    const values = text
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);

    await this.prisma.searchProfile.update({
      where: { id: profile.id },
      data: { [FIELDS[field].column]: values },
    });

    state.editing = undefined;
    await this.telegram.sendMessage({
      chatId,
      text: `✅ <b>${FIELDS[field].label.replace(/[^\w\s]/g, '').trim()}</b> set to ${values.length} value(s).`,
      parseMode: 'HTML',
    });
    await this.render(chatId, state, await this.getProfile(chatId));
    return true;
  }

  /** Open the menu (called from /settings or /menu). */
  async open(chatId: string): Promise<void> {
    const state = this.getOrCreate(chatId);
    state.editing = undefined;
    // Always send a fresh menu message (old ones stay as history).
    await this.render(chatId, state, await this.getProfile(chatId), true);
  }

  private async render(
    chatId: string,
    state: MenuState,
    profile: ProfileRow | null,
    fresh = false,
  ): Promise<void> {
    if (!profile) {
      const msg = await this.telegram.sendMessage({
        chatId,
        text: 'No search profile found — create one with the profile CLI first, then /settings here.',
        parseMode: 'HTML',
      });
      state.messageId = msg.message_id;
      return;
    }

    const text = this.renderText(profile, state.editing);
    const keyboard = this.renderKeyboard(profile, state.editing);

    if (fresh || state.messageId == null) {
      const msg = await this.telegram.sendMessage({
        chatId,
        text,
        parseMode: 'HTML',
        replyMarkup: keyboard,
      });
      state.messageId = msg.message_id;
    } else {
      try {
        await this.telegram.editMessageText({
          chatId,
          messageId: state.messageId,
          text,
          replyMarkup: keyboard,
        });
      } catch {
        // Menu message too old / deleted: send a fresh one.
        const msg = await this.telegram.sendMessage({
          chatId,
          text,
          parseMode: 'HTML',
          replyMarkup: keyboard,
        });
        state.messageId = msg.message_id;
      }
    }
  }

  private renderText(p: ProfileRow, editing?: string): string {
    const list = (arr: string[]) =>
      arr.length ? arr.map((v) => `  • ${escapeHtml(v)}`).join('\n') : '  — (empty = neutral)';
    const lines = [
      `⚙️ <b>Job Hunter — Settings</b>  ${p.active ? '✅ active' : '⏸ paused'}`,
      '',
      `🎯 <b>Titles</b>\n${list(p.targetTitles)}`,
      `📌 <b>Required</b>\n${list(p.requiredKeywords)}`,
      `⭐ <b>Preferred</b>\n${list(p.preferredKeywords)}`,
      `🚫 <b>Excluded</b>\n${list(p.excludedKeywords)}`,
      `📍 <b>Locations</b>\n${list(p.locations)}`,
      `💼 <b>Types</b>\n${list(p.employmentTypes)}`,
      `🎚 <b>Min score</b>: ${p.minimumMatchScore}`,
    ];
    if (editing) {
      lines.push(
        '',
        `✏️ <b>Editing ${FIELDS[editing]?.label ?? editing}</b> — send the new values now:`,
        'comma-separated, Persian or English. Empty field = neutral.',
        '(Tap another field to switch; /settings to reset the menu.)',
      );
    }
    return lines.join('\n');
  }

  private renderKeyboard(p: ProfileRow, editing?: string): TelegramInlineKeyboard {
    const fieldButtons = Object.entries(FIELDS).map(([key, f]) => ({
      text: (editing === key ? '✏️ ' : '') + f.label,
      data: `menu:field:${key}`,
    }));
    // 2 columns of fields
    const rows: { text: string; data: string }[][] = [
      fieldButtons.slice(0, 2),
      fieldButtons.slice(2, 4),
      fieldButtons.slice(4, 6),
    ];

    // Threshold quick-set
    rows.push([
      { text: '🎚 40', data: 'menu:threshold:40' },
      { text: '🎚 60', data: 'menu:threshold:60' },
      { text: '🎚 80', data: 'menu:threshold:80' },
    ]);

    rows.push([
      { text: p.active ? '⏸ Pause' : '▶️ Resume', data: 'menu:toggle' },
      { text: '🏠 Remote only', data: 'menu:presets:remote_only' },
    ]);
    rows.push([
      { text: '🎯 Backend preset', data: 'menu:presets:backend' },
      { text: '🔒 Strict', data: 'menu:presets:strict' },
      { text: '🌊 Broad', data: 'menu:presets:broad' },
    ]);
    rows.push([{ text: '🔄 Refresh', data: 'menu:main' }]);

    // While editing a field, show a Clear option for it too
    if (editing && FIELDS[editing]) {
      rows.unshift([{ text: `🗑 Clear ${FIELDS[editing].label}`, data: `menu:clear:${editing}` }]);
    }
    return kb(rows);
  }

  private async answerOk(callbackId: number, text: string): Promise<void> {
    void callbackId;
    // The listener answers callbacks before dispatching; nothing needed here.
    void text;
  }

  private getOrCreate(chatId: string): MenuState {
    let s = this.state.get(chatId);
    if (!s) {
      s = {};
      this.state.set(chatId, s);
    }
    return s;
  }

  private async getProfile(chatId: string): Promise<ProfileRow | null> {
    // Prefer the user mapped to this Telegram chat; fall back to the sole /
    // most-recently-updated profile (single-user MVP).
    const byTelegram = await this.prisma.searchProfile.findFirst({
      where: { user: { telegram: chatId } },
      orderBy: { updatedAt: 'desc' },
    });
    if (byTelegram) return byTelegram;
    return this.prisma.searchProfile.findFirst({ orderBy: { updatedAt: 'desc' } });
  }
}
