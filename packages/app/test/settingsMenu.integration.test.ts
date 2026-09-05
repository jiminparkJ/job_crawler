import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { SettingsMenu } from '../src/telegram/settingsMenu.js';
import type { TelegramClient, TgUpdate } from '../src/telegram/client.js';

const dbUrl = process.env.TEST_DATABASE_URL;
const d = dbUrl ? describe : describe.skip;

class FakeTelegram implements TelegramClient {
  sent: { chatId: string; text: string; replyMarkup?: unknown }[] = [];
  edited: { chatId: string; messageId: number; text: string }[] = [];
  private nextId = 100;

  async sendMessage(options: { chatId: string; text: string; replyMarkup?: unknown }) {
    this.sent.push({
      chatId: options.chatId,
      text: options.text,
      replyMarkup: options.replyMarkup,
    });
    return { message_id: this.nextId++, chat: { id: 1 }, date: 1 };
  }
  async getWebhookInfo() {
    return { url: '', pending_update_count: 0 };
  }
  async deleteWebhook() {
    return true;
  }
  async getUpdates(): Promise<TgUpdate[]> {
    return [];
  }
  async answerCallbackQuery() {
    return true;
  }
  async editMessageReplyMarkup() {
    return true;
  }
  async editMessageText(opts: { chatId: string; messageId: number; text: string }) {
    this.edited.push(opts);
    return true;
  }
  async setMyCommands() {
    return true;
  }
}

const CHAT = '555';

d('SettingsMenu (inline-keyboard GUI)', () => {
  let prisma: PrismaClient;
  let tg: FakeTelegram;
  let menu: SettingsMenu;
  let profileId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    tg = new FakeTelegram();
    menu = new SettingsMenu(prisma, tg);

    const user = await prisma.user.create({
      data: { email: `menu-${Date.now()}@example.com`, telegram: '555' },
    });
    const profile = await prisma.searchProfile.create({
      data: {
        userId: user.id,
        name: 'Menu Test',
        targetTitles: ['Backend Developer'],
        requiredKeywords: ['Node.js'],
        preferredKeywords: [],
        excludedKeywords: ['PHP'],
        locations: ['Tehran'],
        employmentTypes: ['full_time'],
        minimumMatchScore: 60,
      },
    });
    profileId = profile.id;
  });

  afterAll(async () => {
    await prisma.searchProfile.deleteMany({ where: { id: profileId } });
    await prisma.user.deleteMany({ where: { email: { contains: 'menu-' } } });
    await prisma.$disconnect();
  });

  it('opens with /settings: one message, full profile, keyboard attached', async () => {
    await menu.open(CHAT);
    expect(tg.sent).toHaveLength(1);
    const m = tg.sent[0];
    expect(m.text).toContain('Job Hunter — Settings');
    expect(m.text).toContain('Backend Developer');
    expect(m.text).toContain('Min score');
    const kb = m.replyMarkup as {
      inline_keyboard: { text: string; callback_data: string }[][];
    };
    const allButtons = kb.inline_keyboard.flat();
    expect(allButtons.some((b) => b.callback_data === 'menu:field:titles')).toBe(true);
    expect(allButtons.some((b) => b.callback_data === 'menu:toggle')).toBe(true);
    expect(allButtons.some((b) => b.callback_data === 'menu:presets:backend')).toBe(true);
    expect(allButtons.some((b) => b.callback_data === 'menu:threshold:80')).toBe(true);
  });

  it('tapping a field enters edit mode (menu re-renders, not new message)', async () => {
    const consumed = await menu.handleCallback('menu:field:titles', CHAT, 9);
    expect(consumed).toBe(true);
    // re-render happens via editMessageText on the same message
    expect(tg.edited).toHaveLength(1);
    expect(tg.edited[0].text).toContain('Editing');
    expect(tg.edited[0].text).toContain('send the new values');
    // listener can now capture plain text for this chat
    expect(menu.editingField(CHAT)).toBe('titles');
  });

  it('plain text submits the value; menu returns to view mode', async () => {
    const consumed = await menu.submitText(CHAT, 'Backend Developer, Full-Stack Developer');
    expect(consumed).toBe(true);
    const p = await prisma.searchProfile.findUnique({ where: { id: profileId } });
    expect(p?.targetTitles).toEqual(['Backend Developer', 'Full-Stack Developer']);
    expect(menu.editingField(CHAT)).toBeUndefined();
    // confirmation + re-render
    const confirm = tg.sent.at(-1);
    expect(confirm?.text).toContain('2 value(s)');
  });

  it('clear button empties the field', async () => {
    await menu.handleCallback('menu:field:excluded', CHAT, 9);
    await menu.handleCallback('menu:clear:excluded', CHAT, 9);
    const p = await prisma.searchProfile.findUnique({ where: { id: profileId } });
    expect(p?.excludedKeywords).toEqual([]);
  });

  it('threshold buttons set min score', async () => {
    await menu.handleCallback('menu:threshold:80', CHAT, 9);
    const p = await prisma.searchProfile.findUnique({ where: { id: profileId } });
    expect(p?.minimumMatchScore).toBe(80);
  });

  it('presets apply their configuration', async () => {
    await menu.handleCallback('menu:presets:backend', CHAT, 9);
    const p = await prisma.searchProfile.findUnique({ where: { id: profileId } });
    expect(p?.targetTitles).toEqual(['Backend Developer', 'Node.js Developer', 'Backend Engineer']);
    expect(p?.excludedKeywords).toEqual(['PHP', 'WordPress']);
    expect(p?.minimumMatchScore).toBe(60);
  });

  it('pause/resume toggles the profile', async () => {
    await menu.handleCallback('menu:toggle', CHAT, 9);
    let p = await prisma.searchProfile.findUnique({ where: { id: profileId } });
    expect(p?.active).toBe(false);
    await menu.handleCallback('menu:toggle', CHAT, 9);
    p = await prisma.searchProfile.findUnique({ where: { id: profileId } });
    expect(p?.active).toBe(true);
  });

  it('non-menu callbacks are not consumed', async () => {
    const consumed = await menu.handleCallback('save:some-match', CHAT, 9);
    expect(consumed).toBe(false);
  });

  it('unknown menu actions are consumed silently (no crash)', async () => {
    const consumed = await menu.handleCallback('menu:bogus', CHAT, 9);
    expect(consumed).toBe(true);
  });
});
