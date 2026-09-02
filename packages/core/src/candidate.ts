/**
 * Candidate profile extracted from a resume.
 *
 * Every item carries an `origin` flag so inferred information is clearly
 * distinguishable from information explicitly written in the resume.
 */
export type ProfileItemOrigin = 'explicit' | 'inferred';

export interface CandidateProfileItem {
  value: string;
  origin: ProfileItemOrigin;
}

export interface CandidateProfile {
  candidateId: string;
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  summary?: string | null;
  skills: CandidateProfileItem[];
  jobTitles: CandidateProfileItem[];
  experienceYears: number | null;
  experienceEntries: ExperienceEntry[];
  education: EducationEntry[];
  languages: CandidateProfileItem[];
  industries: CandidateProfileItem[];
  locations: CandidateProfileItem[];
  seniority: CandidateProfileItem[];
  extractedAt: Date;
}

export interface ExperienceEntry {
  title: string;
  company?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  description?: string | null;
}

export interface EducationEntry {
  degree?: string | null;
  field?: string | null;
  institution?: string | null;
  year?: string | null;
}

export interface ResumeExtractionInput {
  candidateId: string;
  text: string;
}

export interface ResumeExtractor {
  extract(input: ResumeExtractionInput): Promise<CandidateProfile>;
}
