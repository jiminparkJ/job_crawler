/**
 * CLI: send pending match notifications via Telegram (and retry stuck ones).
 *
 * Usage: pnpm --filter @job-hunter/app notify -- <chat-id>
 * (Token/chat come from .env; the chat-id arg is only a safety override.)
 */

import { config } from 'dotenv';
import { resolve } from 'node:path';

const root = process.cwd().endsWith('/packages/app')
  ? resolve(process.cwd(), '../..')
  : process.cwd();
config({ path: resolve(root, '.env') });

import { PrismaClient } from '@prisma/client';
import { TelegramBotClient } from '../telegram/client.js';
import { UndiciHttpClient } from '../sources/http.js';
import { NotificationService } from '../telegram/notificationService.js';
import { loadEnv } from '../config.js';

async function main() {
  const env = loadEnv();
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.error('TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set in .env');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const http = new UndiciHttpClient({ baseUrl: 'https://api.telegram.org' });
    const telegram = new TelegramBotClient(http, env.TELEGRAM_BOT_TOKEN);
    const service = new NotificationService({
      prisma,
      telegram,
      chatId: env.TELEGRAM_CHAT_ID,
    });

    const stats = await service.notifyPendingMatches(50);
    console.log(
      `✓ Notifications: ${stats.sent} sent, ${stats.skippedDuplicates} skipped (duplicates), ${stats.failed} failed`,
    );

    const retried = await service.retryFailedNotifications();
    if (retried > 0) console.log(`✓ Retried ${retried} previously failed sends`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Notify failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
