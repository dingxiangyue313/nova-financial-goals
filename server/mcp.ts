import type express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { getState, mutateState } from './store.ts';
import { verifyOperation } from './tools.ts';
import { snapshot } from './presentation.ts';
import { runBankingTool } from './banking.ts';

export function registerMcp(app: express.Express, authenticate: (token: string) => string | null) {
  app.post('/mcp', async (req, res) => {
    const header = req.get('authorization') || '';
    const sessionId = header.startsWith('Bearer ') ? authenticate(header.slice(7)) : null;
    if (!sessionId) return res.status(401).json({ error: 'MCP_AUTH_REQUIRED' });
    const server = new McpServer({ name: 'nova-simulated-banking', version: '0.1.0' });
    server.registerTool('read_goal', { description: 'Read the current simulated goal and assessment.' }, async () => ({
      content: [{ type: 'text', text: JSON.stringify(snapshot(getState(sessionId))) }],
    }));
    server.registerTool('forecast_cashflow', {
      description: 'Read the deterministic simulated cash-flow forecast.',
      inputSchema: { horizonDays: z.number().int().min(1).max(365).default(30) },
    }, async ({ horizonDays }) => ({ content: [{ type: 'text', text: JSON.stringify(
      runBankingTool(getState(sessionId), 'forecast_cashflow', { horizonDays }).result) }] }));
    server.registerTool('request_simulated_payment', {
      description: 'Request a simulated payment. The same Permission → Risk → Execute → Verify → Audit rules as the NOVA UI apply. Idempotency key is required.',
      inputSchema: { category: z.enum(['transport','shopping']), amountCents: z.number().int().positive(),
        idempotencyKey: z.string().min(1).max(100), agentId: z.string().min(1) },
    }, async ({ category, amountCents, idempotencyKey, agentId }) => {
      try {
        let operationId = '';
        mutateState(sessionId, old => {
          const outcome = runBankingTool(old, 'evaluate_external_request', { category, amountCents, idempotencyKey, agentId });
          operationId = outcome.result.operationId;
          return outcome.state;
        });
        return { content: [{ type: 'text', text: JSON.stringify(verifyOperation(getState(sessionId), operationId)) }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : 'REQUEST_FAILED' }] };
      }
    });
    server.registerTool('verify_simulated_operation', {
      description: 'Verify a previous simulated request without repeating it.',
      inputSchema: { operationId: z.string().min(1) },
    }, async ({ operationId }) => {
      try { return { content: [{ type: 'text', text: JSON.stringify(verifyOperation(getState(sessionId), operationId)) }] }; }
      catch (error) { return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : 'NOT_FOUND' }] }; }
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).json({ error: 'MCP_REQUEST_FAILED' });
    } finally {
      res.on('close', () => { void transport.close(); void server.close(); });
    }
  });
  app.get('/mcp', (_req, res) => res.status(405).json({ error: 'METHOD_NOT_ALLOWED' }));
  app.delete('/mcp', (_req, res) => res.status(405).json({ error: 'METHOD_NOT_ALLOWED' }));
}
