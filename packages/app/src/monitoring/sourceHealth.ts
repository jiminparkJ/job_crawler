/**
 * Source health monitoring (PROMPT M9/§14): aggregates SourceRun history into
 * per-source health for the ops endpoint and scheduler backoff decisions.
 */

import { PrismaClient } from '@prisma/client';

export interface SourceHealth {
  sourceId: string;
  enabled: boolean;
  runsLast24h: number;
  successRate: number;
  lastRunAt: Date | null;
  lastStatus: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  jobsFoundLast24h: number;
  jobsCreatedLast24h: number;
  /** Health verdict for monitoring. */
  healthy: boolean;
}

export class SourceHealthMonitor {
  constructor(private readonly prisma: PrismaClient) {}

  async sourceHealth(): Promise<SourceHealth[]> {
    const sources = await this.prisma.jobSource.findMany();
    const since = new Date(Date.now() - 24 * 60 * 60_000);

    const reports: SourceHealth[] = [];
    for (const source of sources) {
      const runs = await this.prisma.sourceRun.findMany({
        where: { sourceId: source.id, startedAt: { gte: since } },
        orderBy: { startedAt: 'desc' },
      });

      const successes = runs.filter((r) => r.status === 'success').length;
      const partials = runs.filter((r) => r.status === 'partial').length;
      const last = runs[0] ?? null;

      // Count consecutive failures from the most recent runs.
      let consecutiveFailures = 0;
      for (const run of runs) {
        if (run.status === 'failed') consecutiveFailures++;
        else break;
      }

      const successRate = runs.length > 0 ? (successes + partials) / runs.length : 1;
      const healthy = consecutiveFailures < 3 && (runs.length === 0 || successRate >= 0.5);

      reports.push({
        sourceId: source.id,
        enabled: source.enabled,
        runsLast24h: runs.length,
        successRate,
        lastRunAt: last?.startedAt ?? null,
        lastStatus: last?.status ?? null,
        lastError: last?.errorDetails[last.errorDetails.length - 1] ?? null,
        consecutiveFailures,
        jobsFoundLast24h: runs.reduce((a, r) => a + r.found, 0),
        jobsCreatedLast24h: runs.reduce((a, r) => a + r.created, 0),
        healthy,
      });
    }

    return reports;
  }
}
