import type {FinancialServicesView} from '../../../server/financial-services';
import type {ServiceAction} from '../../../shared/financial-services';
export function SplitStatusCard({split,view,source,busy,onPrepare,onQuery}:{split:FinancialServicesView['splits'][number];view:FinancialServicesView;source:string;busy:boolean;onPrepare:(a:ServiceAction)=>void;onQuery:()=>void}){
 const money=(c:number)=>`¥${(c/100).toLocaleString('zh-CN')}`,other=Boolean(split.payerId&&split.payerId!=='self');
 const active=['open','partial'].includes(split.status),own=split.shares.find(s=>s.recipientId==='self');
 const payer=view.recipients.find(r=>r.id===(split.payerId??'self'));
 return <section className="mission-card" aria-label={`AA ${money(split.totalCents)}`}>
  <strong>AA {money(split.totalCents)} · {split.status==='closed'?'已关闭':split.status==='collected'?'已结清':other?'本人应付款':'待收款'}</strong>
  <p>垫付人：{payer?.name} · {payer?.alias}。截止 {split.dueDate}。</p>
  {active&&split.dueDate<view.clock&&<p role="status" className="text-amber-800">已逾期，未自动扣款或催收；可核对状态或关闭剩余请求。</p>}
  {split.shares.map(share=><p key={share.recipientId}>{view.recipients.find(r=>r.id===share.recipientId)?.name}：应付{money(share.amountCents)}，{other?'已结算':'已收'}{money(share.collectedCents)}</p>)}
  {active&&<>{other?own&&own.amountCents>own.collectedCents&&<button className="mission-primary" disabled={busy} onClick={()=>onPrepare({kind:'pay_split_share',id:split.id,accountId:source})}>核对并支付本人份额</button>:<button className="mission-secondary" disabled={busy} onClick={onQuery}>查询模拟收款</button>}<button className="mission-secondary" disabled={busy} onClick={()=>onPrepare({kind:'close_split',id:split.id})}>关闭剩余请求</button></>}
 </section>;
}
