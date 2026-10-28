import {useEffect,useState} from 'react';
import type {DatedCashflowForecast} from '../../../shared/contracts';
import {amountCents} from '../../../shared/amount';
import {api} from '../../api';
import {money} from '../../lib/format';

const labels:Record<string,string>={income:'收入假设',bill:'已知账单',subscription:'订阅续费',transfer:'已授权转入',purchase:'支出假设'};

export function CashflowTimeline({baseline}:{baseline:DatedCashflowForecast}){
  const [forecast,setForecast]=useState(baseline),[scenario,setScenario]=useState('baseline'),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const tomorrow=new Date(Date.parse(baseline.horizonStart+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  const [date,setDate]=useState(tomorrow),[expense,setExpense]=useState('500');
  useEffect(()=>{setForecast(baseline);setScenario('baseline');setError('');},[baseline.id]);
  async function simulate(kind:'baseline'|'stress'|'edited'){
    setError('');if(kind==='baseline'){setForecast(baseline);setScenario(kind);return;}
    setBusy(true);
    try{
      const cents=kind==='edited'?amountCents(expense):0;
      if(kind==='edited'&&cents<=0)throw new Error('请填写大于零的额外支出');
      const result=await api<DatedCashflowForecast>('/api/product/forecast','POST',{accountId:baseline.accountId,horizonEnd:baseline.horizonEnd,scenario:kind,
        ...(kind==='edited'?{edits:[{type:'add',event:{id:'consumer-what-if-expense',date,label:'用户试算的额外支出',kind:'purchase',amountCents:-cents,currency:'CNY',sourceRefs:['user:what-if-expense']}}]}:{})});
      setForecast(result);setScenario(kind);
    }catch(e){setError(e instanceof Error?e.message:'暂时无法试算，请稍后重试');}finally{setBusy(false);}
  }
  const points=forecast.dailyBalances;
  const values=points.map(p=>p.balanceCents),low=Math.min(0,...values),high=Math.max(1,...values),span=high-low||1;
  const coordinates=points.map((p,i)=>`${12+i*276/Math.max(1,points.length-1)},${112-(p.balanceCents-low)*96/span}`).join(' ');
  const zero=112-(0-low)*96/span;
  return <section className="mission-card min-w-0" aria-label="日期现金流试算">
    <h3 className="font-bold">工资与账单之间，钱够不够用</h3>
    <p>{forecast.horizonStart} 至 {forecast.horizonEnd} · {scenario==='baseline'?'基准假设':scenario==='stress'?'工资延迟三天':'额外支出试算'}</p>
    <p>最低余额 {forecast.minimumBalanceCents===null?'待核对余额':money(forecast.minimumBalanceCents)}{forecast.minimumBalanceDate&&` · ${forecast.minimumBalanceDate}`}</p>
    {forecast.precision!=='exact'&&<p role="status">数据不足或余额不够，当前结果不可用来批准转账。精确计算也不代表收入保证。</p>}
    {!!points.length&&<svg viewBox="0 0 300 132" className="w-full h-36" role="img" aria-label={`按日期计算的余额曲线，最低${forecast.minimumBalanceCents===null?'待核对':money(forecast.minimumBalanceCents)}；下方可查看日期明细`}>
      <line x1="12" x2="288" y1={zero} y2={zero} stroke="#8F959E" strokeDasharray="4 4" />
      <polyline points={coordinates} fill="none" stroke="#0F6B6D" strokeWidth="2.5" />
      <text x="12" y="129" fontSize="9" fill="#5A616B">{forecast.horizonStart}</text><text x="288" y="129" fontSize="9" fill="#5A616B" textAnchor="end">{forecast.horizonEnd}</text>
    </svg>}
    <div className="grid grid-cols-2 gap-2"><button className="mission-secondary" disabled={busy} aria-pressed={scenario==='baseline'} onClick={()=>void simulate('baseline')}>基准假设</button><button className="mission-secondary" disabled={busy} aria-pressed={scenario==='stress'} onClick={()=>void simulate('stress')}>工资晚到三天</button></div>
    <form className="space-y-2 border-t pt-3" onSubmit={e=>{e.preventDefault();void simulate('edited');}}><label>额外支出日期<input className="mission-input" type="date" min={tomorrow} max={baseline.horizonEnd} value={date} onChange={e=>setDate(e.target.value)} /></label><label>额外支出（元）<input className="mission-input" inputMode="decimal" value={expense} onChange={e=>setExpense(e.target.value)} /></label><button className="mission-secondary" disabled={busy}>只试算这笔支出的影响</button></form>
    <p className="text-xs text-[#5A616B]">试算不修改账户、账单、授权或储蓄计划；未来工资不是保证，曲线也不是概率预测。</p>
    {error&&<p role="alert">{error}</p>}
    <details><summary className="min-h-11 py-3 text-[#0F6B6D] cursor-pointer">查看按日期排列的收支与来源</summary><div className="max-h-72 overflow-y-auto">{forecast.events.map(e=><article key={e.id} className="border-t py-2"><strong>{e.date} · {e.label} · {money(e.amountCents)}</strong><p>{labels[e.kind]} · {e.sourceRefs.length} 条计算依据；未来事件以本次假设为准</p></article>)}</div></details>
    <details><summary className="min-h-11 py-3 text-[#0F6B6D] cursor-pointer">查看逐日余额表</summary><div className="max-h-64 overflow-y-auto"><table className="w-full text-left"><caption className="sr-only">当前假设下逐日余额</caption><thead><tr><th scope="col">日期</th><th scope="col">预计余额</th></tr></thead><tbody>{points.map(p=><tr key={p.date}><td className="py-1">{p.date}</td><td>{money(p.balanceCents)}</td></tr>)}</tbody></table></div></details>
    <details><summary className="min-h-11 py-3 cursor-pointer">本次计算的假设与限制</summary>{[...forecast.assumptions,...forecast.limitations].map((text,i)=><p key={i} className="text-xs py-1">{text}</p>)}</details>
  </section>;
}
