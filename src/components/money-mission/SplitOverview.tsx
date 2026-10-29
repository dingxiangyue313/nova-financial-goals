import {useState} from 'react';
import type {FinancialServicesView} from '../../../server/financial-services';
import type {ServiceAction} from '../../../shared/financial-services';
import {splitSummary} from '../../../shared/split-report';
import {SplitStatusCard} from './SplitStatusCard';
import {money} from '../../lib/format';
export function SplitOverview({view,source,busy,onPrepare,onQuery}:{view:FinancialServicesView;source:string;busy:boolean;onPrepare:(a:ServiceAction)=>void;onQuery:(id:string)=>void}){
 const [filter,setFilter]=useState('all'),summary=splitSummary(view.splits,view.clock);
 const filtered=view.splits.filter(s=>filter==='all'||filter==='closed'?filter==='all'||s.status==='closed':filter==='overdue'?['open','partial'].includes(s.status)&&s.dueDate<view.clock:s.status===filter);
 return <><section className="mission-card"><h2 className="font-bold">AA待办与对账</h2><p>待收{money(summary.receivableCents)} · 本人应付{money(summary.payableCents)}</p><p>逾期{summary.overdueCount}笔 · 已关闭未结清{money(summary.closedOutstandingCents)}</p><p className="text-xs">待收不计入账户余额；关闭仅停止请求，不代表对方已付款或欠款已豁免。</p><label>筛选AA记录<select className="mission-input" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">全部</option><option value="open">待处理</option><option value="partial">部分结算</option><option value="overdue">逾期</option><option value="collected">已结清</option><option value="closed">已关闭</option></select></label>{!filtered.length&&<p role="status">此状态下没有AA记录。</p>}</section>{filtered.map(s=><SplitStatusCard key={s.id} split={s} view={view} source={source} busy={busy} onPrepare={onPrepare} onQuery={()=>onQuery(s.id)}/>)}</>;
}
