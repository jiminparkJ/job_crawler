/**
 * Resume file → text extraction for PDF / DOCX / TXT.
 * Returns plain text suitable for ResumeAnalyzer; throws on unsupported
 * formats or binary garbage so callers can report a clear error.
 */

export type ResumeFileFormat = 'pdf' | 'docx' | 'txt';

export interface ExtractedResumeText {
  format: ResumeFileFormat;
  text: string;
}

export function detectFormat(filename: string): ResumeFileFormat {
  const ext = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  switch (ext) {
    case 'pdf':
      return 'pdf';
    case 'docx':
      return 'docx';
    case 'txt':
    case 'md':
      return 'txt';
    default:
      throw new Error(`Unsupported resume format: ${filename}`);
  }
}

/** Extract text from a resume file buffer. */
export async function extractResumeText(
  buffer: Buffer | Uint8Array,
  filename: string,
): Promise<ExtractedResumeText> {
  const format = detectFormat(filename);
  switch (format) {
    case 'pdf':
      return { format, text: await extractPdf(buffer) };
    case 'docx':
      return { format, text: await extractDocx(buffer) };
    case 'txt':
      return { format, text: normalizeTxt(buffer) };
  }
}

async function extractPdf(buffer: Buffer | Uint8Array): Promise<string> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    // getText() lazy-loads the document; load() is typed private in v2.
    const result = (await parser.getText()) as { text?: string };
    const text = (result.text ?? '').trim();
    if (!text) throw new Error('PDF contains no extractable text (scanned image?)');
    return text;
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(buffer: Buffer | Uint8Array): Promise<string> {
  const mammoth = await import('mammoth');
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
  const text = value.trim();
  if (!text) throw new Error('DOCX contains no extractable text');
  return text;
}

function normalizeTxt(buffer: Buffer | Uint8Array): string {
  const text = Buffer.from(buffer)
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trim();
  if (!text) throw new Error('TXT file is empty');
  if (text.includes('\u0000')) throw new Error('TXT file appears to be binary');
  return text;
}
