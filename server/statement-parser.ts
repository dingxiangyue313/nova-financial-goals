import path from 'node:path';
import { parse as parseCsv } from 'csv-parse/sync';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import type { ImportIssue, NormalizedStatementRow } from '../shared/contracts.ts';
import { CATEGORY_MAP } from './money-mission-fixture.ts';

export const STATEMENT_TEMPLATES = ['nova-synthetic-v1', 'bank-v1', 'wechat-v1', 'alipay-v1'] as const;
export type ParsedStatement = { templateId: string; format: 'csv' | 'xlsx' | 'pdf' | 'image'; rows: NormalizedStatementRow[]; issues: ImportIssue[] };
export function parseCsvRecords(text: string): string[][] {
  try { return parseCsv(text, { bom: true, skip_empty_lines: true, relax_column_count: true, max_record_size: 10000 }) as string[][]; }
  catch { throw new Error('DATA_CSV_INVALID'); }
}
export function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export function parseAmount(value: string, unit: 'cents' | 'yuan'): number | null {
  const text = value.trim().replace(/[¥￥,\s]/g, '');
  if (!(unit === 'cents' ? /^-?\d+$/ : /^-?\d+(\.\d{1,2})?$/).test(text)) return null;
  const negative = text.startsWith('-'); const [whole, fraction = ''] = text.replace(/^-/, '').split('.');
  const amount = unit === 'cents' ? Number(whole) : Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(amount) ? amount * (negative ? -1 : 1) : null;
}

