import { createHash, randomUUID } from 'node:crypto';
import {
  FinancialTwinSchema,
  type Approval,
  type Audit,
  type DemoState,
  type FinancialTwin,
} from '../shared/contracts.ts';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function stableHash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

export function financialTwin(state: DemoState): FinancialTwin {
  return FinancialTwinSchema.parse({
    snapshotId: `twin-${state.twinVersion}-${state.clock}`,
    version: state.twinVersion,
    asOf: state.clock,
    accounts: state.accounts,
    transactions: state.transactions,
    bills: state.bills,
    subscriptions: state.subscriptions,
    goals: [state.goal],
    mandates: state.mandate ? [state.mandate] : [],
    safetyBufferCents: state.finance.emergencyCents,
  });
}

export function createApprovalSnapshot(
  state: DemoState,
  action: string,
  parameters: Record<string, unknown>,
  expiresAt: string,
): { state: DemoState; approval: Approval } {
  const approval: Approval = {
    id: randomUUID(), action, parameters, twinVersion: state.twinVersion, expiresAt,
    snapshotHash: stableHash({ action, parameters, twinVersion: state.twinVersion, expiresAt }),
    status: 'pending', token: null,
  };
  return { state: { ...state, approvals: [...state.approvals, approval] }, approval };
}

export function confirmApproval(
  state: DemoState,
  approvalId: string,
  snapshotHash: string,
): { state: DemoState; token: string } {
  const index = state.approvals.findIndex(item => item.id === approvalId);
  if (index < 0) throw new Error('APPROVAL_NOT_FOUND');
  const approval = state.approvals[index];
  if (approval.status !== 'pending' || approval.snapshotHash !== snapshotHash) throw new Error('APPROVAL_SNAPSHOT_CHANGED');
  if (approval.expiresAt <= `${state.clock}T00:00:00.000Z`) throw new Error('APPROVAL_EXPIRED');
  const token = randomUUID();
  const approvals = [...state.approvals];
  approvals[index] = { ...approval, status: 'confirmed', token };
  return { state: { ...state, approvals }, token };
}

export function consumeApproval(
  state: DemoState,
  token: string,
  action: string,
  parameters: Record<string, unknown>,
): DemoState {
  const index = state.approvals.findIndex(item => item.token === token);
  if (index < 0 || state.approvals[index].status !== 'confirmed') throw new Error('APPROVAL_TOKEN_INVALID');
  const approval = state.approvals[index];
  if (approval.twinVersion !== state.twinVersion) throw new Error('TWIN_VERSION_CHANGED');
  if (approval.expiresAt <= `${state.clock}T00:00:00.000Z`) throw new Error('APPROVAL_EXPIRED');
  if (approval.action !== action || stableHash(approval.parameters) !== stableHash(parameters))
    throw new Error('APPROVAL_PARAMETERS_CHANGED');
  const approvals = [...state.approvals];
  approvals[index] = { ...approval, status: 'consumed' };
  return { ...state, approvals };
}

function auditHash(event: Omit<Audit, 'eventHash'>): string {
  return stableHash(event);
}

export function appendAuditEvent(
  state: DemoState,
  action: string,
  outcome: string,
  detail: string,
  links: Pick<Audit, 'operationId' | 'requestId' | 'approvalId'> = {},
): DemoState {
  const previousHash = state.audit.at(-1)?.eventHash ?? 'GENESIS';
  const base: Omit<Audit, 'eventHash'> = {
    id: randomUUID(), at: `${state.clock}T12:00:00.000Z`, action, outcome, detail,
    sequence: state.audit.length + 1, previousHash, twinVersion: state.twinVersion,
    ...Object.fromEntries(Object.entries(links).filter(([, value]) => value !== undefined)),
  };
  return { ...state, audit: [...state.audit, { ...base, eventHash: auditHash(base) }] };
}

export function verifyAuditChain(events: Audit[]): boolean {
  let previousHash = 'GENESIS';
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!event.eventHash || event.previousHash !== previousHash || event.sequence !== index + 1) return false;
    const { eventHash, ...base } = event;
    if (auditHash(base) !== eventHash) return false;
    previousHash = eventHash;
  }
  return true;
}
