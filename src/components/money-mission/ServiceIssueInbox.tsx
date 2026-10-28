import {useState} from 'react';
import type {FinancialServicesView} from '../../../server/financial-services';
import type {HandoffCasePack} from '../../../shared/contracts';
import {api} from '../../api';
export function ServiceIssueInbox({issues,busy,onQuery}:{issues:FinancialServicesView['issues'];busy:boolean;onQuery:(path:string,body:Record<string,unknown>)=>void}){
 const [pack,setPack]=useState<HandoffCasePack|null>(null),[error,setError]=useState('');
 if(!issues.length)return null;
 async function open(id:string){try{setError('');setPack(await api<HandoffCasePack>(`/api/services/cases/${encodeURIComponent(id)}`));}catch(e){setError(e instanceof Error?e.message:'问题包暂时不可用');}}
 function download(){if(!pack)return;const url=URL.createObjectURL(new Blob([JSON.stringify(pack,null,2)],{type:'application/json'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=`nova-${pack.id}.json`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return <details className="mission-card"><summary className="font-bold cursor-pointer min-h-11 py-2">需要核对的金融事项 · {issues.length}</summary><p>只展示当前未解决的状态。查询原操作不会重新付款或扩大授权。</p>
  {issues.map(issue=><article key={issue.id} className="border-t py-3"><h3 className="font-bold">{issue.title}</h3><p>{issue.summary}</p>
   {issue.recovery!=='review'&&<button className="mission-secondary" disabled={busy} onClick={()=>onQuery(issue.recovery==='query_subscription'?`/api/subscriptions/actions/${issue.sourceId}/status`:'/api/services/reconcile',issue.recovery==='query_subscription'?{}:{id:issue.sourceId})}>查询原处理结果</button>}
   <button className="mission-link" onClick={()=>void open(issue.id)}>查看处理依据与问题包</button>
  </article>)}
  {error&&<p role="alert">{error}</p>}
  {pack&&<section aria-label="人工处理问题包" className="border-t pt-3"><h3 className="font-bold">人工处理问题包</h3><p>{pack.summary}</p>{pack.facts.map((fact,i)=><p key={i}>{fact.label}</p>)}
   <h4 className="font-bold mt-3">已尝试的步骤</h4>{pack.attemptedActions.length?pack.attemptedActions.map(a=><p key={a.actionId}>{a.label} · {a.outcome} · 记录 {a.actionId}</p>):<p>尚无相关提交记录。</p>}
   <h4 className="font-bold mt-3">接下来核对</h4><ol className="list-decimal pl-5">{pack.questions.map(q=><li key={q}>{q}</li>)}</ol>{pack.unknowns.map(q=><p key={q}>{q}</p>)}
   <button className="mission-secondary" onClick={download}>下载模拟问题包 JSON</button><button className="mission-link" onClick={()=>setPack(null)}>收起问题包</button><p className="text-xs text-[#5A616B]">生成和下载仅保存在本地，不会发送给商户或他人。</p>
  </section>}
 </details>;
}
