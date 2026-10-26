import { randomUUID } from 'node:crypto';
import type { DemoState } from '../shared/contracts.ts';
import { datedCashflow, MissionRowSchema, type Mission, type MissionRow } from '../shared/mission.ts';
import { createFixture } from './fixtures.ts';
import { appendAuditEvent, stableHash } from './governance.ts';

export function sampleRows(): MissionRow[] {
  const rows: MissionRow[] = [];
  const add = (id: string, date: string, merchant: string, cents: number, category: MissionRow['category'], source: MissionRow['source'], excluded = false) => rows.push({ id, date, merchant, cents, category, source, excluded });
  for (let month = 5; month <= 10; month++) {
    const m = String(month).padStart(2, '0');
    add(`salary-${m}`, `2026-${m}-25`, '星河设计 · 工资', 850000, '工资', '银行卡', true);
    add(`rent-${m}`, `2026-${m}-01`, '梧桐公寓', -280000, '住房', '银行卡');
    add(`cloud-${m}`, `2026-${m}-05`, 'CloudBox Plus', month === 10 ? -6800 : -5800, '订阅', '银行卡');
    add(`water-${m}`, `2026-${m}-10`, '城市水电', -42000, '水电', '支付宝');
    add(`insurance-${m}`, `2026-${m}-18`, '安心保障', -28000, '保险', '银行卡');
    add(`metro-${m}`, `2026-${m}-15`, '城市交通月票', -20000, '交通', '微信');
    add(`market-${m}`, `2026-${m}-08`, '邻里超市', -30000, '购物', '支付宝');
    // Deterministic daily evidence: May–July ¥400/month; October ¥710.
    const total = month <= 7 ? 40000 : month === 8 ? 55000 : month === 9 ? 63000 : 71000;
    for (let day = 1; day <= 20; day++) add(`food-${m}-${day}`, `2026-${m}-${String(day).padStart(2, '0')}`, ['美团外卖', '巷口食堂', '周末咖啡', '日式便当'][day % 4], -(Math.floor(total / 20) + (day === 20 ? total % 20 : 0)), '餐饮', day % 2 ? '微信' : '支付宝');
    add(`transfer-out-${m}`, `2026-${m}-06`, '银行卡转入微信零钱', -50000, '内部转账', '银行卡', true);
    add(`transfer-in-${m}`, `2026-${m}-06`, '银行卡转入微信零钱', 50000, '内部转账', '微信', true);
    add(`purchase-${m}`, `2026-${m}-06`, '邮筒美团 · 已退款订单', -9000, '购物', '微信', true);
    add(`refund-${m}`, `2026-${m}-07`, '邮筒美团 · 原路退款', 9000, '退款', '微信', true);
  }
  return rows;
}

export function createMissionFixture(): DemoState {
  const base = createFixture();
  const goal = { ...base.goal, savedCents: 200000, targetDate: '2027-06-30', originalDate: '2027-06-30', monthlyContributionCents: 100000, status: 'active' as const, selectedPlanId: 'balanced', quote: '明年六月去日本，准备八千元，不动应急金。' };
  const rows = sampleRows();
  return { ...base, clock: '2026-10-26', goal, goals: [goal], primaryGoalId: goal.id,
    finance: { ...base.finance, checkingCents: 724000, monthlyIncomeCents: 850000, fixedBillsCents: 376800, essentialSpendingCents: 101000, updatedAt: '2026-10-26', historyMonths: 6 },
    accounts: base.accounts.map(a => ({ ...a, balanceCents: a.id === 'checking' ? 724000 : a.id === 'goal-wallet' ? 200000 : a.balanceCents })),
    transactions: rows.map(r => ({ id: r.id, date: r.date, title: r.merchant, amountCents: r.cents, accountId: 'checking', category: r.excluded ? r.category === '工资' ? 'income' : 'internal_transfer' : r.category, sourceKind: r.source === '银行卡' ? 'bank' : r.source === '微信' ? 'wechat_pay' : 'alipay', provenance: 'connected_data' })),
    subscriptions: [{ id: 'cloudbox', title: 'CloudBox Plus', monthlyCents: 6800, nextChargeDate: '2026-11-05', status: 'active' }],
    dataConnections: (['bank', 'wechat_pay', 'alipay'] as const).map((source, i) => ({ id: `mission-${source}`, source, label: ['银行卡', '微信支付', '支付宝'][i], status: 'connected', simulated: true, permissionScopes: ['balances', 'transactions_90_days'], connectedAt: '2026-10-26T12:00:00+08:00', revokedAt: null, lastSyncedAt: '2026-10-26T12:00:00+08:00', lastAttemptAt: null, coverageStart: '2026-05-01', coverageEnd: '2026-10-26', errorCode: null, errorMessage: null, consecutiveFailures: 0 })),
    mission: { version: 1, rows, batches: [{ id: 'sample-initial', name: '三来源合成账单 · 5–10月', count: rows.length, duplicates: 0, at: '2026-10-26', rowIds: rows.map(r => r.id) }], subscription: { status: 'active', preference: 'none', cancelledAt: null, effectiveAt: null, paidThrough: '2026-11-04', nextChargeSuppressed: false, merchantOperationId: null }, schedule: null, pending: null, receipts: [] },
  };
}

