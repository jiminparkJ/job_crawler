import { describe, expect, it } from 'vitest';
import { DEFAULT_TERMINOLOGY, TerminologyIndex } from '../src/index.js';

const idx = new TerminologyIndex();

describe('enriched terminology', () => {
  it('has no duplicate canonical entries per category', () => {
    const seen = new Set<string>();
    for (const e of DEFAULT_TERMINOLOGY) {
      const key = `${e.category}:${e.canonical}`;
      expect(seen.has(key), `duplicate ${key}`).toBe(false);
      seen.add(key);
    }
    expect(DEFAULT_TERMINOLOGY.length).toBeGreaterThan(80);
  });

  it('recognizes real-world Persian titles seen in production data', () => {
    const cases: [string, string][] = [
      ['توسعه‌دهنده بک‌اند بازی', 'game_developer'],
      ['کارشناس پشتیبانی فنی', 'it_support'],
      ['متخصص وایب‌کدینگ (Vibe Coder)', 'ai_prompt_engineer'],
      ['کارشناس ارشد SEO (Senior SEO Specialist)', 'seo_specialist'],
      ['کارشناس ارشد پایگاه داده (DBA)', 'database_administrator'],
      ['مدیر فناوری اطلاعات و هوش مصنوعی', 'it_director'],
      ['مهندس ارشد توسعه نرم‌افزار (AI-First)', 'software_engineer'],
      ['کارآموز توسعه‌دهنده Next.js', 'intern'],
      ['توسعه دهنده Back-End - آقا', 'backend_developer'],
      ['برنامه‌ نویس فول‌ استک (Full Stack Developer)', 'fullstack_developer'],
      ['کارشناس DevOps (بام)', 'devops_engineer'],
      ['NOC Expert', 'network_engineer'],
      ['ERP System Manager', 'erp_specialist'],
      ['Jira Admin', 'jira_admin'],
      ['Head of Software', 'engineering_manager'],
      ['Chief Technology Officer', 'cto'],
      ['Business Intelligence', 'bi_specialist'],
      ['HR Data Analyst', 'hr_specialist'],
    ];
    for (const [text, want] of cases) {
      const hits = idx.scan(text, 'title');
      expect(
        hits.has(want),
        `"${text}" should map to ${want} (got ${[...hits.keys()].join(',')})`,
      ).toBe(true);
    }
  });

  it('recognizes newly added skills in both languages', () => {
    const cases: [string, string][] = [
      ['هوش مصنوعی و یادگیری ماشین', 'ai_llm'],
      ['تجربه کاربری với Figma', 'figma'],
      ['Vibe coding و AI', 'ai_llm'],
      ['میکروسرویس و داکر', 'microservices'],
      ['سئو و بهینه سازی', 'seo'],
      ['تحلیل داده با Power BI', 'data_analytics'],
      ['سیسکو و میکروتیک', 'networking'],
      ['پروکسی معکوس nginx', 'nginx'],
      ['کانتینرهای داکر', 'docker'],
      ['مانیتورینگ با Grafana', 'prometheus'],
    ];
    for (const [text, want] of cases) {
      const hits = idx.scan(text, 'skill');
      expect(hits.has(want), `"${text}" should include ${want}`).toBe(true);
    }
  });

  it('recognizes new industries and locations', () => {
    expect(idx.scan('فروشگاه های زنجیره ای افق کوروش', 'industry').has('retail')).toBe(true);
    expect(idx.scan('صرافی ارز دیجیتال', 'industry').has('banking')).toBe(true);
    expect(idx.scan('Qom, Ghom', 'location').has('qom')).toBe(true);
    expect(idx.scan('Alborz', 'location').has('alborz')).toBe(true);
  });

  it('seniority words in Persian titles are recognized', () => {
    expect(idx.scan('برنامه‌نویس ارشد بک‌اند', 'seniority').has('senior')).toBe(true);
    expect(idx.scan('کارشناس جوان', 'seniority').has('junior')).toBe(false);
  });
});
