import { readMoneyMission, projectLegacyMission } from './money-mission.ts';
import { missionCompletionDate } from '../shared/mission.ts';
import { forecastMission } from './mission.ts';
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
  const primaryGoal = state.goals.find(goal => goal.id === state.primaryGoalId) ?? null;
  const displayState = primaryGoal ? { ...state, goal: primaryGoal } : state;
  let assessment = assessGoal(displayState);
  if (state.mission && primaryGoal?.id === state.goal.id) {
    const amount = state.mission.schedule?.status === 'active' ? state.mission.schedule.amountCents : state.goal.monthlyContributionCents;
    const projectedDate = missionCompletionDate(state.clock, Math.max(0, state.goal.targetCents - state.goal.savedCents), amount);
    const forecast = forecastMission(state, amount);
    const onTrack = !!projectedDate && projectedDate <= state.goal.targetDate && forecast.lowCents >= 0;
    assessment = { ...assessment, projectedDate, status: onTrack ? 'on_track' : 'at_risk', safeToSpendCents: forecast.lowCents,
      updatedAt: state.finance.updatedAt, assumptions: [forecast.assumption, '每期转入须检测到工资实际到账。'],
      plans: [{ id: 'steady', label: '稳健', amount: 75000, initial: 0 }, { id: 'balanced', label: '平衡', amount: 100000, initial: 0 }, { id: 'accelerated', label: '加速', amount: 120000, initial: 120000 }].map(p => {
        const date = missionCompletionDate(state.clock, state.goal.targetCents - state.goal.savedCents, p.amount, p.initial);
        return { id: p.id, label: p.label, monthlyCents: p.amount, projectedDate: date, safeToSpendCents: forecastMission(state, p.amount).lowCents - p.initial, status: date && date <= state.goal.targetDate ? 'on_track' : 'at_risk', explanation: p.initial ? '先单独确认一次性转入，再创建月度计划。' : '工资实际到账后次日转入，未到账则跳过。', recommended: p.id === 'balanced' };
      }) };
  }
  return SnapshotSchema.parse({ moneyMission: state.accountSnapshots.length ? readMoneyMission(state) : undefined, mission: state.accountSnapshots.length ? projectLegacyMission(state) : state.mission, goal: primaryGoal ?? state.goal, finance: state.finance, assessment,
    goals: state.goals, primaryGoalId: state.primaryGoalId, primaryGoal,
    pendingImpact: state.pendingImpact, mandate: state.mandate, audit: state.audit,
    operations: state.operations, receipts: state.receipts,
    approvalSummaries: state.approvals.map(({ token: _token, ...approval }) => approval),
    auditChainValid: verifyAuditChain(state.audit),
    twinVersion: state.twinVersion, cards: generatedCards(state, assessment), clock: state.clock,
    riskPreferences: state.riskPreferences, spendingPatterns: state.spendingPatterns,
    riskSignals: state.riskSignals, weeklyRiskSummaries: state.weeklyRiskSummaries,
    dataConnections: state.dataConnections, dataSyncBatches: state.dataSyncBatches,
  });
}
