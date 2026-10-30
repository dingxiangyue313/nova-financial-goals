import {EvidenceLink} from './EvidenceLink';
import {useEffect,useState} from 'react';
import type {TravelTask,TravelProof} from '../../../shared/travel-task';
import {api} from '../../api';
export function TravelTaskPanel({goalId,twinVersion}:{goalId:string;twinVersion:number}){
 const [task,setTask]=useState<TravelTask|null>(null),[error,setError]=useState('');
 useEffect(()=>{let live=true;if(!goalId)return;api<TravelTask>(`/api/services/tasks/${encodeURIComponent(goalId)}`).then(t=>{if(live){setTask(t);setError('');}}).catch(e=>live&&setError(e.message));return()=>{live=false;};},[goalId,twinVersion]);
 async function download(){try{const proof=await api<TravelProof>(`/api/services/tasks/${encodeURIComponent(goalId)}/proof`),url=URL.createObjectURL(new Blob([JSON.stringify(proof,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='nova-travel-task-proof.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setError(e instanceof Error?e.message:'暂时无法下载证明包');}}
 return <details className="mission-card"><summary className="font-bold cursor-pointer py-2">旅行任务步骤与证明</summary>{error&&<p role="alert">{error}</p>}{task&&<>
  <h2 className="font-bold">{task.goalTitle} · {({planning:'准备中',needs_attention:'需要处理',booked:'预订已确认',refund_pending:'退款在途'})[task.status]}</h2><p>目标覆盖 ¥{task.coverageCents/100} / ¥{task.targetCents/100} · 数据截至 {task.asOf}</p>
  {task.progress&&<section aria-label="四种目标进度"><p>资金准备：¥{task.progress.cashCents/100} · 预留：¥{task.progress.heldCents/100}</p><p>有效已付订单：¥{task.progress.effectiveOrderCents/100} · 有履约证据：¥{task.progress.fulfilledCents/100}</p><p>钱已备齐：{task.progress.prepared?'是':'否'} · 支付检查：{task.progress.paid?'已通过':'未完成'} · 履约检查：{task.progress.fulfilled?'已通过':'待证据'} · 任务完成：{task.progress.taskComplete?'是（模拟证据）':'否'}</p><p>任务版本{task.schemaVersion} · 检查点修订{task.checkpointRevision??0}</p></section>}<ol className="space-y-3 my-3">{task.nodes.map(node=><li key={node.id} className="border-t pt-2"><h3 className="font-bold">{node.label} · {({complete:'已核对',pending:'待准备',blocked:'需先处理',unknown:'结果待核对',needs_recovery:'需要恢复'})[node.status]}</h3><p>{node.detail}</p><details><summary className="mission-link min-h-11 py-2">核对本步骤来源</summary>{node.sourceRefs.map(id=><EvidenceLink key={id} id={id}/>)}</details></li>)}</ol>
  {task.limitations.map(l=><p className="text-xs text-[#5A616B]" key={l}>{l}</p>)}<button className="mission-secondary" onClick={()=>void download()}>下载旅行任务证明包</button>
 </>}</details>;
}
