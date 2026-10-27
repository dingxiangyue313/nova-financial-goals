import type { DemoState, MissionNextCta, MissionStage, MoneyMissionReadModel } from '../shared/contracts.ts';
import { MoneyMissionReadModelSchema } from '../shared/contracts.ts';
import { activeStatementRows } from './statement-import.ts';
import { buildBillBrief } from './bill-analysis.ts';
import { addIsoDays, buildDatedCashflowForecast } from './cashflow-forecast.ts';
import { buildMoneyMissionPlans } from './money-mission-plans.ts';
import { previewMissionRepairs } from './mission-monitor.ts';
import { CATEGORY_MAP } from './money-mission-fixture.ts';

const STAGE_ORDER: MissionStage[] = ['goal', 'data', 'bills', 'subscription', 'planning', 'transfer', 'monitoring'];
const CTAS: Record<MissionStage, MissionNextCta> = {
  goal: { id: 'continue_mission', label: '开始日本旅行 Money Mission', stage: 'goal' },
  data: { id: 'import_sample', label: '导入合成账单', stage: 'data' },
  bills: { id: 'view_bill_brief', label: '查看账单摘要', stage: 'bills' },
  subscription: { id: 'review_cloudbox', label: '查看 CloudBox 证据', stage: 'subscription' },
  planning: { id: 'compare_plans', label: '比较三种计划', stage: 'planning' },
  transfer: { id: 'confirm_salary_schedule', label: '确认工资到账后转入', stage: 'transfer' },
  monitoring: { id: 'review_monitoring', label: '查看监测与修复预览', stage: 'monitoring' },
};

export function currentMoneyMissionStage(state: DemoState, billBrief = buildBillBrief(state, {
  periodStart: `${state.clock.slice(0, 7)}-01`, periodEnd: state.clock,
})): MissionStage {
  const hasCommitted = state.statementImportBatches.some(batch => batch.status === 'committed');
  if (state.importIssues.some(issue => !issue.resolved && issue.severity !== 'info')) return 'data';
  if (state.transferSchedules.some(schedule => ['active', 'paused'].includes(schedule.status))) return 'monitoring';
  if (state.transferSchedules.some(schedule => schedule.status === 'awaiting_confirmation')) return 'transfer';
  if (state.subscriptionActions.some(action => action.action === 'cancel' && ['succeeded', 'reconciled'].includes(action.status))) return 'planning';
  if (hasCommitted && billBrief.subscriptionCandidates.length) return 'subscription';
  if (hasCommitted) return 'bills';
  return state.mission || state.goals.length ? 'data' : 'goal';
}

export function readMoneyMission(state: DemoState): MoneyMissionReadModel {
  const billBrief = buildBillBrief(state, { periodStart: `${state.clock.slice(0, 7)}-01`, periodEnd: state.clock });
  const horizonEnd = state.goal.targetDate > state.clock && state.goal.targetDate <= addIsoDays(state.clock, 366)
    ? state.goal.targetDate : addIsoDays(state.clock, 62);
  const forecast = state.accounts.some(account => account.id === 'checking')
    ? buildDatedCashflowForecast(state, { accountId: 'checking', horizonEnd, scenario: 'baseline' }) : null;
  const plans = forecast && state.goal.targetDate > state.clock ? buildMoneyMissionPlans(state, forecast) : [];
  const stage = currentMoneyMissionStage(state, billBrief);
  const nextCta = state.importIssues.some(issue => !issue.resolved && issue.severity !== 'info')
    ? { id: 'resolve_import_issues', label: '核对导入问题', stage: 'data' as const }
    : CTAS[stage];
  return MoneyMissionReadModelSchema.parse({
    monitoringEnabled: state.mission?.monitoringEnabled ?? false,
    notifications: state.mission?.notifications ?? [],
    handoffCasePacks: state.handoffCasePacks,
    stage,
    completedStages: STAGE_ORDER.slice(0, STAGE_ORDER.indexOf(stage)),
    nextCta,
    repairPreviews: previewMissionRepairs(state),
    twinVersion: state.twinVersion,
    dataAsOf: state.finance.updatedAt,
    batches: state.statementImportBatches,
    issues: state.importIssues,
    billBrief,
    forecast,
    plans,
    subscriptionActions: state.subscriptionActions,
    schedules: state.transferSchedules.map(({ authorizationHash: _a, snapshotHash: _s, ...schedule }) => schedule),
    executions: state.transferExecutions,
  });
}

