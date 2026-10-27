import { randomUUID } from 'node:crypto';
import type { DemoState,HandoffCasePack } from '../shared/contracts.ts';

export function buildHandoffCasePack(state:DemoState,input:{problem:'subscription_requires_merchant'|'import_conflict'|'transfer_failed'|'unsupported';evidenceIds?:string[]}):HandoffCasePack {
  const labels={subscription_requires_merchant:'订阅需由商户人工处理',import_conflict:'账单存在尚未解决的数据冲突',transfer_failed:'储蓄计划执行需要核对',unsupported:'请求超出当前模拟服务能力'};
  const permitted=new Set(state.evidenceRefs.map(e=>e.id));
  const evidenceIds=(input.evidenceIds??[]).filter(id=>permitted.has(id)).slice(0,20);
  return {id:randomUUID(),createdAt:`${state.clock}T12:00:00+08:00`,problem:labels[input.problem],goalTitle:'当前旅行资金目标',
    facts:[`目标金额${state.goal.targetCents}分，已存${state.goal.savedCents}分。`,`数据截至${state.finance.updatedAt}，全部为模拟账户。`,...state.importIssues.filter(i=>!i.resolved).slice(0,5).map(i=>`待核对字段：${i.field}；问题类型：${i.kind}。`)],
    evidenceIds,attemptedSteps:[...state.subscriptionActions.filter(a=>['failed','requires_merchant','unknown','reconciled'].includes(a.status)).map(a=>`订阅动作状态：${a.status}。`),...state.transferExecutions.filter(e=>e.status!=='succeeded').slice(-5).map(e=>`转入核对状态：${e.status}。`)],
    questions:input.problem==='subscription_requires_merchant'?['请确认自动续费当前是否开启、关闭后何时生效，以及已付费服务何时结束。']:input.problem==='transfer_failed'?['请核对工资是否实际到账、余额快照是否有效，以及原操作是否已经执行。']:['请确认尚有争议的字段与来源，并提供可验证的依据。'],
    limitations:['此问题包未自动发送给任何人。','不包含原始文件、商户自由文本、完整账户标识、签名或令牌。']};
}
