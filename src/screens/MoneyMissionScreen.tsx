import { ProductMissionPanel } from '../components/money-mission/ProductMissionPanel';
import { MissionState } from '../components/money-mission/MissionState';
import type { Snapshot } from '../../shared/contracts';
import type { MoneyMissionReadModel } from '../types';
import type { MissionStage } from '../components/money-mission/MissionStepper';

export function MoneyMissionScreen({loading=false,error=null,onRefresh,onSnapshot}:{
 model:MoneyMissionReadModel|null;loading?:boolean;error?:string|null;compact?:boolean;onRefresh:()=>void;onNavigate:(stage:MissionStage)=>void;onSnapshot?:(snapshot:Snapshot)=>void;
}){
 return <section aria-label="账单与消费" className="w-full p-4 text-[#1F2329]">
   <header className="mb-4"><h1 className="text-xl font-bold">账单与订阅</h1><p className="mt-1 text-xs text-[#5A616B]">查看账单、管理订阅 · 仅使用模拟数据</p></header>
   {error?<MissionState kind="error" message={error} onRetry={onRefresh}/>:<ProductMissionPanel stage="bill" onSnapshot={onSnapshot} onChanged={onRefresh}/>}
   {loading&&<p className="text-xs text-[#5A616B] mt-3" role="status">正在更新账单…</p>}
 </section>;
}
