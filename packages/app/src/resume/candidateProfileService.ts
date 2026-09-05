/**
 * Candidate-profile ingestion: resume file → text → ResumeAnalyzer →
 * persisted CandidateProfile row.
 */

import type { PrismaClient } from '@prisma/client';
import { ResumeAnalyzer, type CandidateProfile } from '@job-hunter/core';
import { extractResumeText } from './extract.js';

export class CandidateProfileService {
  private readonly analyzer: ResumeAnalyzer;

  constructor(
    private readonly prisma: PrismaClient,
    analyzer?: ResumeAnalyzer,
  ) {
    this.analyzer = analyzer ?? new ResumeAnalyzer();
  }

  /**
   * Ingest a resume file for a user. Single-profile MVP: replaces the
   * user's latest profile row on re-ingest (history is not kept).
   */
  async ingestResume(opts: {
    userId: string;
    buffer: Buffer | Uint8Array;
    filename: string;
  }): Promise<{ profileId: string; profile: CandidateProfile }> {
    const { text, format } = await extractResumeText(opts.buffer, opts.filename);
    const profile = this.analyzer.analyze(opts.userId, text);

    const data = {
      resumeFile: `${opts.filename} (${format})`,
      fullName: profile.fullName,
      email: profile.email,
      phone: profile.phone,
      summary: profile.summary,
      profile: profile as unknown as object,
      extractedAt: new Date(),
    };

    const existing = await this.prisma.candidateProfile.findFirst({
      where: { userId: opts.userId },
      orderBy: { extractedAt: 'desc' },
      select: { id: true },
    });

    const row = existing
      ? await this.prisma.candidateProfile.update({ where: { id: existing.id }, data })
      : await this.prisma.candidateProfile.create({
          data: { userId: opts.userId, ...data },
        });

    return { profileId: row.id, profile };
  }

  /** Load the persisted structured profile for a user, if any. */
  async getProfile(userId: string): Promise<CandidateProfile | null> {
    const row = await this.prisma.candidateProfile.findFirst({
      where: { userId },
      orderBy: { extractedAt: 'desc' },
    });
    if (!row) return null;
    return row.profile as unknown as CandidateProfile;
  }
}
