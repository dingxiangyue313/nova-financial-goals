import { SnapshotSchema, type Assessment, type DemoState, type Snapshot, type UiCard } from '../shared/contracts.ts';
import { assessGoal } from './domain.ts';

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
  return cards;
}

export function snapshot(state: DemoState): Snapshot {
  const assessment = assessGoal(state);
  return SnapshotSchema.parse({ goal: state.goal, finance: state.finance, assessment,
    pendingImpact: state.pendingImpact, mandate: state.mandate, audit: state.audit,
    operations: state.operations, cards: generatedCards(state, assessment), clock: state.clock });
}
