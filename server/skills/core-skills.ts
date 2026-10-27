import type { DemoState,SkillId } from '../../shared/contracts.ts';
import { buildBillBrief } from '../bill-analysis.ts';
import { buildDatedCashflowForecast,addIsoDays } from '../cashflow-forecast.ts';
import { buildMoneyMissionPlans } from '../money-mission-plans.ts';
import { buildHandoffCasePack } from '../handoff.ts';
import { CoreSkillInputSchema,CoreSkillOutputSchema,getEnabledSkill,assertSkillToolAllowed } from './registry.ts';

const yuan=(cents:number)=>`¥${(cents/100).toLocaleString('zh-CN')}`;
export function runCoreSkill(state:DemoState,id:SkillId,input:unknown={}) {
  const definition=getEnabledSkill(id),args=CoreSkillInputSchema.parse(input);let next=state;
  let stage:'data'|'bills'|'planning'|'transfer'|'monitoring'|'handoff'='bills',summary='',artifactId='mission';
  const claims:Array<{claimType:'fact'|'assumption'|'prediction'|'limitation';text:string;sourceRefs:string[]}>=[];
  let toolCalls=0;const call=<T>(tool:string,fn:()=>T)=>{assertSkillToolAllowed(id,tool);if(++toolCalls>definition.maxToolCalls)throw new Error('SKILL_TOOL_BUDGET');return fn();};
  if(id==='statement_ingestion_and_reconciliation'){
    call('read_import_quality',()=>{stage='data';summary=`已有${state.statementImportBatches.filter(b=>b.status==='committed').length}个已确认批次，${state.importIssues.filter(i=>!i.resolved).length}项待核对。历史账单不会改写当前余额。`;artifactId=state.statementImportBatches.at(-1)?.id??'data-coverage';});
  }else if(id==='bill_and_subscription_investigator'||id==='financial_explanation_and_provenance'){
    const brief=call(id==='bill_and_subscription_investigator'?'bill_period_summary':'read_explanation_evidence',()=>buildBillBrief(state,{periodStart:state.clock.slice(0,7)+'-01',periodEnd:state.clock}));
    next={...state,billBriefs:[...state.billBriefs.filter(b=>b.id!==brief.id),brief],evidenceRefs:[...state.evidenceRefs.filter(e=>!brief.claims.some(c=>c.id===e.id)),...brief.claims]};artifactId=brief.id;
    summary=`本期计入消费${yuan(brief.totalExpenseCents)}。${brief.subscriptionCandidates.length?'发现可能的周期订阅，请核对证据及使用情况。':'周期证据不足，暂不认定订阅。'}取消或转入都需要你单独确认。`;
    claims.push(...brief.claims.map(c=>({claimType:c.claimType,text:c.label,sourceRefs:c.sourceRefs??[c.sourceId]})));
  }else if(id==='dated_cashflow_forecast'||id==='goal_portfolio_planner'){
    const horizonEnd=id==='goal_portfolio_planner'&&state.goal.targetDate<=addIsoDays(state.clock,366)?state.goal.targetDate:addIsoDays(state.clock,62);
    const forecast=call('dated_cashflow_forecast',()=>buildDatedCashflowForecast(state,{accountId:'checking',horizonEnd,scenario:'baseline'}));
    next={...state,datedForecasts:[...state.datedForecasts.filter(f=>f.forecastId!==forecast.forecastId),forecast]};artifactId=forecast.forecastId??'missing-balance';stage=id==='goal_portfolio_planner'?'planning':'bills';
    summary=forecast.precision==='exact'?`预计最低可用余额${yuan(forecast.minimumBalanceCents!)}，出现在${forecast.minimumBalanceDate}。未来工资仍是假设。`:'当前权威余额不足或已过期，可以分析历史账单，但不能据此执行转账。';
    claims.push({claimType:'prediction',text:summary,sourceRefs:[forecast.forecastId??'data-coverage']});
    if(id==='goal_portfolio_planner'){const plans=call('build_goal_portfolio',()=>buildMoneyMissionPlans(state,forecast));next={...next,goalPlanOptions:plans};summary+=plans.some(p=>p.conflicts.length)?'多个目标或保护资金存在冲突，需先明确优先级。':'已核算三个不同节奏，可在计划页比较。';}
  }else if(id==='transfer_and_savings_executor'){
    call('get_transfer_schedule_status',()=>{stage='transfer';const schedules=state.transferSchedules.filter(s=>!args.artifactId||s.id===args.artifactId);if(args.artifactId&&!schedules.length)throw new Error('SCHEDULE_NOT_FOUND');artifactId=schedules.at(-1)?.id??'transfer-builder';summary=schedules.length?`储蓄计划状态：${({active:'进行中',paused:'已暂停',completed:'已完成',cancelled:'已取消',awaiting_confirmation:'待确认',draft:'草稿',simulated:'预览',failed:'需处理'})[schedules.at(-1)!.status]}。请核对触发条件和执行回执。`:'尚未创建储蓄计划。请在计划页选择金额、账户和频率，再核对确认。创建月度计划时不会立即扣款。';});
  }else if(id==='outcome_monitor_and_replanner'){
    call('read_material_outcomes',()=>{stage='monitoring';const outcomes=state.transferExecutions.filter(e=>['failed','unknown','skipped_missing_trigger'].includes(e.status));artifactId=outcomes.at(-1)?.id??'monitoring';summary=outcomes.length?'检测到需要核对的转入结果。可以查询原操作，或预览暂停及重新规划；不会自动补扣。':'目前没有新的显著执行问题。';claims.push({claimType:'fact',text:summary,sourceRefs:outcomes.length?outcomes.map(e=>e.id):['monitoring']});});
  }else if(id==='human_handoff_case_pack'){
    const pack=call('prepare_case_pack',()=>buildHandoffCasePack(state,{problem:state.subscriptionActions.some(a=>a.status==='requires_merchant')?'subscription_requires_merchant':state.importIssues.some(i=>!i.resolved)?'import_conflict':state.transferExecutions.some(e=>e.status==='failed')?'transfer_failed':'unsupported'}));next={...state,handoffCasePacks:[...state.handoffCasePacks,pack]};stage='handoff';artifactId=pack.id;summary=`已整理人工问题包：${pack.problem}。包含必要事实、已尝试步骤与待确认问题，尚未向任何人发送。`;
  }
  if(!claims.length)claims.push({claimType:'fact',text:summary,sourceRefs:[artifactId]});
  const output=CoreSkillOutputSchema.parse({skillId:id,artifactId,stage,summary,claims,requiresConfirmation:definition.confirmationRequired});
  return {state:next,output,toolCalls};
}
