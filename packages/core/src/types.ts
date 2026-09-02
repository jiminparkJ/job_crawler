export type EmploymentType =
  'full_time' | 'part_time' | 'contract' | 'internship' | 'freelance' | 'temporary';

export type RemotePolicy = 'remote' | 'onsite' | 'hybrid';

export interface NormalizedJob {
  /** Globally unique logical-job identifier (stable dedup key). */
  id: string;
  source: SourceId;
  externalId: string;
  title: string;
  company: string;
  description: string;
  location?: string | null;
  remote: RemotePolicy | null;
  employmentType: EmploymentType | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  postedAt?: Date | null;
  url: string;
  /** Raw source-specific payload for debugging/forensics. */
  raw?: unknown;
  skills?: string[];
}

export type SourceId = 'jobvision' | 'irantalent' | 'linkedin';

export interface SourceListing {
  source: SourceId;
  externalId: string;
  /** URL exactly as discovered on the source website. */
  url: string;
  fetchedAt: Date;
}

export interface SearchQuery {
  keywords?: string[];
  locations?: string[];
  page?: number;
}

export interface SourceAdapter {
  readonly id: SourceId;
  search(query: SearchQuery): Promise<SourceListing[]>;
  fetchJob(externalId: string): Promise<RawJobResult>;
}

export interface RawJobResult {
  externalId: string;
  url: string;
  /** Arbitrary source-specific representation. */
  data: unknown;
}

export interface SourceRunStats {
  sourceId: SourceId;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  found: number;
  created: number;
  updated: number;
  duplicates: number;
  errors: number;
  errorDetails: string[];
}