export function projectLegacyMission(state: DemoState): DemoState['mission'] {
  if (!state.mission) return undefined;
  const labels = Object.fromEntries(Object.entries(CATEGORY_MAP).map(([label, category]) => [category, label]));
  const rows = activeStatementRows(state).map(row => ({
    id: row.id, date: row.date, merchant: row.title,
    cents: row.amountCents,
    category: (labels[row.category] ?? '待核对') as NonNullable<DemoState['mission']>['rows'][number]['category'],
    source: ({ bank: '银行卡', wechat_pay: '微信', alipay: '支付宝' } as const)[row.sourceKind],
    excluded: !!row.excludedReason,
  }));
  const subscription = state.subscriptionActions.filter(action => action.subscriptionId === 'cloudbox' && action.action === 'cancel').at(-1);
  const schedule = state.transferSchedules.filter(item => ['active', 'paused', 'completed', 'cancelled'].includes(item.status)).at(-1);
  const receipts: NonNullable<DemoState['mission']>['receipts'] = [
    ...state.subscriptionActions.filter(action => action.action === 'cancel' && ['succeeded', 'failed', 'unknown', 'requires_merchant', 'reconciled'].includes(action.status)).map(action => ({
      id: action.id, kind: 'cancel_subscription' as const,
      status: (action.status === 'unknown' ? 'unknown' : action.nextChargeSuppressed ? 'succeeded' : 'failed') as 'unknown' | 'succeeded' | 'failed',
      date: action.cancelledAt?.slice(0, 10) ?? state.clock,
      detail: action.nextChargeSuppressed ? `商户已验证关闭自动续费；服务可用至${action.paidThrough}，不退款。` : '尚未验证取消成功；请查询原操作或联系商户，暂不计入节省。',
      amountCents: 0, requestId: action.id,
    })),
    ...state.transferSchedules.filter(item => item.status !== 'awaiting_confirmation').map(item => ({
      id: `schedule:${item.id}`, kind: 'create_schedule' as const, status: 'succeeded' as const,
      date: item.createdAt.slice(0, 10),
      detail: item.frequency === 'monthly' ? '储蓄计划已创建，尚未转账。每期需验证到账、余额和停止条件。' : '一次性转入安排已确认，请查看执行回执。',
      amountCents: item.amountCents, requestId: item.id,
    })),
    ...state.transferExecutions.filter(execution => execution.status !== 'scheduled').map(execution => ({
      id: execution.id, kind: 'scheduled_transfer' as const,
      status: (execution.status === 'succeeded' || execution.status === 'reconciled' ? 'succeeded'
        : execution.status === 'unknown' ? 'unknown'
          : execution.status === 'skipped_missing_trigger' ? 'skipped' : 'failed') as 'succeeded' | 'unknown' | 'skipped' | 'failed',
      date: new Date(Date.parse(execution.createdAt) + 8 * 3600000).toISOString().slice(0, 10),
      detail: execution.reason, amountCents: execution.amountCents, requestId: execution.id,
    })),
  ];
  receipts.sort((left, right) => left.date.localeCompare(right.date));
  return {
    ...state.mission, rows,
    subscription: subscription ? {
      ...state.mission.subscription,
      status: subscription.status === 'unknown' ? 'unknown' : subscription.nextChargeSuppressed ? 'cancelled' : subscription.status === 'failed' ? 'failed' : 'active',
      cancelledAt: subscription.cancelledAt,
      effectiveAt: subscription.nextChargeSuppressed ? subscription.effectiveAt : null,
      paidThrough: subscription.paidThrough,
      nextChargeSuppressed: subscription.nextChargeSuppressed,
      merchantOperationId: subscription.merchantOperationId,
    } : state.mission.subscription,
    schedule: schedule ? {
      id: schedule.id, goalId: schedule.goalId, amountCents: schedule.amountCents,
      frequency: schedule.frequency === 'one_time' ? 'once' : 'monthly',
      status: schedule.status as 'active' | 'paused' | 'completed' | 'cancelled',
      createdAt: schedule.createdAt.slice(0, 10), endDate: schedule.endDate,
      processedMonths: state.transferExecutions.filter(execution => execution.scheduleId === schedule.id && execution.status !== 'scheduled').map(execution => execution.periodKey.slice(-7)),
    } : null,
    receipts,
  };
}
