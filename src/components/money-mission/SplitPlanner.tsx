import {recipientReady} from '../../../shared/recipient-identity';
import {useState} from 'react';
import type {ServiceAction} from '../../../shared/financial-services';
import {amountCents} from '../../../shared/amount';
export function SplitPlanner({recipients,source,defaultDate,busy,onPrepare}:{recipients:Array<{id:string;name:string;alias:string;suffix:string;version:number;identityStatus?:'verified'|'needs_review';verifiedVersion?:number}>;source:string;defaultDate:string;busy:boolean;onPrepare:(build:()=>ServiceAction)=>void}){
 const [participants,setParticipants]=useState(['self','contact-1','contact-2','contact-3']),[amount,setAmount]=useState('398.01'),[paid,setPaid]=useState(true),[payer,setPayer]=useState('self'),[custom,setCustom]=useState(false),[shares,setShares]=useState<Record<string,string>>({}),[due,setDue]=useState(defaultDate);
 let total=0;try{total=amountCents(amount);}catch{/* Preserve typed invalid input until explicit preview. */}
 const equal=(id:string)=>{const index=participants.indexOf(id);return Math.floor(total/participants.length)+(index<total%participants.length?1:0);};
 return <section className="mission-card"><h2 className="font-bold">拆分AA收款</h2>
  <label>总额（元）<input className="mission-input" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
  <fieldset><legend>参与人（本人必须参与）</legend><div className="max-h-40 overflow-auto">{recipients.map(r=><label key={r.id} className="flex items-center gap-2 py-1"><input type="checkbox" checked={participants.includes(r.id)} disabled={r.id==='self'} onChange={()=>{setParticipants(ids=>ids.includes(r.id)?ids.filter(id=>id!==r.id):[...ids,r.id]);if(payer===r.id)setPayer('self');}}/>{r.name} · {r.alias} · 尾号{r.suffix}{!recipientReady(r)&&' · 待核对'}</label>)}</div></fieldset>
  <label>谁已垫付<select className="mission-input" value={payer} onChange={e=>setPayer(e.target.value)}>{recipients.filter(r=>participants.includes(r.id)).map(r=><option key={r.id} value={r.id}>{r.name} · {r.alias} · 尾号{r.suffix}</option>)}</select></label>
  {payer==='self'?<label className="flex gap-2"><input type="checkbox" checked={paid} onChange={e=>setPaid(e.target.checked)}/>我已垫付，本次不再次支付</label>:<p>同行已垫付。本次仅记录应付款，之后可单独核对并支付本人份额；不会代同行收款。</p>}
  <label className="flex gap-2"><input type="checkbox" checked={custom} onChange={e=>setCustom(e.target.checked)}/>自定义每人份额</label>
  {custom&&recipients.filter(r=>participants.includes(r.id)).map(r=><label className="block" key={r.id}>{r.name} · {r.alias} 的份额（元）<input className="mission-input" inputMode="decimal" value={shares[r.id]??String(equal(r.id)/100)} onChange={e=>setShares({...shares,[r.id]:e.target.value})}/></label>)}
  <label>AA截止日期<input className="mission-input" type="date" value={due} onChange={e=>setDue(e.target.value)}/></label>
  <p className="text-xs text-[#5A616B]">均分余分按所选参与人顺序分配。自定义份额必须与总额精确相等；逾期不会自动扣款。</p>
  <button className="mission-primary" disabled={busy||participants.length<2} onClick={()=>onPrepare(()=>({kind:'split',totalCents:amountCents(amount),participantIds:participants,accountId:source,alreadyPaid:payer==='self'?paid:true,payerId:payer,dueDate:due,...(custom?{shares:participants.map(recipientId=>({recipientId,amountCents:amountCents(shares[recipientId]??String(equal(recipientId)/100))}))}:{})}))}>预览整数分拆分</button>
 </section>;
}
