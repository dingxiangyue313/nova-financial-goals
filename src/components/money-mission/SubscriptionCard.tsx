import type {Subscription,SubscriptionAction} from '../../../shared/contracts';
import {subscriptionCharge,subscriptionCycleLabel} from '../../../shared/subscription-cycle';

export function SubscriptionCard({item,actions,rows,busy,onPrepare,onDecision,onQuery}:{
 item:Subscription;actions:SubscriptionAction[];rows:Array<{id:string;title:string;merchantId:string|null;date:string;amountCents:number;excludedReason:string|null;sourceKind:string}>;
 busy:boolean;onPrepare:()=>void;onDecision:(action:string)=>void;onQuery:(id:string)=>void;
}){
 const last=actions.filter(a=>a.subscriptionId===item.id).at(-1);
 const history=rows.filter(r=>!r.excludedReason&&r.amountCents<0&&(r.title===item.title||r.merchantId===item.id||item.id==='cloudbox-plus'&&r.merchantId==='cloudbox')).sort((a,b)=>a.date.localeCompare(b.date)).slice(-4);
 const amount=subscriptionCharge(item),money=(c:number)=>`¥${(c/100).toLocaleString('zh-CN')}`;
 const paidThrough=last?.paidThrough??new Date(Date.parse(item.nextChargeDate+'T00:00:00Z')-86400000).toISOString().slice(0,10);
 const previous=history.length>1?Math.abs(history[history.length-2].amountCents):null;
 const cancelled=last?.nextChargeSuppressed===true;
 return <article className="mission-card" aria-label={`${item.title}订阅处理`}>
  <h3 className="font-bold">{item.classification==='confirmed'?'订阅与代扣':'可能是订阅'}：{item.title}</h3>
  <p>{subscriptionCycleLabel(item)}扣费 {money(amount)}，{cancelled?'原定':'预计'}下次扣费 {item.nextChargeDate}。当前付费期至 {paidThrough}。{previous!==null&&amount>previous?`比此前扣费增加 ${money(amount-previous)}。`:null}使用情况需要你自己确认。</p>
  {item.billingCycle==='annual'&&<p className="text-xs text-[#5A616B]">按原周期每年扣 {money(amount)}；不会按月扣费或立刻增加可用余额。</p>}
  {item.billingCycle==='once'&&<p className="text-xs text-[#5A616B]">单次或短期项目，不外推为永久月费；需要先核对是否存在后续扣款。</p>}
  {item.necessary&&<p className="text-amber-800">必要代扣，取消前请先确认替代安排。</p>}
  <div className="my-3 text-xs text-[#5A616B] space-y-1">{history.map(row=><p key={row.id}>{row.date} · {money(Math.abs(row.amountCents))} · {({bank:'银行卡',wechat_pay:'微信支付',alipay:'支付宝'} as Record<string,string>)[row.sourceKind]??row.sourceKind}</p>)}</div>
  {cancelled?<p role="status">已关闭自动续费：{item.title}。服务保持至 {paidThrough}；本次不退款。</p>:last?.status==='unknown'?<><p role="status">结果待核对，暂不计入节省，也不会重复取消。</p><button className="mission-primary" disabled={busy} onClick={()=>onQuery(last.id)}>查询商户结果</button></>:<>
    {last?.status==='failed'&&<p role="status">取消未成功，预计扣费仍保留。再次尝试前需要重新核对和确认。</p>}
    {last?.status==='requires_merchant'&&<p role="status">商户需要你到官方渠道处理。请携带商户名称、付费期与本次记录号 {last.id}；当前未取消，也不计入节省。</p>}
    {last?.action==='keep'&&<p role="status">已选择保留服务与续费。</p>}
    {last?.action==='remind'&&<p role="status">已安排 {last.reminderAt} 续费前提醒，不会自动取消。</p>}
    {last?.action==='not_subscription'?<p role="status">已标记为非订阅，停止准备取消；原始账单仍保留。</p>:<div className="grid grid-cols-2 gap-2">
      <button className="mission-primary text-xs" disabled={busy} onClick={onPrepare}>不再使用，准备取消</button>
      {([['keep','保留'],['remind','续费前提醒'],['not_subscription','这不是订阅']] as const).map(([action,label])=><button key={action} className="mission-secondary" disabled={busy} onClick={()=>onDecision(action)}>{label}</button>)}
    </div>}
  </>}
 </article>;
}
