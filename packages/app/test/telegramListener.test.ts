import { describe, expect, it, vi } from 'vitest';
import { TelegramUpdateListener } from '../src/telegram/updateListener.js';
import type { NotificationService } from '../src/telegram/notificationService.js';
import type { TelegramClient, TgUpdate } from '../src/telegram/client.js';

class FakeTelegram implements TelegramClient {
  updates: TgUpdate[] = [];
  answered: string[] = [];
  edited: { chatId: string; messageId: number; replyMarkup?: unknown }[] = [];
  getUpdatesCalls: (number | undefined)[] = [];

  async sendMessage() {
    return { message_id: 1, chat: { id: 1 }, date: 1 };
  }
  async getWebhookInfo() {
    return { url: '', pending_update_count: 0 };
  }
  async deleteWebhook() {
    return true;
  }
  async getUpdates(offset?: number) {
    this.getUpdatesCalls.push(offset);
    // Real Telegram returns ALL pending updates in one call.
    const next = offset == null ? this.updates : this.updates.filter((u) => u.update_id >= offset);
    return [...next];
  }
  async answerCallbackQuery(id: string) {
    this.answered.push(id);
    return true;
  }

  async editMessageReplyMarkup(opts: { chatId: string; messageId: number; replyMarkup?: unknown }) {
    this.edited.push({
      chatId: opts.chatId,
      messageId: opts.messageId,
      replyMarkup: opts.replyMarkup,
    });
    return true;
  }
}

function makeService(result: 'saved' | 'not_relevant' | 'ignored' | 'throw') {
  return {
    handleCallback: vi.fn(async () => {
      if (result === 'throw') throw new Error('db down');
      return result;
    }),
  } as unknown as NotificationService;
}

function cbUpdate(id: number, data: string, cbId: string): TgUpdate {
  return {
    update_id: id,
    callback_query: {
      id: cbId,
      from: { id: 1 },
      data,
      message: { chat: { id: 1 }, message_id: 1 },
    },
  };
}

describe('TelegramUpdateListener', () => {
  it('processes Save/Not-Relevant callbacks and answers them', async () => {
    const tg = new FakeTelegram();
    tg.updates = [cbUpdate(100, 'save:m1', 'cb1'), cbUpdate(101, 'not_relevant:m2', 'cb2')];
    const service = makeService('saved');
    const listener = new TelegramUpdateListener(tg, service);

    const stats = await listener.pollOnce();

    expect(stats.processed).toBe(2);
    expect(stats.answered).toBe(2);
    expect(tg.answered).toEqual(['cb1', 'cb2']);
    // Keyboard replaced with a confirmation chip on the original message
    expect(tg.edited).toHaveLength(2);
    expect(tg.edited[0]).toMatchObject({ chatId: '1', messageId: 1 });
    const kb = tg.edited[0].replyMarkup as {
      inline_keyboard: { text: string; callback_data: string }[][];
    };
    expect(kb.inline_keyboard[0][0].text).toBe('✓ Saved');
    // Second poll passes the advanced offset (past the last update).
    tg.updates = [];
    await listener.pollOnce();
    expect(tg.getUpdatesCalls[1]).toBe(102);
  });

  it('does not edit the keyboard when callback data is ignored', async () => {
    const tg = new FakeTelegram();
    tg.updates = [cbUpdate(200, 'garbage-data', 'cb3')];
    const service = makeService('ignored');
    const listener = new TelegramUpdateListener(tg, service);

    const stats = await listener.pollOnce();
    expect(stats.answered).toBe(1);
    expect(stats.ignored).toBe(1);
    expect(tg.edited).toHaveLength(0);
  });

  it('keyboard edit failure is tolerated (message too old / already edited)', async () => {
    const tg = new FakeTelegram();
    tg.updates = [cbUpdate(260, 'save:m8', 'cb6')];
    tg.editMessageReplyMarkup = async () => {
      throw new Error('Bad Request: message is not modified');
    };
    const listener = new TelegramUpdateListener(tg, makeService('saved'));
    const stats = await listener.pollOnce();
    expect(stats.saved).toBe(1); // processing still succeeded
    expect(tg.answered).toEqual(['cb6']);
  });

  it('answers the callback even when processing throws (spinner always stops)', async () => {
    const tg = new FakeTelegram();
    tg.updates = [cbUpdate(300, 'save:m9', 'cb4')];
    const service = makeService('throw');
    const listener = new TelegramUpdateListener(tg, service);

    const stats = await listener.pollOnce();
    expect(tg.answered).toEqual(['cb4']);
    expect(stats.ignored).toBe(1); // failed processing counted as ignored
  });

  it('skips non-callback updates (plain messages) but advances the offset', async () => {
    const tg = new FakeTelegram();
    tg.updates = [{ update_id: 400, message: { chat: { id: 1 }, text: 'hi' } }];
    const listener = new TelegramUpdateListener(tg, makeService('saved'));

    const stats = await listener.pollOnce();
    expect(stats.processed).toBe(1);
    expect(stats.answered).toBe(0);
    tg.updates = [];
    await listener.pollOnce();
    expect(tg.getUpdatesCalls[1]).toBe(401);
  });

  it('poll failures surface as rejected promises the loop catches', async () => {
    const tg = new FakeTelegram();
    tg.getUpdates = async () => {
      throw new Error('network down');
    };
    const listener = new TelegramUpdateListener(tg, makeService('saved'));
    await expect(listener.pollOnce()).rejects.toThrow('network down');
  });

  it('start/stop controls the loop without overlapping', async () => {
    const tg = new FakeTelegram();
    const listener = new TelegramUpdateListener(tg, makeService('saved'), { pollMs: 5 });
    listener.start();
    await new Promise((r) => setTimeout(r, 20));
    listener.stop();
    expect(tg.getUpdatesCalls.length).toBeGreaterThanOrEqual(1);
  });
});
