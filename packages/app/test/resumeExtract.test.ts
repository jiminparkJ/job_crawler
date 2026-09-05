import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectFormat, extractResumeText } from '../src/resume/extract.js';
import { ResumeAnalyzer } from '@job-hunter/core';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures', 'resume');

const pdfBuffer = readFileSync(join(fixtures, 'resume.pdf'));
const docxBuffer = readFileSync(join(fixtures, 'resume.docx'));
const txtBuffer = readFileSync(join(fixtures, 'resume.txt'));

describe('detectFormat', () => {
  it('maps extensions to formats', () => {
    expect(detectFormat('resume.pdf')).toBe('pdf');
    expect(detectFormat('CV.DOCX')).toBe('docx');
    expect(detectFormat('resume.txt')).toBe('txt');
    expect(detectFormat('notes.md')).toBe('txt');
  });

  it('rejects unsupported formats', () => {
    expect(() => detectFormat('image.png')).toThrow(/Unsupported resume format/);
    expect(() => detectFormat('noext')).toThrow(/Unsupported resume format/);
  });
});

describe('extractResumeText', () => {
  it('extracts text from PDF', async () => {
    const { format, text } = await extractResumeText(pdfBuffer, 'resume.pdf');
    expect(format).toBe('pdf');
    expect(text).toContain('Ali Karimi');
    expect(text).toContain('Node.js, TypeScript, PostgreSQL');
    expect(text).toContain('Digikala');
  });

  it('extracts text from DOCX', async () => {
    const { format, text } = await extractResumeText(docxBuffer, 'resume.docx');
    expect(format).toBe('docx');
    expect(text).toContain('Ali Karimi');
    expect(text).toContain('Senior Backend Developer - Digikala');
    expect(text).toContain('English (fluent)');
  });

  it('extracts text from TXT (with BOM tolerated)', async () => {
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), txtBuffer]);
    const { format, text } = await extractResumeText(bom, 'resume.txt');
    expect(format).toBe('txt');
    expect(text).toContain('Ali Karimi');
  });

  it('throws for a scanned/empty PDF', async () => {
    // A tiny invalid PDF: pdf-parse will throw a parse error
    const garbage = Buffer.from('%PDF-1.4 not actually a pdf');
    await expect(extractResumeText(garbage, 'x.pdf')).rejects.toThrow();
  });

  it('throws for empty TXT', async () => {
    await expect(extractResumeText(Buffer.from('   '), 'x.txt')).rejects.toThrow(/empty/i);
  });

  it('throws for binary content in a .txt file', async () => {
    const binary = Buffer.from([0x00, 0x01, 0x02, 0x00, 0x03]);
    await expect(extractResumeText(binary, 'x.txt')).rejects.toThrow(/binary/i);
  });
});

describe('extracted text feeds ResumeAnalyzer (format parity)', () => {
  const analyzer = new ResumeAnalyzer();

  it('PDF and DOCX yield comparable profiles', async () => {
    const pdfText = await extractResumeText(pdfBuffer, 'resume.pdf');
    const docxText = await extractResumeText(docxBuffer, 'resume.docx');
    const txtText = await extractResumeText(txtBuffer, 'resume.txt');

    const profiles = [pdfText, docxText, txtText].map((r) => analyzer.analyze('cand-1', r.text));

    for (const p of profiles) {
      expect(p.fullName).toBe('Ali Karimi');
      expect(p.email).toBe('ali.karimi@example.com');
      const skills = p.skills.map((s) => s.value);
      expect(skills).toContain('node.js');
      expect(skills).toContain('typescript');
      expect(skills).toContain('postgresql');
      expect(p.locations.map((l) => l.value)).toContain('tehran');
      expect(p.experienceYears).toBeGreaterThanOrEqual(8);
    }
  });
});
