import { describe, expect, it, vi } from 'vitest';
import { Scheduler, closeStaleRuns } from '../src/pipeline/scheduler.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('Scheduler', () => {
  it('runs the tick immediately by default and reschedules', async () => {
    const ticks: number[] = [];
    const tick = vi.fn(async () => {
      ticks.push(Date.now());
    });
    const sched = new Scheduler({ intervalMinutes: 30, tick });
    sched.start();
    await vi.waitFor(() => expect(tick).toHaveBeenCalled());
    sched.stop();
    expect(sched.runs).toBe(1);
  });

  it('does not overlap ticks when the previous one is slow', async () => {
    const gate = deferred();
    let running = 0;
    let overlaps = 0;
    const tick = vi.fn(async () => {
      running++;
      if (running > 1) overlaps++;
      await gate.promise; // never resolves during test
      running--;
    });
    const sched = new Scheduler({ intervalMinutes: 0, tick, runImmediately: true });
    sched.start();
    await vi.waitFor(() => expect(tick).toHaveBeenCalledTimes(1));
    // interval 0 → next run fires while the first is still in flight
    await new Promise((r) => setTimeout(r, 30));
    expect(tick).toHaveBeenCalledTimes(1); // skipped, not overlapped
    expect(overlaps).toBe(0);
    gate.resolve();
    sched.stop();
  });

  it('survives a crashing tick and keeps scheduling', async () => {
    const second = deferred();
    const tick = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockImplementationOnce(async () => second.resolve());
    const sched = new Scheduler({ intervalMinutes: 0, tick, runImmediately: true });
    sched.start();
    await second.promise; // second tick executed ⇒ scheduling continued after crash
    expect(tick.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(sched.runs).toBe(0); // crashed ticks don't count as completed runs
    sched.stop();
  });

  it('stop() prevents further runs', async () => {
    const tick = vi.fn(async () => {});
    const sched = new Scheduler({ intervalMinutes: 0, tick, runImmediately: false });
    sched.start();
    sched.stop();
    await new Promise((r) => setTimeout(r, 20));
    expect(tick).not.toHaveBeenCalled();
  });

  it('applies jitter sleep before the tick', async () => {
    const sleep = vi.fn(async () => {});
    const tick = vi.fn(async () => {});
    const sched = new Scheduler({ intervalMinutes: 30, tick, jitterMs: 50, sleep });
    sched.start();
    await vi.waitFor(() => expect(tick).toHaveBeenCalled());
    expect(sleep).toHaveBeenCalledTimes(1);
    sched.stop();
  });
});

describe('closeStaleRuns', () => {
  const now = new Date('2026-09-05T12:00:00Z');

  it('closes only stale running runs', async () => {
    const runs = [
      { id: 'fresh', startedAt: new Date('2026-09-05T11:55:00Z'), status: 'running' },
      { id: 'stale', startedAt: new Date('2026-09-05T10:00:00Z'), status: 'running' },
      { id: 'done', startedAt: new Date('2026-09-05T09:00:00Z'), status: 'success' },
    ];
    const closed: string[] = [];
    const count = await closeStaleRuns(runs, async (id) => closed.push(id), {
      now,
      maxAgeMinutes: 60,
    });
    expect(count).toBe(1);
    expect(closed).toEqual(['stale']);
  });

  it('closes nothing when all runs are recent', async () => {
    const runs = [{ id: 'r1', startedAt: new Date('2026-09-05T11:30:00Z'), status: 'running' }];
    const closed = await closeStaleRuns(runs, async () => {}, { now, maxAgeMinutes: 60 });
    expect(closed).toBe(0);
  });
});
