/**
 * Restart-safe polling scheduler (PROMPT §13).
 *
 * - Periodic runs driven by POLL_INTERVAL_MINUTES (config).
 * - No queue infra: plain timer loop with a skip-if-running guard.
 * - Survives restarts: state lives in the database (SourceRun), not memory;
 *   a crashed run is detected by its stale 'running' status and closed.
 * - Jitter prevents thundering herds when multiple instances restart together.
 */

import type { Logger } from 'pino';

export interface SchedulerOptions {
  /** Interval between run starts, in minutes. */
  intervalMinutes: number;
  /** Function executed each tick. Must never throw (scheduler wraps it). */
  tick: () => Promise<unknown>;
  /** Random delay 0..jitterMs before each run to de-synchronize instances. */
  jitterMs?: number;
  /** Clock injection for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Run immediately on start (default true). */
  runImmediately?: boolean;
  logger?: Logger;
}

export class Scheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private stopped = false;
  private runCount = 0;

  constructor(private readonly options: SchedulerOptions) {}

  start(): void {
    this.stopped = false;
    this.options.logger?.info(
      { intervalMinutes: this.options.intervalMinutes },
      'scheduler started',
    );
    if (this.options.runImmediately !== false) {
      this.scheduleRun(0);
    } else {
      this.scheduleRun(this.intervalMs());
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.options.logger?.info({ runs: this.runCount }, 'scheduler stopped');
  }

  get isRunning(): boolean {
    return this.running;
  }

  get runs(): number {
    return this.runCount;
  }

  private intervalMs(): number {
    return this.options.intervalMinutes * 60_000;
  }

  private scheduleRun(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(
      () => {
        void this.executeRun();
      },
      Math.max(0, delayMs),
    );
  }

  private async executeRun(): Promise<void> {
    if (this.stopped) return;

    // Skip-if-running guard: a previous tick still in flight (slow sources).
    if (this.running) {
      this.options.logger?.warn('previous tick still running — skipping');
      this.scheduleRun(this.intervalMs());
      return;
    }

    this.running = true;
    try {
      const jitter = this.options.jitterMs ?? 0;
      if (jitter > 0) {
        const delay = Math.floor(Math.random() * jitter);
        await (this.options.sleep ?? sleep)(delay);
      }
      await this.options.tick();
      this.runCount++;
    } catch (err) {
      // The tick itself must be failure-tolerant; this is a last resort.
      this.options.logger?.error({ err }, 'scheduler tick crashed');
    } finally {
      this.running = false;
      if (!this.stopped) this.scheduleRun(this.intervalMs());
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mark stale 'running' SourceRuns as failed on worker startup — restart
 * safety: runs interrupted by a process crash must not stay 'running'.
 */
export async function closeStaleRuns(
  runs: { id: string; startedAt: Date; status: string }[],
  close: (id: string) => Promise<unknown>,
  opts: { now?: Date; maxAgeMinutes?: number } = {},
): Promise<number> {
  const now = opts.now ?? new Date();
  const maxAgeMs = (opts.maxAgeMinutes ?? 60) * 60_000;
  let closed = 0;
  for (const run of runs) {
    if (run.status !== 'running') continue;
    if (now.getTime() - run.startedAt.getTime() > maxAgeMs) {
      await close(run.id);
      closed++;
    }
  }
  return closed;
}