function mission(state: DemoState): Mission { if (!state.mission) throw new Error('DATA_MISSION_NOT_LOADED'); return state.mission; }
const changed = (state: DemoState, action: string, detail: string, outcome = 'verified'): DemoState => appendAuditEvent({ ...state, twinVersion: state.twinVersion + 1 }, action, outcome, detail);

export function importSample(state: DemoState, rows: unknown, name: string): DemoState {
  const data = MissionRowSchema.array().max(2000).parse(rows);
  const m = mission(state); const ids = new Set(m.rows.map(r => r.id)); const fresh: MissionRow[] = [];
  for (const row of data) { if (!ids.has(row.id)) { ids.add(row.id); fresh.push(row); } }
  if (!fresh.length) return state;
  return changed({ ...state, mission: { ...m, pending: null, rows: [...m.rows, ...fresh], batches: [...m.batches, { id: randomUUID(), name, count: fresh.length, duplicates: data.length - fresh.length, at: state.clock, rowIds: fresh.map(r => r.id) }] } }, 'statement_import', `导入 ${fresh.length} 条历史证据，余额快照未改变`);
}

export function forecastMission(state: DemoState, contribution = 0) {
  return datedCashflow({ clock: state.clock, finance: state.finance, mission: mission(state) }, contribution);
}

export function prepareMission(state: DemoState, kind: NonNullable<Mission['pending']>['kind'], amountCents = 100000, frequency: 'once' | 'monthly' = 'monthly'): DemoState {
  const m = mission(state);
  if (['pause_schedule', 'resume_schedule', 'cancel_schedule'].includes(kind)) {
    if (!m.schedule || !['active', 'paused'].includes(m.schedule.status)) throw new Error('PLAN_NOT_ACTIVE');
    if (kind === 'resume_schedule' && m.schedule.status !== 'paused') throw new Error('PLAN_NOT_PAUSED');
    if (kind === 'pause_schedule' && m.schedule.status !== 'active') throw new Error('PLAN_NOT_ACTIVE');
    amountCents = m.schedule.amountCents;
    frequency = m.schedule.frequency;
  }
  if (kind === 'cancel_subscription' && m.subscription.status === 'unknown') throw new Error('OPERATION_RECONCILE_FIRST');
  if (kind === 'create_schedule') {
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > state.goal.targetCents - state.goal.savedCents) throw new Error('INVALID_AMOUNT');
    if (!state.dataConnections.some(c => c.source === 'bank' && c.status === 'connected') || state.finance.updatedAt !== state.clock) throw new Error('DATA_BALANCE_STALE');
    if (state.goal.id !== 'goal-japan-2026') throw new Error('GOAL_MISSION_MISMATCH');
    if (frequency === 'monthly' && m.schedule && ['active', 'paused'].includes(m.schedule.status)) throw new Error('PLAN_ALREADY_EXISTS');
    if ((frequency === 'once' ? state.finance.checkingCents - amountCents : forecastMission(state, amountCents).lowCents) < 0) throw new Error('INSUFFICIENT_BALANCE');
  }
  return { ...state, mission: { ...m, pending: { id: randomUUID(), kind, amountCents, frequency, twinVersion: state.twinVersion, expiresAt: Date.now() + 300000, fingerprint: stableHash({ kind, amountCents, frequency, goal: state.goal, checking: state.finance.checkingCents }) } } };
}

