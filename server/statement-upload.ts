import multer from 'multer';
import type { RequestHandler } from 'express';
import { MAX_STATEMENT_BYTES, parseStatementBuffer } from './statement-parser.ts';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_STATEMENT_BYTES,
  files: 1, fields: 1, fieldSize: 100, parts: 2 } }).single('file');

export const statementUpload: RequestHandler = (req, res, next) => {
  if (process.env.NOVA_ALLOW_STATEMENT_UPLOAD !== 'true') {
    res.status(403).json({ error: 'DATA_UPLOAD_DISABLED' }); return;
  }
  upload(req, res, error => {
    if (error) {
      const tooLarge = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE';
      res.status(tooLarge ? 413 : 400).json({ error: tooLarge ? 'STATEMENT_TOO_LARGE' : 'STATEMENT_UPLOAD_INVALID' });
      return;
    }
    next();
  });
};

/** Synthetic history is available even when real-file uploads are disabled. */
export function parseSampleStatement() {
  const rows = Array.from({ length: 18 }, (_, i) => {
    const month = 8 + Math.floor(i / 6); const day = [1, 5, 9, 13, 17, 21][i % 6];
    const title = ['Rent', 'CloudBox Plus', 'Cafe', 'Transport', 'Cafe', 'Transport'][i % 6];
    const amount = ['-2800.00', '-68.00', '-32.00', '-40.00', '-48.00', '-60.00'][i % 6];
    return `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')},${title},${amount}`;
  });
  return parseStatementBuffer({ buffer: Buffer.from(`date,description,amount\n${rows.join('\n')}`),
    fileName: 'synthetic-statement.csv', mimeType: 'text/csv', templateId: 'bank-csv-v1' });
}
