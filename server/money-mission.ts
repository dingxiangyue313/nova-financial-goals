import type { DemoState,MoneyMissionReadModel } from '../shared/contracts.ts';
import { MoneyMissionReadModelSchema } from '../shared/contracts.ts';
import { activeStatementRows } from './statement-import.ts';
import { buildBillBrief } from './bill-analysis.ts';
import { addIsoDays,buildDatedCashflowForecast } from './cashflow-forecast.ts';
import { buildMoneyMissionPlans } from './money-mission-plans.ts';
import { CATEGORY_MAP } from './money-mission-fixture.ts';

export function readMoneyMission(state:DemoState):MoneyMissionReadModel {
  const billBrief=buildBillBrief(state,{periodStart:state.clock.slice(0,7)+'-01',periodEnd:state.clock});
  const horizonEnd=state.goal.targetDate>state.clock&&state.goal.targetDate<=addIsoDays(state.clock,366)?state.goal.targetDate:addIsoDays(state.clock,62);
  const forecast=state.accounts.some(a=>a.id==='checking')?buildDatedCashflowForecast(state,{accountId:'checking',horizonEnd,scenario:'baseline'}):null;
  const plans=forecast&&state.goal.targetDate>state.clock?buildMoneyMissionPlans(state,forecast):[];
  const stage=state.importIssues.some(i=>!i.resolved)?'data':state.transferSchedules.some(s=>s.status==='active')?'monitoring':state.subscriptionActions.some(a=>a.status==='succeeded'||a.status==='reconciled')?'planning':billBrief.subscriptionCandidates.length?'subscription':state.statementImportBatches.some(b=>b.status==='committed')?'bills':'data';
  return MoneyMissionReadModelSchema.parse({monitoringEnabled:state.mission?.monitoringEnabled??false,notifications:state.mission?.notifications??[],handoffCasePacks:state.handoffCasePacks,stage,twinVersion:state.twinVersion,dataAsOf:state.finance.updatedAt,batches:state.statementImportBatches,issues:state.importIssues,billBrief,forecast,plans,subscriptionActions:state.subscriptionActions,schedules:state.transferSchedules.map(({authorizationHash:_a,snapshotHash:_s,...schedule})=>schedule),executions:state.transferExecutions});
}
export function projectLegacyMission(state:DemoState):DemoState['mission'] {
  if(!state.mission)return undefined;
  const labels=Object.fromEntries(Object.entries(CATEGORY_MAP).map(([label,category])=>[category,label]));
  const rows=activeStatementRows(state).map(r=>({id:r.id,date:r.date,merchant:r.title,cents:r.amountCents,category:(labels[r.category]??'待核对') as NonNullable<DemoState['mission']>['rows'][number]['category'],source:({bank:'银行卡',wechat_pay:'微信',alipay:'支付宝'} as const)[r.sourceKind],excluded:!!r.excludedReason}));
  const subscription=state.subscriptionActions.filter(a=>a.subscriptionId==='cloudbox'&&a.action==='cancel').at(-1);
  const schedule=state.transferSchedules.filter(s=>['active','paused','completed','cancelled'].includes(s.status)).at(-1);
  const receipts:NonNullable<DemoState['mission']>['receipts']=[...state.subscriptionActions.filter(a=>a.action==='cancel'&&['succeeded','failed','unknown','requires_merchant','reconciled'].includes(a.status)).map(a=>({id:a.id,kind:'cancel_subscription',status:(a.status==='unknown'?'unknown':a.nextChargeSuppressed?'succeeded':'failed') as 'unknown'|'succeeded'|'failed',date:a.cancelledAt?.slice(0,10)??state.clock,detail:a.nextChargeSuppressed?`商户已验证关闭自动续费；服务可用至${a.paidThrough}，不退款。`:'尚未验证取消成功；请查询原操作或联系商户，暂不计入节省。',amountCents:0,requestId:a.id})),...state.transferSchedules.filter(s=>s.status!=='awaiting_confirmation').map(s=>({id:`schedule:${s.id}`,kind:'create_schedule',status:'succeeded' as const,date:s.createdAt.slice(0,10),detail:s.frequency==='monthly'?'储蓄计划已创建，尚未转账。每期需验证到账、余额和停止条件。':'一次性转入安排已确认，请查看执行回执。',amountCents:s.amountCents,requestId:s.id})),...state.transferExecutions.filter(e=>e.status!=='scheduled').map(e=>({id:e.id,kind:'scheduled_transfer',status:(e.status==='succeeded'||e.status==='reconciled'?'succeeded':e.status==='unknown'?'unknown':e.status==='skipped_missing_trigger'?'skipped':'failed') as 'succeeded'|'unknown'|'skipped'|'failed',date:new Date(Date.parse(e.createdAt)+8*3600000).toISOString().slice(0,10),detail:e.reason,amountCents:e.amountCents,requestId:e.id}))];
  receipts.sort((a,b)=>a.date.localeCompare(b.date));
  return {...state.mission,rows,subscription:subscription?{...state.mission.subscription,status:subscription.status==='unknown'?'unknown':subscription.nextChargeSuppressed?'cancelled':subscription.status==='failed'?'failed':'active',cancelledAt:subscription.cancelledAt,effectiveAt:subscription.nextChargeSuppressed?subscription.effectiveAt:null,paidThrough:subscription.paidThrough,nextChargeSuppressed:subscription.nextChargeSuppressed,merchantOperationId:subscription.merchantOperationId}:state.mission.subscription,
    schedule:schedule?{id:schedule.id,goalId:schedule.goalId,amountCents:schedule.amountCents,frequency:schedule.frequency==='one_time'?'once':'monthly',status:schedule.status as 'active'|'paused'|'completed'|'cancelled',createdAt:schedule.createdAt.slice(0,10),endDate:schedule.endDate,processedMonths:state.transferExecutions.filter(e=>e.scheduleId===schedule.id&&e.status!=='scheduled').map(e=>e.periodKey.slice(-7))}:null,receipts};
}
