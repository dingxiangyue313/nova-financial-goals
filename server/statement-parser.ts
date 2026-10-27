import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { tmpdir } from 'node:os';
import { IsoDateSchema, type ImportIssue, type StatementImportBatch } from '../shared/contracts.ts';

export const MAX_STATEMENT_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 10_000;
export const STATEMENT_TEMPLATES = (['csv', 'xlsx', 'pdf', 'image'] as const).map(format => ({
  id: `bank-${format}-v1`, format, accountId: 'checking', sourceKind: 'bank' as const,
  columns: ['date', 'description', 'amount'], currency: 'CNY',
}));
export type ParsedIssue = Pick<ImportIssue, 'kind' | 'severity' | 'field' | 'originalValue'>;
export interface ParsedRow {
  rowNumber: number; date: string | null; rawDescription: string; amountCents: number | null;
  category: string; merchantId: string | null; confidence: number;
  originalValues: { date: string; description: string; amount: string }; issues: ParsedIssue[];
}
export interface ParsedStatement {
  templateId: string; format: StatementImportBatch['format']; accountId: string; sourceKind: 'bank';
  rows: ParsedRow[]; confidence: number; issues: ParsedIssue[];
}

export function statementAmount(value: string): number | null {
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const negative = value.startsWith('-'); const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? (negative ? -cents : cents) : null;
}

const issue = (kind: ParsedIssue['kind'], field: string, originalValue: string | number | null,
  severity: ParsedIssue['severity'] = 'blocking'): ParsedIssue => ({ kind, field, originalValue, severity });