function normalize(records: string[][], templateId: string, format: ParsedStatement['format'], confidence = 1): ParsedStatement {
  if (!records.length) throw new Error('DATA_FILE_EMPTY');
  if (records.length > 10001) throw new Error('DATA_RECORD_LIMIT');
  const headers = records[0].map(h => h.replace(/^\uFEFF/, '').trim().replace(/[A-Z]/g,c=>c.toLowerCase()));
  const index = (names: string[]) => headers.findIndex(h => names.includes(h));
  const dateIndex = index(['date', '交易时间', '交易日期', '时间']);
  const centsIndex = index(['cents', 'amountcents']); const yuanIndex = index(['金额', '金额(元)', '金额（元）', '交易金额']);
  const titleIndex = index(['merchant', 'title', '交易对方', '商户', '商品']);
  const idIndex = index(['id', '交易单号', '流水号']); const categoryIndex = index(['category', '分类']); const sourceIndex = index(['source', '来源']);
  if (dateIndex < 0 || (centsIndex < 0 && yuanIndex < 0) || titleIndex < 0) throw new Error('DATA_REQUIRED_COLUMNS');
  const rows: NormalizedStatementRow[] = []; const issues: ImportIssue[] = [];
  records.slice(1).forEach((record, offset) => {
    const title = (record[titleIndex] ?? '').trim().slice(0, 240); const rawDate = (record[dateIndex] ?? '').trim();
    const normalizedDate = rawDate.slice(0, 10).replace(/\//g, '-');
    const rawAmount = record[centsIndex >= 0 ? centsIndex : yuanIndex] ?? ''; const amount = parseAmount(rawAmount, centsIndex >= 0 ? 'cents' : 'yuan');
    const source = sourceIndex >= 0 ? record[sourceIndex] : ''; const rawCategory = categoryIndex >= 0 ? record[categoryIndex] ?? '' : '';
    const sourceKind = source === '微信' || templateId === 'wechat-v1' ? 'wechat_pay' : source === '支付宝' || templateId === 'alipay-v1' ? 'alipay' : 'bank';
    const externalId = (idIndex >= 0 ? record[idIndex]?.trim() : '') || createHash('sha256').update(JSON.stringify([normalizedDate, title, rawAmount, sourceKind, offset])).digest('hex').slice(0, 24);
    const id = `statement:${sourceKind}:${externalId}:${offset}`;
    const issue = (kind: ImportIssue['kind'], field: string, originalValue: string, severity: ImportIssue['severity'] = 'blocking') => issues.push({ id: `issue:${offset}:${kind}`, batchId: '', rowId: id, kind, severity, field, originalValue, correctedValue: null, resolved: severity === 'info' });
    if (!validDate(normalizedDate)) issue('invalid_date', 'date', rawDate);
    if (amount === null) issue('invalid_amount', 'amountCents', rawAmount);
    if (!title) issue('missing_field', 'title', '');
    const category = CATEGORY_MAP[rawCategory] ?? (Object.values(CATEGORY_MAP).includes(rawCategory) ? rawCategory : 'unclassified');
    if (confidence < .85 || category === 'unclassified') issue('low_confidence', 'category', rawCategory, 'review');
    rows.push({ id, externalId, accountId: 'checking', currency: 'CNY', date: validDate(normalizedDate) ? normalizedDate : '1970-01-01', title: title || '待核对商户', merchantId: title === 'CloudBox Plus' ? 'cloudbox-plus' : category === 'income' && /工资|salary/i.test(title) ? 'salary' : null, amountCents: amount ?? 0, category, originalCategory: rawCategory, sourceKind, rawDescription: title, confidence, excludedReason: category === 'income' ? 'income' : category === 'internal_transfer' ? 'internal_transfer' : null, batchId: null });
  });
  return { templateId, format, rows, issues };
}

export async function parseStatementBuffer(input: { buffer: Buffer; fileName: string; mimeType: string; templateId: string }): Promise<ParsedStatement> {
  const { buffer, mimeType, fileName, templateId } = input;
  if (buffer.length > 5 * 1024 * 1024) throw new Error('DATA_FILE_TOO_LARGE');
  if (!buffer.length) throw new Error('DATA_FILE_EMPTY');
  if (!STATEMENT_TEMPLATES.includes(templateId as typeof STATEMENT_TEMPLATES[number])) throw new Error('DATA_TEMPLATE_UNSUPPORTED');
  const extension = fileName.toLowerCase().split('.').at(-1);
  if (extension === 'csv' && ['text/csv', 'application/csv', 'application/vnd.ms-excel'].includes(mimeType)) {
    const text = buffer.toString('utf8'); if (text.includes('\u0000') || text.includes('\uFFFD')) throw new Error('DATA_FILE_TYPE_MISMATCH');
    return normalize(parseCsvRecords(text), templateId, 'csv');
  }
  if (extension === 'xlsx' && mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' && buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4]))) {
    let expanded = 0, entries = 0;
    for (let i=0;i+46<buffer.length;i++) if (buffer.readUInt32LE(i)===0x02014b50) {
      expanded+=buffer.readUInt32LE(i+24); entries++;
      if(expanded>30*1024*1024||entries>200)throw new Error('DATA_ARCHIVE_LIMIT');
      if(buffer.readUInt16LE(i+8)&1)throw new Error('DATA_ARCHIVE_ENCRYPTED');
      i+=45+buffer.readUInt16LE(i+28)+buffer.readUInt16LE(i+30)+buffer.readUInt16LE(i+32);
    }
    const ExcelJS = await import('exceljs'); const workbook = new ExcelJS.default.Workbook();
    await workbook.xlsx.load(buffer as never);
    const sheet = workbook.worksheets[0]; if (!sheet || sheet.rowCount > 10001) throw new Error('DATA_RECORD_LIMIT');
    const records: string[][] = [];
    sheet.eachRow(row => records.push(Array.from({ length: sheet.columnCount }, (_, i) => { const value = row.getCell(i + 1).value; return value instanceof Date ? value.toISOString().slice(0, 10) : typeof value === 'object' && value !== null ? '' : String(value ?? ''); })));
    return normalize(records, templateId, 'xlsx');
  }
  if (extension === 'pdf' && mimeType === 'application/pdf' && buffer.subarray(0, 5).toString() === '%PDF-') {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    try {
      const pdfRoot=path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
      const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: false, standardFontDataUrl: path.join(pdfRoot,'standard_fonts/') });
      const document = await loadingTask.promise;
      if (document.numPages > 30) { await loadingTask.destroy(); throw new Error('DATA_PAGE_LIMIT'); }
      const lines: string[] = [];
      try { for (let page = 1; page <= document.numPages; page++) { const content = await (await document.getPage(page)).getTextContent(); let line = ''; for (const item of content.items) { if ('str' in item) { line += item.str; if (item.hasEOL) { lines.push(line); line = ''; } } } if (line) lines.push(line); } } finally { await loadingTask.destroy(); }
      return normalize(parseCsvRecords(lines.join('\n')), templateId, 'pdf');
    } catch (error) { if (error instanceof Error && error.name === 'PasswordException') throw new Error('DATA_PDF_ENCRYPTED'); throw error; }
  }
  const isPng = buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])); const isJpeg = buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  if ((extension === 'png' && mimeType === 'image/png' && isPng) || (['jpg', 'jpeg'].includes(extension!) && mimeType === 'image/jpeg' && isJpeg)) {
    if(isPng&&(buffer.length<24||buffer.readUInt32BE(16)*buffer.readUInt32BE(20)>20000000))throw new Error('DATA_IMAGE_LIMIT');
    const { createWorker,PSM } = await import('tesseract.js');
    const data=createRequire(import.meta.url)('@tesseract.js-data/eng') as {langPath:string;gzip:boolean};
    const worker=await createWorker('eng',1,{langPath:data.langPath,gzip:data.gzip,cacheMethod:'none',logger:()=>{}});
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{
      await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_BLOCK,preserve_interword_spaces:'1'});
      const result=await Promise.race([worker.recognize(buffer),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('DATA_OCR_TIMEOUT')),30000);})]);
      return normalize(parseCsvRecords(result.data.text),templateId,'image',result.data.confidence/100);
    }finally{if(timer)clearTimeout(timer);await worker.terminate();}
  }
  throw new Error('DATA_FILE_TYPE_MISMATCH');
}