function receipt(state: DemoState, requestId: string, kind: string, status: Mission['receipts'][number]['status'], detail: string, amountCents = 0): DemoState {
  const m = mission(state);
  return changed({ ...state, mission: { ...m, pending: null, receipts: [...m.receipts, { id: randomUUID(), requestId, kind, status, date: state.clock, detail, amountCents }] } }, kind, detail, status);
}

function moveMoney(state: DemoState, cents: number): DemoState {
  if (cents > state.finance.checkingCents) throw new Error('INSUFFICIENT_BALANCE');
  const goal = { ...state.goal, savedCents: state.goal.savedCents + cents };
  return { ...state, goal, goals: state.goals.map(g => g.id === goal.id ? goal : g), finance: { ...state.finance, checkingCents: state.finance.checkingCents - cents }, accounts: state.accounts.map(a => a.id === 'checking' ? { ...a, balanceCents: state.finance.checkingCents - cents } : a.id === 'goal-wallet' ? { ...a, balanceCents: goal.savedCents } : a), transactions: [...state.transactions, { id: randomUUID(), date: state.clock, title: '旅行金转入', accountId: 'checking', amountCents: -cents, category: 'goal_transfer' }] };
}

export function confirmMission(state: DemoState, requestId: string, outcome: 'succeeded' | 'failed' | 'unknown' = 'succeeded'): DemoState {
  const m = mission(state);
  if (m.receipts.some(r => r.requestId === requestId)) return state;
  const p = m.pending;
  if (!p || p.id !== requestId) throw new Error('APPROVAL_NOT_FOUND');
  if (p.expiresAt < Date.now()) throw new Error('APPROVAL_EXPIRED');
  if (p.twinVersion !== state.twinVersion || p.fingerprint !== stableHash({ kind: p.kind, amountCents: p.amountCents, frequency: p.frequency, goal: state.goal, checking: state.finance.checkingCents })) throw new Error('TWIN_VERSION_CHANGED');
  if (p.kind === 'cancel_subscription') {
    const subscription: Mission['subscription'] = { ...m.subscription, status: outcome === 'succeeded' ? 'cancelled' : outcome, cancelledAt: outcome === 'succeeded' ? `${state.clock}T12:00:00+08:00` : null, effectiveAt: outcome === 'succeeded' ? '2026-11-05' : null, nextChargeSuppressed: outcome === 'succeeded', merchantOperationId: p.id };
    const next = { ...state, finance: { ...state.finance, fixedBillsCents: state.finance.fixedBillsCents - (outcome === 'succeeded' && !m.subscription.nextChargeSuppressed ? 6800 : 0) }, subscriptions: state.subscriptions.map(s => s.id === 'cloudbox' && outcome === 'succeeded' ? { ...s, status: 'cancelled' as const } : s), mission: { ...m, subscription, demoOutcome: undefined } };
    return receipt(next, requestId, p.kind, outcome, outcome === 'succeeded' ? 'CloudBox Plus 已关闭自动续费；服务可用至11月4日，不退款。11月5日起不再扣款，已验证商户结果。' : outcome === 'unknown' ? '商户结果尚未确定。请查询状态，暂不计入节省，也不重复提交。' : '商户服务暂不可用，尚未取消。可重新准备取消或联系商户。');
  }
  if (p.kind === 'create_schedule') {
    // Recheck risk immediately before committing; preparing a plan never moves funds.
    const checked = prepareMission({ ...state, mission: { ...m, pending: null } }, p.kind, p.amountCents, p.frequency);
    if (p.frequency === 'once') return receipt(moveMoney(checked, p.amountCents), requestId, p.kind, 'succeeded', '一次性旅行金转入已完成并核对双方余额。', p.amountCents);
    const goal = { ...checked.goal, monthlyContributionCents: p.amountCents };
    const next = { ...checked, goal, goals: checked.goals.map(g => g.id === goal.id ? goal : g), mission: { ...mission(checked), schedule: { id: p.id, goalId: state.goal.id, amountCents: p.amountCents, frequency: p.frequency, status: 'active' as const, createdAt: state.clock, endDate: state.goal.targetDate, processedMonths: [] } } };
    return receipt(next, requestId, p.kind, 'succeeded', '每月储蓄计划已创建，尚未转账。工资实际到账后次日09:00执行；27日仍未到账则跳过，不补扣。', p.amountCents);
  }
  if (!m.schedule) throw new Error('PLAN_NOT_FOUND');
  const status = p.kind === 'pause_schedule' ? 'paused' : p.kind === 'resume_schedule' ? 'active' : 'cancelled';
  return receipt({ ...state, mission: { ...m, schedule: { ...m.schedule, status } } }, requestId, p.kind, 'succeeded', `旅行储蓄计划已${status === 'paused' ? '暂停' : status === 'active' ? '恢复' : '取消'}。`);
}

