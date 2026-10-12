import { SnapshotSchema, type Assessment, type DemoState, type Snapshot, type UiCard } from '../shared/contracts.ts';
import { assessGoal } from './domain.ts';
import { verifyAuditChain } from './governance.ts';

function yuan(cents: number) { return `¥${(cents / 100).toLocaleString('zh-CN')}`; }
export function generatedCards(state: DemoState, assessment: Assessment): UiCard[] {
  const goal = state.goal;
  const cards: UiCard[] = [{
    id: 'goal-progress', type: 'goal_progress_card', title: `${goal.title} · 目标进度`,
    body: `已存 ${yuan(goal.savedCents)} / ${yuan(goal.targetCents)}。${goal.status === 'draft' ? '选择方案后可确认计划。' : '计划正在推进。'}`,
    tone: 'neutral', action: { id: 'open-feasibility', label: '查看计划' },
  }, {
    id: 'goal-feasibility', type: 'goal_feasibility_card', title: '目标可行性',
    body: assessment.status === 'insufficient_data' ? assessment.dataSufficiency : assessment.status === 'infeasible' ? '当前可用金额不足，请调整目标或日期。' : assessment.status === 'at_risk' ? `按当前假设可能延期约 ${assessment.delayDays} 天。` : '按当前数据和假设，预计可以按时完成。',
    tone: assessment.status === 'on_track' ? 'good' : 'warning', action: { id: 'open-feasibility', label: '比较方案' },
  }, {
    id: 'scenario-compare', type: 'scenario_compare', title: '三种目标节奏',
    body: assessment.plans.map(item => `${item.label} ${yuan(item.monthlyCents)}/月`).join(' · '),
    tone: 'neutral', action: { id: 'open-feasibility', label: '选择方案' },
  }, {
    id: 'risk-disclosure', type: 'risk_disclosure', title: '模拟与假设说明',
    body: '预计日期基于模拟收入和支出；所有资金动作仅修改本地演示数据，不会产生真实扣款。',
    tone: 'neutral', action: null,
  }];
  if (state.pendingImpact && !state.pendingImpact.dismissed) cards.push({
    id: 'goal-impact', type: 'goal_impact_signal', title: `${state.pendingImpact.title}影响目标`,
    body: `本月新增 ${yuan(state.pendingImpact.expenseCents)}，预计目标投入减少 ${yuan(state.pendingImpact.shortfallCents)}；应急金未动用。`,
    tone: 'warning', action: { id: 'open-impact', label: '查看调整方案' },
  });
  if (state.operations.length) {
    const last = state.operations.at(-1)!;
    cards.push({ id: `receipt-${last.operationId}`, type: last.status === 'executed' ? 'execution_receipt' : 'error_recovery',
      title: last.status === 'executed' ? '模拟操作凭证' : '操作状态', body: last.reason,
      tone: last.status === 'executed' ? 'good' : 'warning', action: { id: 'open-activity', label: '查看记录' } });
  }
  const approval = state.approvals.at(-1);
  if (approval && approval.status !== 'consumed') cards.push({ id: `approval-${approval.id}`, type: 'approval_sheet',
    title: approval.status === 'pending' ? '等待明确确认' : '一次性批准已签发',
    body: `${approval.action} · 绑定 Twin v${approval.twinVersion} · 到期 ${approval.expiresAt}`,
    tone: 'warning', action: null });
  return cards;
}

export function snapshot(state: DemoState): Snapshot {
  const assessment = assessGoal(state);
  return SnapshotSchema.parse({ goal: state.goal, finance: state.finance, assessment,
    pendingImpact: state.pendingImpact, mandate: state.mandate, audit: state.audit,
    operations: state.operations, receipts: state.receipts,
    approvalSummaries: state.approvals.map(({ token: _token, ...approval }) => approval),
    auditChainValid: verifyAuditChain(state.audit),
    twinVersion: state.twinVersion, cards: generatedCards(state, assessment), clock: state.clock });
}
