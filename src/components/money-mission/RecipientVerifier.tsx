import {useEffect,useState} from 'react';
import type {FinancialServicesView} from '../../../server/financial-services';
import type {ServiceAction} from '../../../shared/financial-services';
import {recipientReady} from '../../../shared/recipient-identity';
export function RecipientVerifier({recipients,selectedId,busy,onSelect,onPrepare}:{recipients:FinancialServicesView['recipients'];selectedId:string;busy:boolean;onSelect:(id:string)=>void;onPrepare:(a:ServiceAction)=>void}){
 const contacts=recipients.filter(r=>r.id!=='self'),current=contacts.find(r=>r.id===selectedId)||contacts.find(r=>!recipientReady(r))||contacts[0];
 const [suffix,setSuffix]=useState(''),[ack,setAck]=useState(false);
 useEffect(()=>{setSuffix('');setAck(false);},[current?.id,current?.version]);
 if(!current)return null;
 const ready=recipientReady(current);
 return <details className="mission-card"><summary className="font-bold min-h-11 py-2 cursor-pointer">核对收款人资料 · {contacts.filter(r=>!recipientReady(r)).length}位待核对</summary><p>同名联系人请结合备注和尾号选择。这里只记录对合成资料的用户核对，不代表银行实名验证。</p><label>需要核对的联系人<select className="mission-input" value={current.id} disabled={busy} onChange={e=>onSelect(e.target.value)}>{contacts.map(r=><option key={r.id} value={r.id}>{r.name} · {r.alias} · 尾号{r.suffix} · {recipientReady(r)?'已核对':'待核对'}</option>)}</select></label><article aria-label="收款人核对资料"><strong>{current.name} · {current.alias} · 尾号{current.suffix}</strong><p role="status">{ready?'当前版本已核对（模拟）':'当前资料尚未核对或版本已变化，先核对再准备付款或AA。'}</p>{ready?<button className="mission-secondary" disabled={busy} onClick={()=>onPrepare({kind:'review_recipient',id:current.id,expectedVersion:current.version})}>资料有疑问，重新核对</button>:<><label>输入已核对的合成尾号（4位）<input className="mission-input" inputMode="numeric" maxLength={4} value={suffix} onChange={e=>{setSuffix(e.target.value);setAck(false);}}/></label><label className="flex gap-2 py-2"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>我已核对姓名、备注和尾号，确认是这位合成联系人</label><button className="mission-secondary" disabled={busy||!ack||!/^\d{4}$/.test(suffix)} onClick={()=>onPrepare({kind:'verify_recipient',id:current.id,expectedVersion:current.version,suffix,acknowledged:true})}>核对并保存联系人</button></>}</article></details>;
}
