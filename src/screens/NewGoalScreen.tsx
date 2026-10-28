import {useState} from 'react';
import type {Snapshot} from '../../shared/contracts';
import {amountCents} from '../../shared/amount';
import {api} from '../api';
import {ProductMissionPanel} from '../components/money-mission/ProductMissionPanel';

export function NewGoalScreen({snapshot,onSnapshot,onDone}:{snapshot:Snapshot;onSnapshot:(s:Snapshot)=>void;onDone:()=>void}){
 const [phase,setPhase]=useState<'draft'|'plans'>('draft'),[title,setTitle]=useState(''),[amount,setAmount]=useState('8000'),[date,setDate]=useState(snapshot.goal.targetDate),[reserve,setReserve]=useState(String(snapshot.finance.emergencyCents/100)),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function create(){
   setError('');setBusy(true);
   try{
     const next=await api<Snapshot>('/api/product/goals','POST',{title:title.trim(),targetCents:amountCents(amount),targetDate:date,protectedCents:amountCents(reserve),expectedTwinVersion:snapshot.twinVersion});
     onSnapshot(next);setPhase('plans');
   }catch(e){const message=e instanceof Error?e.message:'暂时无法创建目标';setError(message==='TWIN_VERSION_CHANGED'?'数据已更新，请返回首页刷新后再创建。':message==='GOAL_DATE_MUST_BE_FUTURE'?'请选择模拟今日之后的目标日期。':message);}finally{setBusy(false);}
 }
 return <section className="p-4 space-y-4 text-[13px] leading-relaxed">
   <header><h1 className="text-xl font-bold">{phase==='draft'?'新建目标':'选择适合你的存钱节奏'}</h1><p className="mt-2 text-[#5A616B]">{phase==='draft'?'想完成什么、什么时候用钱，先把目标说清楚。':'根据已核对的余额、工资与账单比较方案。选择前可以查看准确条件。'}</p></header>
   {error&&<p role="alert" className="rounded-xl bg-amber-50 p-3 text-amber-900">{error}</p>}
   {phase==='draft'?<form className="mission-card space-y-4" onSubmit={e=>{e.preventDefault();void create();}}>
    <label className="block">目标名称<input required maxLength={60} className="mission-input" value={title} onChange={e=>setTitle(e.target.value)} placeholder="例如：日本旅行、进修培训" /></label>
    <label className="block">需要准备多少钱（元）<input required inputMode="decimal" className="mission-input" value={amount} onChange={e=>setAmount(e.target.value)} /></label>
    <label className="block">什么时候用钱<input required type="date" min={new Date(Date.parse(snapshot.clock+'T00:00:00Z')+86400000).toISOString().slice(0,10)} className="mission-input" value={date} onChange={e=>setDate(e.target.value)} /></label>
    <label className="block">希望保留的应急金（元）<input required inputMode="decimal" className="mission-input" value={reserve} onChange={e=>setReserve(e.target.value)} /></label>
    <p className="text-xs text-[#5A616B]">这里填写保护底线，不会增加或挪动现有应急金。已有目标、旅行钱包和银行余额保持原值。</p>
    <button className="mission-primary" disabled={busy||!title.trim()}>{busy?'正在计算…':'下一步：比较目标方案'}</button>
   </form>:<>
    <ProductMissionPanel stage="plan" allowSchedule={false} onSnapshot={onSnapshot} onChanged={()=>{}} />
    <button className="mission-primary" onClick={onDone}>{snapshot.goal.status==='active'?'完成，返回首页':'稍后选方案，返回首页'}</button>
   </>}
 </section>;
}
