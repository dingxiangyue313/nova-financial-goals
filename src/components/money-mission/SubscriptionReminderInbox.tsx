import {useEffect,useState} from 'react';
import type {FinancialServices} from '../../../shared/financial-services';
import {api} from '../../api';
type View={items:FinancialServices['subscriptionNotifications'];asOf:string};
export function SubscriptionReminderInbox({twinVersion}:{twinVersion:number}){
 const [view,setView]=useState<View|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function refresh(){setView(await api<View>('/api/services/subscription-reminders'));}
 useEffect(()=>{let live=true;api<View>('/api/services/subscription-reminders').then(v=>live&&setView(v)).catch(e=>live&&setError(e.message));return()=>{live=false;};},[twinVersion]);
 async function choose(id:string,action:'read'|'snooze'){if(!view)return;setBusy(true);setError('');try{setView(await api<View>(`/api/services/subscription-reminders/${encodeURIComponent(id)}`,'POST',{action,...(action==='snooze'?{until:new Date(Date.parse(view.asOf+'T00:00:00Z')+86400000).toISOString().slice(0,10)}:{})}));}catch(e){setError(e instanceof Error?e.message:'提醒暂未更新');}finally{setBusy(false);}}
 return <details className="mission-card"><summary className="font-bold cursor-pointer py-2">续费提醒收件箱</summary><button className="mission-link" onClick={()=>void refresh().catch(e=>setError(e.message))}>刷新提醒</button>{error&&<p role="alert">{error}</p>}
  {!view?.items.length&&<p>暂未安排提醒。先在订阅卡选择“续费前提醒”。</p>}
  {view?.items.map(n=><article className="border-t py-3" key={n.id}><h3 className="font-bold">{n.title} · {({pending:'待提醒',delivered:'待处理',read:'已读',cancelled:'已结束'})[n.status]}</h3><p>计划 {n.dueDate}{n.snoozedUntil?` · 稍后到 ${n.snoozedUntil}`:''}。{n.status==='pending'&&n.dueDate<=view.asOf?'将在暂停/静默条件解除后显示。':''}</p>{n.status!=='read'&&<><button disabled={busy} className="mission-secondary" onClick={()=>void choose(n.id,'read')}>标为已读</button><button disabled={busy} className="mission-secondary" onClick={()=>void choose(n.id,'snooze')}>明天再提醒</button></>}</article>)}
 </details>;
}
