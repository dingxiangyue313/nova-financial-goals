import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DemoState } from '../shared/contracts.ts';
import { createAgentAction } from './store.ts';
import { appendAuditEvent, confirmApproval, consumeApproval, createApprovalSnapshot } from './governance.ts';

const Input = z.object({ accountId: z.string(), balanceCents: z.number().int().nonnegative(), currency: z.literal('CNY'), asOf: z.iso.date() }).strict();
function validate(state: DemoState, value: unknown) {
  const input = Input.parse(value); const account = state.accounts.find(a => a.id === input.accountId);
  if (!account || account.currency !== input.currency) throw new Error('ACCOUNT_CURRENCY_MISMATCH');
  if (account.type !== 'checking') throw new Error('ACCOUNT_SNAPSHOT_CHECKING_ONLY');
  if (input.asOf > state.clock) throw new Error('DATA_SNAPSHOT_FUTURE');
  return input;
}
export function prepareAccountSnapshot(sessionId: string, threadId: string, value: z.infer<typeof Input>, state: DemoState) {
  const input = validate(state, value);
  const action = createAgentAction(sessionId, threadId, 'confirm_account_snapshot', state.twinVersion, input);
  return { actionId: action.id, input };
}
export function applyAccountSnapshot(state: DemoState, value: unknown): DemoState {
  const input = validate(state, value);
  const prepared = createApprovalSnapshot(state, 'confirm_account_snapshot', input, `${state.clock}T12:05:00.000Z`);
  const approved = confirmApproval(prepared.state, prepared.approval.id, prepared.approval.snapshotHash);
  const permitted = consumeApproval(approved.state, approved.token, 'confirm_account_snapshot', input);
  const snapshot = { id: randomUUID(), ...input, confirmed: true, source: 'user_confirmed' as const, twinVersion: state.twinVersion + 1 };
  return appendAuditEvent({ ...permitted, twinVersion: state.twinVersion + 1,
    accounts: state.accounts.map(a => a.id === input.accountId ? { ...a, balanceCents: input.balanceCents } : a),
    finance: { ...state.finance, checkingCents: input.balanceCents, updatedAt: input.asOf }, accountSnapshots: [...state.accountSnapshots, snapshot],
  }, 'account_snapshot', 'confirmed', '已明确确认工资卡余额快照；历史账单和目标存款未改变', { approvalId: prepared.approval.id });
}
