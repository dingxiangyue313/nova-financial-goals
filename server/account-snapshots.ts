import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AccountSnapshotSchema, IsoDateSchema, type DemoState } from '../shared/contracts.ts';
import { createAgentAction, getAgentThread, type StoredAgentAction } from './store.ts';
import { governStatementChange } from './statement-import.ts';

export const AccountSnapshotInputSchema = z.object({ accountId: z.string().min(1),
  balanceCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), currency: z.literal('CNY'), asOf: IsoDateSchema }).strict();

function validateTarget(state: DemoState, input: z.infer<typeof AccountSnapshotInputSchema>) {
  const account = state.accounts.find(item => item.id === input.accountId);
  if (!account) throw new Error('ACCOUNT_NOT_FOUND');
  if (account.type === 'goal') throw new Error('ACCOUNT_SNAPSHOT_GOAL_WALLET');
  if (account.currency !== input.currency) throw new Error('CURRENCY_MISMATCH');
  if (input.asOf > state.clock || state.accountSnapshots.some(snapshot => snapshot.accountId === input.accountId && snapshot.asOf > input.asOf))
    throw new Error('ACCOUNT_SNAPSHOT_STALE_DATE');
  return account;
}

export function prepareAccountSnapshot(sessionId: string, threadId: string, input: z.infer<typeof AccountSnapshotInputSchema>,
  state: DemoState): { actionId: string } {
  getAgentThread(sessionId, threadId);
  const parsed = AccountSnapshotInputSchema.parse(input); validateTarget(state, parsed);
  const action = createAgentAction(sessionId, threadId, 'confirm_account_snapshot', state.twinVersion, parsed);
  return { actionId: action.id };
}

/** Called only after executeWorkspaceAction validates ownership, expiry, version, and user confirmation. */
export function applyConfirmedAccountSnapshot(state: DemoState, action: StoredAgentAction): DemoState {
  if (action.actionType !== 'confirm_account_snapshot' || action.status !== 'pending') throw new Error('AGENT_ACTION_NOT_PENDING');
  if (action.twinVersion !== state.twinVersion) throw new Error('TWIN_VERSION_CHANGED');
  const input = AccountSnapshotInputSchema.parse(action.payload); const account = validateTarget(state, input);
  return governStatementChange(state, 'confirm_account_snapshot', { actionId: action.id, ...input }, approved => {
    const snapshot = AccountSnapshotSchema.parse({ id: randomUUID(), ...input, sourceKind: 'user_confirmed',
      sourceId: action.id, twinVersion: state.twinVersion + 1, createdAt: `${state.clock}T12:00:00.000Z` });
    const next = { ...approved, twinVersion: state.twinVersion + 1,
      accounts: state.accounts.map(item => item.id === input.accountId ? { ...item, balanceCents: input.balanceCents } : item),
      finance: { ...state.finance, ...(account.type === 'checking' ? { checkingCents: input.balanceCents }
        : account.type === 'emergency' ? { emergencyCents: input.balanceCents } : {}), updatedAt: input.asOf },
      accountSnapshots: [...state.accountSnapshots, snapshot], evidenceRefs: [...state.evidenceRefs, {
        id: `evidence-${snapshot.id}`, claimType: 'fact' as const, sourceKind: 'account_snapshot' as const,
        sourceId: snapshot.id, dataAsOf: input.asOf, label: '用户确认的模拟账户余额', confidence: 1 }] };
    if (next.goal !== state.goal || next.accounts.some(item => item.id === 'goal-wallet' && item.balanceCents !== state.goal.savedCents))
      throw new Error('ACCOUNT_SNAPSHOT_VERIFY_MISMATCH');
    return next;
  });
}
