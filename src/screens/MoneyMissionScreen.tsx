import { ProductMissionPanel } from '../components/money-mission/ProductMissionPanel';
import { useState } from 'react';
import { MissionState } from '../components/money-mission/MissionState';
import type { Snapshot } from '../../shared/contracts';
import type { MoneyMissionReadModel } from '../types';
import type { MissionStage } from '../components/money-mission/MissionStepper';

export function MoneyMissionScreen({loading=false,error=null,onRefresh,onSnapshot}:{
 model:MoneyMissionReadModel|null;loading?:boolean;error?:string|null;compact?:boolean;onRefresh:()=>void;onNavigate:(stage:MissionStage)=>void;onSnapshot?:(snapshot:Snapshot)=>void;
}){
 const [section,setSection]=useState<'overview'|'analysis'|'subscriptions'|'data'>('overview');
 return <section aria-label="账单与消费" className="w-full p-4 text-[#1F2329]">
   <header className="mb-4"><h1 className="text-xl font-bold">账单与订阅</h1></header>
   <nav aria-label="账单功能索引" className="mb-4 grid grid-cols-2 gap-2">{([['overview','账单概览'],['analysis','支出分析'],['subscriptions','订阅管理'],['data','数据管理']] as const).map(([id,label])=><button key={id} type="button" aria-pressed={section===id} onClick={()=>setSection(id)} className={section===id?'mission-primary':'mission-secondary'}>{label}</button>)}</nav>
   {error?<MissionState kind="error" message={error} onRetry={onRefresh}/>:<ProductMissionPanel stage="bill" billSection={section} onSnapshot={onSnapshot} onChanged={onRefresh}/>}
   {loading&&<p className="text-xs text-[#5A616B] mt-3" role="status">正在更新账单…</p>}
 </section>;
}
