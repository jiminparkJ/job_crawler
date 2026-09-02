import type { EmploymentType, RemotePolicy } from './types.js';

export interface SearchProfile {
  id: string;
  userId: string;
  name: string;
  targetTitles: string[];
  requiredKeywords: string[];
  preferredKeywords: string[];
  excludedKeywords: string[];
  locations: string[];
  employmentTypes: EmploymentType[];
  remotePolicies: RemotePolicy[];
  minimumYearsExperience?: number | null;
  minimumMatchScore: number;
  minSalary?: number | null;
  salaryCurrency?: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type { CandidateProfile, CandidateProfileItem } from './candidate.js';
export type { EmploymentType, RemotePolicy, NormalizedJob, SourceId } from './types.js';
