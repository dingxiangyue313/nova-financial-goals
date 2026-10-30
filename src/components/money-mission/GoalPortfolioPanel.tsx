import {EvidenceLink} from './EvidenceLink';
import {useEffect,useState} from 'react';
import type {GoalContract} from '../../../shared/contracts';
import type {ServiceAction} from '../../../shared/financial-services';
import type {buildGoalPortfolio} from '../../../server/goal-portfolio';
import {amountCents} from '../../../shared/amount';
import {api} from '../../api';
type Portfolio=ReturnType<typeof buildGoalPortfolio>;
const money=(n:number)=>`¥${(n/100).toLocaleString('zh-CN')}`;
function ContractEditor({contract,busy,onPrepare,onCancel}:{contract:GoalContract;busy:boolean;onPrepare:(input:ServiceAction)=>void;onCancel:()=>void}){
 const [title,setTitle]=useState(contract.title),[amount,setAmount]=useState(String(contract.targetCents/100)),[date,setDate]=useState(contract.targetDate);
 const [monthly,setMonthly]=useState(String(contract.monthlyContributionCents/100)),[protectedAmount,setProtected]=useState(String(contract.protectedCents/100));
 const [priority,setPriority]=useState(contract.priority),[extra,setExtra]=useState(String(contract.maxMonthlyIncreaseCents/100)),[extension,setExtension]=useState(String(contract.maxExtensionDays)),[payments,setPayments]=useState(contract.allowPayments),[error,setError]=useState('');
 function submit(){try{setError('');const days=Number(extension);if(!/^\d+$/.test(extension)||days>365)throw new Error('允许延期天数需为0至365的整数。');onPrepare({kind:'goal_contract',goalId:contract.goalId,expectedRevision:contract.revision,title,targetCents:amountCents(amount),targetDate:date,monthlyContributionCents:amountCents(monthly),protectedCents:amountCents(protectedAmount),priority,maxMonthlyIncreaseCents:amountCents(extra),maxExtensionDays:days,allowPayments:payments});}catch(e){setError(e instanceof Error?e.message:'请核对填写内容。');}}
 return <form aria-label="编辑目标约束" className="border-t mt-3 pt-3 space-y-2" onSubmit={e=>{e.preventDefault();submit();}}>
  <label className="block">目标用途<input required maxLength={60} className="mission-input" value={title} onChange={e=>setTitle(e.target.value)}/></label>
  <label className="block">目标金额（元）<input required inputMode="decimal" className="mission-input" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
  <label className="block">目标日期<input required type="date" className="mission-input" value={date} onChange={e=>setDate(e.target.value)}/></label>
  <label className="block">当前每月投入（元）<input required inputMode="decimal" className="mission-input" value={monthly} onChange={e=>setMonthly(e.target.value)}/></label>
  <label className="block">共同保护底线（元）<input required inputMode="decimal" className="mission-input" value={protectedAmount} onChange={e=>setProtected(e.target.value)}/></label>
  <label className="block">目标优先级<select aria-label="目标优先级" className="mission-input" value={priority} onChange={e=>setPriority(Number(e.target.value))}>{[1,2,3,4,5].map(p=><option key={p} value={p}>{p} · {p===1?'最高':p===5?'最低':'普通'}</option>)}</select></label>
  <label className="block">允许每月额外增加（元）<input required inputMode="decimal" className="mission-input" value={extra} onChange={e=>setExtra(e.target.value)}/></label>
  <label className="block">允许最多延期（天）<input required inputMode="numeric" className="mission-input" value={extension} onChange={e=>setExtension(e.target.value)}/></label>
  <label className="flex gap-2"><input type="checkbox" checked={payments} onChange={e=>setPayments(e.target.checked)}/>允许此目标在单独确认后进行付款</label>
  <p className="text-xs text-[#5A616B]">保护账户仍不可支出。这里只设置可接受的调整范围；每个调整仍需确认。修改后关联转账计划会暂停，原付款授权金额不变。</p>
  {error&&<p role="alert">{error}</p>}<button className="mission-primary" disabled={busy}>预览目标约束修改</button><button type="button" className="mission-link" onClick={onCancel}>收起编辑</button>
 </form>;
}
export function GoalPortfolioPanel({twinVersion,busy,onPrepare}:{twinVersion:number;busy:boolean;onPrepare:(input:ServiceAction)=>void}){
 const [portfolio,setPortfolio]=useState<Portfolio|null>(null),[editing,setEditing]=useState<string|null>(null),[error,setError]=useState('');
 useEffect(()=>{let live=true;api<Portfolio>('/api/services/portfolio').then(value=>{if(live){setPortfolio(value);setError('');}}).catch(e=>live&&setError(e.message));return()=>{live=false;};},[twinVersion]);
 if(error)return <p role="alert">目标试算暂未完成：{error}</p>;
 if(!portfolio)return <p role="status">正在核对多个目标共用的现金流…</p>;
 return <section aria-label="多目标约束与调整" className="space-y-3">
  <div className="mission-card"><h2 className="font-bold">把目标放在同一张资金计划里</h2><p>{portfolio.status==='on_track'?'按当前模拟假设，各目标的投入可以同时满足。':portfolio.status==='insufficient_data'?'数据或预测范围不足，暂不提供可确认调整。':'目标之间需要协调投入或日期。'}</p>
   <p>预测到 {portfolio.horizonEnd}。共同保护与已占用资金 {money(portfolio.reservedCents)}。</p>
   {portfolio.eligible&&<p>当前投入下的最低余额 {money(portfolio.current.minimumBalanceCents)}，出现在 {portfolio.current.minimumBalanceDate}；与保护底线相差 {money(portfolio.current.shortfallCents)}。</p>}
   {portfolio.current.unfulfilled.map(g=><p key={g.goalId}>{g.title}：到 {g.targetDate} 仍需准备 {money(g.remainingCents)}。</p>)}
  </div>
  {portfolio.goals.map(goal=><article className="mission-card" key={goal.goalId}><h3 className="font-bold">{goal.title} · 优先级 {goal.contract.priority}</h3><p>已准备 {money(goal.coveredCents)} / {money(goal.contract.targetCents)}；每月投入 {money(goal.contract.monthlyContributionCents)}。</p><p>目标日 {goal.contract.targetDate}；{goal.projectedDate?`按假设预计 ${goal.projectedDate} 准备完毕`:'当前节奏尚不能在试算范围内备齐'}。</p><button className="mission-secondary" onClick={()=>setEditing(goal.goalId)}>编辑「{goal.title}」目标约束</button>
    {editing===goal.goalId&&<ContractEditor key={`${goal.goalId}:${goal.contract.revision}`} contract={goal.contract} busy={busy} onPrepare={onPrepare} onCancel={()=>setEditing(null)}/>}
  </article>)}
  {portfolio.options.map(option=><article className="mission-card" key={option.id}><h3 className="font-bold">{option.label}</h3>{option.changes.map(c=><p key={c.goalId}>{c.title}：每月 {money(c.beforeMonthlyCents)} → {money(c.monthlyCents)}；{c.beforeDate} → {c.targetDate}。</p>)}<p>调整后预测最低余额 {money(option.minimumBalanceCents)}（{option.minimumBalanceDate}）。</p><button className="mission-primary" disabled={busy} onClick={()=>onPrepare({kind:'portfolio_repair',optionId:option.id,expectedTwinVersion:portfolio.twinVersion})}>核对这个调整</button></article>)}
  {portfolio.status==='needs_adjustment'&&!portfolio.options.length&&<p role="status" className="mission-card">在当前允许的加存和延期范围内，没有可确认的共同方案。可先编辑约束，或核对数据缺口；不会自动牺牲其他目标。</p>}
  <details className="mission-card"><summary className="font-bold">试算依据与限制</summary>{portfolio.assumptions.map(text=><p key={text}>{text}</p>)}<p>本页只解释资金准备，不表示服务已经实际履约。</p>{portfolio.sourceRefs.map(ref=><EvidenceLink id={ref} key={ref} label="核对预测与来源"/>)}</details>
 </section>;
}
