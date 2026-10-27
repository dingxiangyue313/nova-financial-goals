import { MoneyMissionReadModelSchema, MoneyMissionSubscriptionActionSchema, MoneyMissionTransferExecutionSchema,
  TransferScheduleSchema, type DemoState, type MoneyMissionReadModel } from '../shared/contracts.ts';

const stages = ['goal', 'data', 'bill', 'subscription', 'plan', 'transfer', 'monitoring'] as const;
const nextLabels = {
  goal: '描述旅行目标', data: '连接或导入数据', bill: '查看账单分析', subscription: '核对订阅处理',
  plan: '比较目标方案', transfer: '准备转账安排', monitoring: '查看持续守护',
};
const eventLabels = { income: '预计收入', bill: '待付账单', subscription: '订阅续费', transfer: '目标转入', purchase: '计划支出' };

/** Read-only projection. No raw source state or execution authority crosses this boundary. */
export function moneyMissionReadModel(state: DemoState): MoneyMissionReadModel {
  const goal = (state.goals ?? []).find(item => item.id === state.primaryGoalId) ?? null;
  const hasBalanceEvidence = (state.accountSnapshots ?? []).some(snapshot =>
    (state.accounts ?? []).some(account => account.id === snapshot.accountId && account.type === 'checking'));
  const hasData = (state.statementImportBatches ?? []).some(batch => batch.status === 'committed' && batch.importedCount > 0)
    || hasBalanceEvidence && (state.dataConnections ?? []).some(source => source.status === 'connected');
  const billBrief = goal && hasData ? (state.billBriefs ?? []).at(-1) ?? null : null;
  const candidates = billBrief?.subscriptionCandidates ?? [];
  const decisions = candidates.map(candidate => (state.subscriptionActions ?? []).filter(action =>
    candidate.subscriptionId ? action.subscriptionId === candidate.subscriptionId : action.merchantId === candidate.merchantId).at(-1));
  const subscriptionResolved = Boolean(billBrief) && decisions.every(action => action &&
    (action.action === 'cancel' ? action.status === 'cancelled' ||
      ['succeeded', 'reconciled'].includes(action.status) && action.nextChargeSuppressed
      : ['succeeded', 'reconciled'].includes(action.status)));
  const subscriptionAction = decisions.filter(action => action !== undefined).at(-1) ?? null;
  const goalPlans = goal ? (state.goalPlanOptions ?? []).filter(option => option.goalId === goal.id) : [];
  const selectedPlan = goalPlans.find(option => option.id === goal?.selectedPlanId);
  const latestOptions = goalPlans.slice(-3);
  const planOptions = selectedPlan && !latestOptions.some(option => option.id === selectedPlan.id)
    ? [selectedPlan, ...latestOptions.slice(-2)] : latestOptions;
  const planSelected = Boolean(selectedPlan && goal && ['active', 'paused', 'achieved'].includes(goal.status));
  const transferSchedule = goal ? (state.transferSchedules ?? []).filter(schedule => schedule.goalId === goal.id &&
    schedule.planOptionId === goal.selectedPlanId).at(-1) ?? null : null;
  const transferReady = Boolean(transferSchedule && ['active', 'paused', 'completed'].includes(transferSchedule.status));
  const forecastId = selectedPlan?.forecastId ?? planOptions.at(-1)?.forecastId;
  const sourceForecast = (state.datedCashflowForecasts ?? []).find(forecast => forecast.id === forecastId);
  const forecast = sourceForecast ? { ...sourceForecast,
    events: sourceForecast.events.map(event => ({ ...event, label: eventLabels[event.kind] })) } : null;
  const gates = [Boolean(goal), hasData, Boolean(billBrief), subscriptionResolved, planSelected, transferReady];
  const firstIncomplete = gates.findIndex(complete => !complete);
  const currentIndex = firstIncomplete === -1 ? 6 : firstIncomplete;
  const currentStage = stages[currentIndex];
  const refs = new Set([
    ...(billBrief?.sourceRefs ?? []), ...(billBrief?.claims.flatMap(claim => claim.sourceRefs) ?? []),
    ...(billBrief?.categories.flatMap(category => category.sourceRefs) ?? []),
    ...(billBrief?.changes.flatMap(change => change.sourceRefs) ?? []),
    ...candidates.flatMap(candidate => candidate.sourceRefs), ...(subscriptionAction?.evidenceRefs ?? []),
    ...(forecast?.evidenceRefs ?? []), ...planOptions.flatMap(option => option.evidenceRefs),
  ]);
  return MoneyMissionReadModelSchema.parse({
    goalId: goal?.id ?? null, currentStage, completedStages: stages.slice(0, currentIndex),
    nextAction: { id: currentStage, label: nextLabels[currentStage] },
    dataAsOf: billBrief?.dataAsOf ?? forecast?.dataAsOf ?? state.clock, twinVersion: state.twinVersion ?? 1,
    billBrief, subscriptionAction: subscriptionAction ? MoneyMissionSubscriptionActionSchema.parse(subscriptionAction) : null,
    forecast, planOptions,
    transferSchedule: transferSchedule ? TransferScheduleSchema.strip().parse(transferSchedule) : null,
    transferExecutions: transferSchedule ? (state.transferExecutions ?? [])
      .filter(execution => execution.scheduleId === transferSchedule.id)
      .map(execution => MoneyMissionTransferExecutionSchema.parse(execution)) : [],
    evidenceRefs: (state.evidenceRefs ?? []).filter(ref => refs.has(ref.id)).map(ref => ({ ...ref,
      label: ref.sourceKind === 'transaction' ? '已核验交易依据' : ref.label })),
    limitations: [
      '所有数据和操作均为模拟；准备方案不会自动授权或执行。',
      ...(!hasData ? ['仍需核对账单来源、覆盖范围和账户余额，暂不能判断目标是否按时完成。'] : []),
      ...(billBrief?.limitations ?? []), ...(forecast?.limitations ?? []),
    ],
  });
}
