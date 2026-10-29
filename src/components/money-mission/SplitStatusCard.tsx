import {splitStatement} from '../../../shared/split-report';
import {useState} from 'react';
import type {FinancialServicesView} from '../../../server/financial-services';
import type {ServiceAction} from '../../../shared/financial-services';
export function SplitStatusCard({split,view,source,busy,onPrepare,onQuery}:{split:FinancialServicesView['splits'][number];view:FinancialServicesView;source:string;busy:boolean;onPrepare:(a:ServiceAction)=>void;onQuery:()=>void}){
 const [date,setDate]=useState('');
 const money=(c:number)=>`¥${(c/100).toLocaleString('zh-CN')}`,other=Boolean(split.payerId&&split.payerId!=='self');
 const active=['open','partial'].includes(split.status),own=split.shares.find(s=>s.recipientId==='self');
 const payer=view.recipients.find(r=>r.id===(split.payerId??'self'));
 return <section className="mission-card" aria-label={`AA ${money(split.totalCents)}`}>
  <button className="mission-link block min-h-11" onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(splitStatement(split,view.clock),null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='nova-aa-statement.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>导出此AA对账单</button>
  <strong>AA {money(split.totalCents)} · {split.status==='closed'?'已关闭':split.status==='collected'?'已结清':other?'本人应付款':'待收款'}</strong>
  <p>垫付人：{payer?.name} · {payer?.alias}。截止 {split.dueDate}。</p>
  {active&&split.dueDate<view.clock&&<p role="status" className="text-amber-800">已逾期，未自动扣款或催收；可核对状态或关闭剩余请求。</p>}
  {(split.dateChanges??[]).map(change=><p className="text-xs" key={change.operationId}>日期记录：{change.from} → {change.to} · {change.changedOn}</p>)}
  {active&&<details><summary className="mission-link min-h-11 py-2">协商新的截止日期</summary><p>只记录本会话的延期安排，不代表同行已同意，也不会自动发送消息。最多选择模拟今天之后90天内的更晚日期。</p><label>新的AA截止日期<input className="mission-input" type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><button className="mission-secondary" disabled={busy||!date} onClick={()=>onPrepare({kind:'reschedule_split',id:split.id,expectedDueDate:split.dueDate,dueDate:date})}>核对延期安排</button></details>}
  {!split.participants&&<p className="text-xs">历史请求未保存身份快照，以下联系方式为当前资料，请核对原凭证。</p>}
  {split.shares.map(share=><p key={share.recipientId}>{(()=>{const r=split.participants?.find(r=>r.id===share.recipientId)??view.recipients.find(r=>r.id===share.recipientId);return `${r?.name??'待核对'} · ${r?.alias??''} · 尾号${r?.suffix??'未知'}`;})()}：应付{money(share.amountCents)}，{other?'已结算':'已收'}{money(share.collectedCents)}</p>)}
  {active&&<>{other?own&&own.amountCents>own.collectedCents&&<button className="mission-primary" disabled={busy} onClick={()=>onPrepare({kind:'pay_split_share',id:split.id,accountId:source})}>核对并支付本人份额</button>:<button className="mission-secondary" disabled={busy} onClick={onQuery}>查询模拟收款</button>}<button className="mission-secondary" disabled={busy} onClick={()=>onPrepare({kind:'close_split',id:split.id})}>关闭剩余请求</button></>}
 </section>;
}
