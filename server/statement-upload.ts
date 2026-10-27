import type { Express, Request, Response, RequestHandler } from 'express';
import multer from 'multer';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { getState, mutateState } from './store.ts';
import { parseStatementBuffer, STATEMENT_TEMPLATES } from './statement-parser.ts';
import { previewStatementImport, resolveImportIssue, commitStatementImport, revokeStatementImport } from './statement-import.ts';
import { snapshot } from './presentation.ts';
import { prepareAccountSnapshot } from './account-snapshots.ts';
import { createAgentThread } from './store.ts';

export function registerStatementRoutes(app: Express, sessionId: (req: Request, res: Response) => string, route: (handler: (req: Request, res: Response) => unknown) => RequestHandler) {
  const receive = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 2 } }).single('file');
  app.get('/api/statement-import/templates', route((_req, res) => res.json({ templates: STATEMENT_TEMPLATES, formats: ['csv','xlsx','pdf','image'], uploadEnabled: process.env.NOVA_ALLOW_STATEMENT_UPLOAD === 'true', sampleIds: ['all','bank','wechat','alipay'] })));
  const preview = async (req: Request, res: Response, buffer: Buffer, fileName: string, mimeType: string, templateId: string) => {
    const parsed = await parseStatementBuffer({ buffer, fileName, mimeType, templateId }); let outcome: ReturnType<typeof previewStatementImport> | undefined;
    const state = mutateState(sessionId(req,res), old => { outcome = previewStatementImport(old, parsed); return outcome.state; });
    const rows = state.normalizedStatementRows.filter(r => r.batchId === outcome!.batch.id).map(({ rawDescription: _raw, ...r }) => r);
    return res.json({ snapshot: snapshot(state), batch: outcome!.batch, issues: outcome!.issues, rows });
  };
  app.post('/api/statement-imports/sample', route(async (req,res) => {
    const input = z.object({ sampleId: z.enum(['all','bank','wechat','alipay']).default('all'), templateId: z.enum(STATEMENT_TEMPLATES).default('nova-synthetic-v1') }).parse(req.body);
    const name = input.sampleId === 'all' ? 'nova-synthetic-statements.csv' : `nova-${input.sampleId}.csv`;
    const buffer = await readFile(path.resolve('public/samples',name));
    return preview(req,res,buffer,name,'text/csv',input.templateId);
  }));
  app.post('/api/statement-imports/upload', (req,res,next) => {
    if (process.env.NOVA_ALLOW_STATEMENT_UPLOAD !== 'true') { res.status(400).json({ error: 'DATA_UPLOAD_DISABLED', code: 'DATA_UPLOAD_DISABLED' }); return; }
    receive(req,res,error => { if (error) res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'DATA_FILE_TOO_LARGE' : 'DATA_UPLOAD_INVALID' }); else next(); });
  }, route(async (req,res) => {
    if (!req.file) throw new Error('DATA_FILE_REQUIRED');
    const templateId = z.enum(STATEMENT_TEMPLATES).parse(req.body.templateId);
    return preview(req,res,req.file.buffer,req.file.originalname,req.file.mimetype,templateId);
  }));
  app.get('/api/statement-imports/:batchId', route((req,res) => {
    const state = getState(sessionId(req,res)); const batch = state.statementImportBatches.find(b => b.id === req.params.batchId);
    if (!batch) throw new Error('IMPORT_BATCH_NOT_FOUND');
    res.json({ batch, issues: state.importIssues.filter(i => i.batchId === batch.id), rows: state.normalizedStatementRows.filter(r => r.batchId === batch.id).map(({ rawDescription: _raw, ...r }) => r) });
  }));
  app.patch('/api/statement-imports/:batchId/issues/:issueId', route((req,res) => {
    const input = z.object({ value: z.string().max(240) }).parse(req.body);
    const state = mutateState(sessionId(req,res), old => resolveImportIssue(old, req.params.batchId, req.params.issueId, input));
    res.json({ snapshot: snapshot(state), batch: state.statementImportBatches.find(b => b.id === req.params.batchId), issues: state.importIssues.filter(i => i.batchId === req.params.batchId) });
  }));
  for (const operation of ['commit','revoke'] as const) app.post(`/api/statement-imports/:batchId/${operation}`, route((req,res) => {
    const input = z.object({ expectedBatchRevision:z.number().int().nonnegative().default(0), expectedTwinVersion: z.number().int().positive(), confirmed: z.literal(true) }).parse(req.body);
    const state = mutateState(sessionId(req,res), old => operation === 'commit' ? commitStatementImport(old, req.params.batchId, input.expectedTwinVersion,input.expectedBatchRevision) : revokeStatementImport(old, req.params.batchId, input.expectedTwinVersion));
    res.json(snapshot(state));
  }));
  app.post('/api/account-snapshots/prepare', route((req,res) => {
    const input = z.object({ accountId: z.string(), balanceCents: z.number().int().nonnegative(), currency: z.literal('CNY'), asOf: z.iso.date(), threadId: z.string().optional() }).parse(req.body);
    const id = sessionId(req,res); const state = getState(id);
    const threadId = input.threadId ?? createAgentThread(id, { title: '确认账户余额', kind: 'task' }).id;
    res.json({ ...prepareAccountSnapshot(id,threadId,{ accountId: input.accountId, balanceCents: input.balanceCents, currency: input.currency, asOf: input.asOf },state), threadId });
  }));
}
