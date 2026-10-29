import {useState} from 'react';
import type {FinancialServicesView} from '../../../server/financial-services';
import type {ServiceAction} from '../../../shared/financial-services';
import {money} from '../../lib/format';
export function CardApplications({view,busy,limit,onLimit,onPrepare,onQuery,onCredit}:{view:FinancialServicesView;busy:boolean;limit:string;onLimit:(s:string)=>void;onPrepare:(a:ServiceAction)=>void;onQuery:(id:string)=>void;onCredit:(missing:boolean)=>void}){
 const [missing,setMissing]=useState(false),[employment,setEmployment]=useState<'synthetic_salaried'|'synthetic_freelance'>('synthetic_salaried'),[ack,setAck]=useState(false);
 const names:Record<string,string>={under_review:'审核中',unknown:'结果待核对',approved:'已通过',rejected:'未通过',withdrawn:'已撤回',needs_information:'待补充资料'};
 return <section className="mission-card"><h2 className="font-bold">模拟卡片申请</h2><p>使用合成身份，费用¥0。信用额度不增加活期或目标余额。</p>
 <button className="mission-secondary" disabled={busy} onClick={()=>onPrepare({kind:'apply_card',product:'travel_debit',requestedLimitCents:500000,employmentEvidence:'available'})}>申请旅行借记卡</button>
 <label className="block py-2"><input type="checkbox" checked={missing} onChange={e=>setMissing(e.target.checked)}/> 信用卡申请暂缺就业说明（合成资料）</label>
 <button className="mission-secondary" disabled={busy} onClick={()=>onCredit(missing)}>申请日常信用卡</button>
 <label>申请额度或单笔限制（元）<input className="mission-input" value={limit} onChange={e=>onLimit(e.target.value)}/></label>
 {view.applications.map(a=><article className="border-t py-3" aria-label="卡片申请结果" key={a.id}><strong>{a.product==='travel_debit'?'旅行借记卡':'日常信用卡'} · {names[a.status]}</strong><p>申请{money(a.requestedCents)} · {a.status==='approved'?'获批'+money(a.approvedCents):'尚无生效额度'}</p>{a.decisionReason&&<p>{a.decisionReason}</p>}
 {a.supplementedOn&&<p>合成资料提交于{a.supplementedOn} · {a.employment==='synthetic_freelance'?'自由职业收入说明':'在职证明'}</p>}
 {['under_review','unknown'].includes(a.status)&&<button className="mission-link" disabled={busy} onClick={()=>onQuery(a.id)}>查询申请进度</button>}
 {a.status==='needs_information'&&<fieldset className="rounded-xl bg-[#F4F7F7] p-3"><legend>补充原申请的合成资料</legend><label>就业说明类型<select className="mission-input" value={employment} onChange={e=>{setEmployment(e.target.value as typeof employment);setAck(false);}}><option value="synthetic_salaried">合成在职证明</option><option value="synthetic_freelance">合成自由职业收入说明</option></select></label><label className="block py-2"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/> 我确认仅提交虚构样例，不含真实身份或收入材料</label><button className="mission-secondary" disabled={busy||!ack} onClick={()=>onPrepare({kind:'supplement_card_application',id:a.id,employment,acknowledged:true})}>核对补交资料</button></fieldset>}
 {['under_review','needs_information'].includes(a.status)&&<button className="mission-link" disabled={busy} onClick={()=>onPrepare({kind:'withdraw_card_application',id:a.id})}>核对撤回申请</button>}
 {a.status==='unknown'&&<p>原申请结果待核对，查询后再决定下一步。</p>}</article>)}
 </section>;
}
