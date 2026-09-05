/**
 * Worker startup: Prisma lifecycle, stale-run recovery, scheduler wiring.
 * Used by the server entrypoint; exported separately for tests.
 */

import { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import { Scheduler } from './scheduler.js';
import { createWorkerTick } from './worker.js';
import type { TelegramUpdateListener } from '../telegram/updateListener.js';

export interface WorkerStartupOptions {
  intervalMinutes: number;
  jobvisionEnabled: boolean;
  irantalentEnabled: boolean;
  keywords?: string[];
  pageSize?: number;
  maxPages?: number;
  irantalentCategories?: string[];
  logger?: Logger;
  prisma?: PrismaClient;
  /** When set, a Telegram update listener polls button callbacks. */
  telegram?: {
    botToken: string;
    chatId: string;
  };
}

export interface RunningWorker {
  prisma: PrismaClient;
  scheduler: Scheduler;
  telegramListener?: TelegramUpdateListener;
  stop: () => Promise<void>;
}

/** Close SourceRuns left 'running' by a crashed previous process. */
export async function recoverStaleSourceRuns(
  prisma: PrismaClient,
  opts: { now?: Date; maxAgeMinutes?: number } = {},
): Promise<number> {
  const running = await prisma.sourceRun.findMany({
    where: { status: 'running' },
    select: { id: true, startedAt: true, status: true },
  });
  const stale = running.filter((r) => {
    const now = opts.now ?? new Date();
    const maxAgeMs = (opts.maxAgeMinutes ?? 60) * 60_000;
    return now.getTime() - r.startedAt.getTime() > maxAgeMs;
  });
  await prisma.sourceRun.updateMany({
    where: { id: { in: stale.map((r) => r.id) } },
    data: {
      status: 'failed',
      finishedAt: new Date(),
      errorDetails: ['closed: stale run recovered at startup'],
    },
  });
  return stale.length;
}

export async function startWorker(options: WorkerStartupOptions): Promise<RunningWorker> {
  const prisma = options.prisma ?? new PrismaClient();

  const recovered = await recoverStaleSourceRuns(prisma);
  if (recovered > 0) {
    options.logger?.info({ recovered }, 'closed stale source runs from previous process');
  }

  const tick = createWorkerTick(
    prisma,
    {
      jobvisionEnabled: options.jobvisionEnabled,
      irantalentEnabled: options.irantalentEnabled,
      keywords: options.keywords ?? ['node.js', 'backend', 'developer'],
      pageSize: options.pageSize ?? 20,
      maxPages: options.maxPages ?? 3,
      irantalentCategories: options.irantalentCategories,
      matchAndNotify: true,
      ...(options.telegram?.botToken && options.telegram.chatId
        ? {
            telegram: {
              botToken: options.telegram.botToken,
              chatId: options.telegram.chatId,
            },
          }
        : {}),
    },
    options.logger,
  );

  const scheduler = new Scheduler({
    intervalMinutes: options.intervalMinutes,
    tick,
    jitterMs: 5_000,
    logger: options.logger,
  });
  scheduler.start();

  // Telegram button-feedback listener (Save / Not Relevant), when configured.
  let telegramListener: TelegramUpdateListener | undefined;
  if (options.telegram?.botToken && options.telegram.chatId) {
    const { UndiciHttpClient } = await import('../sources/http.js');
    const { TelegramBotClient } = await import('../telegram/client.js');
    const { NotificationService } = await import('../telegram/notificationService.js');
    const { TelegramUpdateListener } = await import('../telegram/updateListener.js');
    const { ProfileBotCommands } = await import('../telegram/profileCommands.js');
    const { SettingsMenu } = await import('../telegram/settingsMenu.js');

    const telegram = new TelegramBotClient(
      new UndiciHttpClient({ baseUrl: 'https://api.telegram.org' }),
      options.telegram.botToken,
    );
    const notifications = new NotificationService({
      prisma,
      telegram,
      chatId: options.telegram.chatId,
      logger: options.logger,
    });
    const settingsMenu = new SettingsMenu(prisma, telegram);
    telegramListener = new TelegramUpdateListener(telegram, notifications, {
      pollMs: 5_000,
      logger: options.logger,
      profileCommands: new ProfileBotCommands(prisma),
      settingsMenu,
      jobUrlForMatch: async (matchId) => {
        const m = await prisma.jobMatch
          .findUnique({
            where: { id: matchId },
            select: { job: { select: { canonicalUrl: true } } },
          })
          .catch(() => null);
        return m?.job.canonicalUrl;
      },
    });
    // Record the Telegram chat id on the profile owner so bot commands can
    // map the chat to the right user (multi-user ready).
    const owner = await prisma.searchProfile.findFirst({
      orderBy: { updatedAt: 'desc' },
      select: { userId: true },
    });
    if (owner) {
      await prisma.user
        .update({ where: { id: owner.userId }, data: { telegram: options.telegram.chatId } })
        .catch(() => null);
    }
    // Register the "/" command menu shown by Telegram's UI.
    await telegram
      .setMyCommands([
        { command: 'settings', description: 'Open the settings menu (buttons)' },
        { command: 'profile', description: 'Show your search profile' },
        { command: 'set', description: 'Set a field: /set titles A,B' },
        { command: 'clear', description: 'Empty a field: /clear excluded' },
        { command: 'pause', description: 'Pause notifications' },
        { command: 'resume', description: 'Resume notifications' },
        { command: 'help', description: 'Command reference' },
      ])
      .catch(() => null);
    telegramListener.start();
  }

  return {
    prisma,
    scheduler,
    telegramListener,
    stop: async () => {
      scheduler.stop();
      telegramListener?.stop();
      if (!options.prisma) await prisma.$disconnect(); // only if we own it
    },
  };
}