export async function parseStatementBuffer(input: { buffer: Buffer; fileName: string; mimeType: string; templateId: string }): Promise<ParsedStatement> {
  if (input.buffer.length > MAX_STATEMENT_BYTES) throw new Error('STATEMENT_TOO_LARGE');
  const template = STATEMENT_TEMPLATES.find(item => item.id === input.templateId);
  if (!template) throw new Error('STATEMENT_TEMPLATE_UNKNOWN');
  const { buffer, mimeType } = input;
  const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpg = buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  const pdf = buffer.subarray(0, 5).toString() === '%PDF-';
  const zip = buffer.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]));
  const extension = input.fileName.split('.').at(-1)?.toLowerCase();
  const matches = template.format === 'csv' ? mimeType === 'text/csv' && extension === 'csv' && !png && !jpg && !pdf && !zip && !buffer.includes(0)
    : template.format === 'xlsx' ? mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' && extension === 'xlsx' && zip
    : template.format === 'pdf' ? mimeType === 'application/pdf' && extension === 'pdf' && pdf
    : (mimeType === 'image/png' && extension === 'png' && png) || (mimeType === 'image/jpeg' && ['jpg', 'jpeg'].includes(extension ?? '') && jpg);
  if (!matches) throw new Error('STATEMENT_FORMAT_MISMATCH');
  let records: string[][] = []; let confidence = 1; const issues: ParsedIssue[] = [];
  try {
    if (template.format === 'csv') {
      records = parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer), { bom: true, skip_empty_lines: true,
        max_record_size: 16_384, trim: true });
    } else if (template.format === 'xlsx') {
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(buffer as unknown as Parameters<typeof book.xlsx.load>[0]);
      const sheet = book.worksheets[0];
      if (!sheet || sheet.rowCount > MAX_ROWS + 1 || sheet.columnCount !== 3) throw new Error('STATEMENT_INVALID_TABLE');
      sheet.eachRow(row => records.push([1, 2, 3].map(column => {
        const value = row.getCell(column).value;
        if (typeof value !== 'string' && typeof value !== 'number' && value !== null) throw new Error('STATEMENT_INVALID_CELL');
        return String(value ?? '').trim();
      })));
    } else {
      let lines: string[] = [];
      if (template.format === 'pdf') {
        if (/\/Encrypt\b/.test(buffer.toString('latin1'))) throw new Error('STATEMENT_PDF_ENCRYPTED');
        const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: true,
          disableFontFace: true, verbosity: 0 });
        try {
          const document = await task.promise;
          if (document.numPages > 50) throw new Error('STATEMENT_TOO_MANY_PAGES');
          for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
            const page = await document.getPage(pageNumber); const content = await page.getTextContent();
            let line = ''; let previousY: number | undefined;
            for (const item of content.items) {
              if (!('str' in item)) continue;
              if (previousY !== undefined && Math.abs(item.transform[5] - previousY) > 3 && line.trim()) { lines.push(line.trim()); line = ''; }
              line += `${item.str} `; previousY = item.transform[5];
              if (item.hasEOL && line.trim()) { lines.push(line.trim()); line = ''; }
            }
            if (line.trim()) lines.push(line.trim());
          }
        } finally { await task.destroy(); }
      } else {
        const { createWorker } = await import('tesseract.js');
        const worker = await createWorker('eng', 1, { cachePath: tmpdir(), cacheMethod: 'write', logger: () => {} });
        try {
          const result = await worker.recognize(buffer);
          confidence = result.data.confidence / 100;
          lines = result.data.text.split('\n').map(line => line.trim()).filter(Boolean);
        } finally { await worker.terminate(); }
        if (confidence < 0.8 || !lines.length) issues.push(issue('low_confidence', 'confidence', confidence));
      }
      records = [['date', 'description', 'amount'], ...lines.map(line => {
        const match = line.match(/^(\S+)\s+(.+?)\s+(\S+)$/);
        return match ? match.slice(1) : [line, '', ''];
      })];
    }
  } catch (error) {
    // Parser diagnostics can contain private descriptions; expose only fixed error codes.
    if (error instanceof Error && /^STATEMENT_[A-Z_]+$/.test(error.message)) throw error;
    if (error instanceof Error && error.name === 'PasswordException') throw new Error('STATEMENT_PDF_ENCRYPTED');
    throw new Error('STATEMENT_PARSE_FAILED');
  }
  if (records[0]?.join(',') !== 'date,description,amount' || records.length > MAX_ROWS + 1)
    throw new Error('STATEMENT_INVALID_TABLE');
  const seen = new Set<string>();
  const rows = records.slice(1).map((record, index): ParsedRow => {
    if (record.length !== 3) throw new Error('STATEMENT_INVALID_TABLE');
    const [rawDate, rawDescription, amount] = record;
    const date = IsoDateSchema.safeParse(rawDate).success ? rawDate : null;
    const amountCents = statementAmount(amount); const rowIssues: ParsedIssue[] = [];
    if (!date) rowIssues.push(issue('invalid_date', 'date', rawDate));
    if (amountCents === null) rowIssues.push(issue('invalid_amount', 'amountCents', amount));
    if (!rawDescription) rowIssues.push(issue('missing_field', 'title', rawDescription));
    const key = JSON.stringify([date, rawDescription, amountCents]);
    if (date && amountCents !== null && seen.has(key)) rowIssues.push(issue('duplicate', 'excludedReason', 'duplicate', 'info'));
    seen.add(key);
    const merchant = ({ Cafe: ['cafe', 'dining'], 'CloudBox Plus': ['cloudbox', 'subscriptions'],
      Rent: ['rent', 'housing'], Transport: ['transport', 'transport'] } as Record<string, string[]>)[rawDescription];
    return { rowNumber: index + 1, date, rawDescription, amountCents, category: merchant?.[1] ?? 'unclassified',
      merchantId: merchant?.[0] ?? null, confidence, originalValues: { date: rawDate, description: rawDescription, amount }, issues: rowIssues };
  });
  if (!rows.length && !issues.length) throw new Error('STATEMENT_EMPTY');
  return { templateId: template.id, format: template.format, accountId: template.accountId, sourceKind: template.sourceKind, rows, confidence, issues };
}