export function reconcileSubscription(state: DemoState): DemoState {
  const m = mission(state); if (m.subscription.status !== 'unknown') return state;
  // Deterministic merchant simulator: timed-out calls were not committed.
  return receipt({ ...state, mission: { ...m, subscription: { ...m.subscription, status: 'active', nextChargeSuppressed: false } } }, randomUUID(), 'reconcile_subscription', 'succeeded', '已查询商户：自动续费仍开启，未发生取消；可以重新准备。');
}

export function tickMission(state: DemoState, date: string): DemoState {
  if (date < state.clock) throw new Error('INVALID_CLOCK_BACKWARDS');
  let next = { ...state, clock: date }; const m = mission(next); const plan = m.schedule;
  if (!plan || plan.status !== 'active') return next;
  if (plan.goalId !== state.goal.id) return receipt({ ...next, mission: { ...m, schedule: { ...plan, status: 'paused' } } }, randomUUID(), 'scheduled_transfer', 'skipped', '关联目标已变化，计划已暂停，请重新核对来源和目标账户。');
  if (date > plan.endDate) return { ...next, mission: { ...m, schedule: { ...plan, status: 'completed' } } };
  const month = date.slice(0, 7); if (plan.processedMonths.includes(month) || date.slice(8) < '26') return next;
  const salary = m.rows.find(r => r.category === '工资' && r.source === '银行卡' && r.merchant === '星河设计 · 工资' && r.cents >= 800000 && r.cents <= 900000 && r.date.slice(0, 7) === month && r.date > plan.createdAt && r.date < date && r.date <= `${month}-27`);
  if (!salary && date.slice(8) <= '27') return next;
  const onTime = salary && new Date(Date.parse(salary.date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10) === date;
  next = { ...next, mission: { ...m, schedule: { ...plan, processedMonths: [...plan.processedMonths, month] } } };
  if (salary && !onTime) return receipt(next, `${plan.id}:${month}`, 'scheduled_transfer', 'skipped', '工资触发的执行时间已错过，本期跳过，不自动补扣。');
  if (!salary) return receipt(next, `${plan.id}:${month}`, 'scheduled_transfer', 'skipped', '未检测到匹配的工资到账，本期跳过且不补扣。请核对收入并重新规划。');
  if (next.finance.updatedAt !== date) return receipt(next, `${plan.id}:${month}`, 'scheduled_transfer', 'skipped', '余额快照已过期，本期未转账。请更新模拟账户后检查计划。');
  const cents = Math.min(plan.amountCents, next.goal.targetCents - next.goal.savedCents);
  if (next.finance.checkingCents < cents || cents <= 0) return receipt(next, `${plan.id}:${month}`, 'scheduled_transfer', 'skipped', '可用余额不足或目标已达成，本期未转账。');
  next = moveMoney(next, cents);
  if (next.goal.savedCents >= next.goal.targetCents) next = { ...next, mission: { ...mission(next), schedule: { ...mission(next).schedule!, status: 'completed' } } };
  return receipt(next, `${plan.id}:${month}`, 'scheduled_transfer', 'succeeded', '已验证工资到账，旅行金转入成功，双方账户余额已核对。', cents);
}
