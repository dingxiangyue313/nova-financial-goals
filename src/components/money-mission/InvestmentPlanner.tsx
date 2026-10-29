import {useEffect,useState} from 'react';
import type {FinancialServicesView} from '../../../server/financial-services';
import type {compareInvestments} from '../../../server/investment-matching';
import type {InvestmentAnswers} from '../../../shared/investment-profile';
import type {ServiceAction} from '../../../shared/financial-services';
import {amountCents} from '../../../shared/amount';
import {api} from '../../api';
const money=(n:number)=>`¥${(n/100).toLocaleString('zh-CN')}`;
export function InvestmentPlanner({view,busy,amount,onAmount,onPrepare,onCash}:{view:FinancialServicesView;busy:boolean;amount:string;onAmount:(s:string)=>void;onPrepare:(a:ServiceAction)=>void;onCash:()=>void}){
 const [purpose,setPurpose]=useState(''),[date,setDate]=useState(''),[loss,setLoss]=useState(''),[liquidity,setLiquidity]=useState(''),[experience,setExperience]=useState(''),[income,setIncome]=useState(''),[understands,setUnderstands]=useState(false);
 const [comparison,setComparison]=useState<ReturnType<typeof compareInvestments>|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 useEffect(()=>{setComparison(null);},[view.twinVersion,amount]);
 const complete=purpose&&date&&loss!==''&&liquidity&&experience&&income;
 async function compare(){setLoading(true);setError('');try{setComparison(await api('/api/services/investments/compare','POST',{amountCents:amountCents(amount)}));}catch(e){setError(e instanceof Error?e.message:'无法比较，请稍后重试。');}finally{setLoading(false);}}
 function submit(){if(!complete)return;onPrepare({kind:'investment_questionnaire',answers:{purpose:purpose as InvestmentAnswers['purpose'],useByDate:date,lossToleranceBps:Number(loss) as InvestmentAnswers['lossToleranceBps'],liquidity:liquidity as InvestmentAnswers['liquidity'],experience:experience as InvestmentAnswers['experience'],incomeStability:income as InvestmentAnswers['incomeStability'],understandsRisk:understands}});}
 const question=(label:string,value:string,set:(v:string)=>void,options:Array<[string,string]>)=><label className="block">{label}<select aria-label={label} required className="mission-input" value={value} onChange={e=>set(e.target.value)}><option value="">请选择</option>{options.map(([id,text])=><option value={id} key={id}>{text}</option>)}</select></label>;
 return <>
  <form className="mission-card space-y-2" aria-label="理财风险问卷" onSubmit={e=>{e.preventDefault();submit();}}><h2 className="font-bold">风险与用钱时间</h2><p>填写实际可接受的条件。未完成只浏览；不接受损失或应急备用资金可选择仅现金。</p>
   {view.risk&&<p role="status">已确认资料：{view.risk.level===0?'仅现金':`最高R${view.risk.level}`} · 最早用钱 {view.risk.useByDate} · 有效至 {view.risk.expiresOn}。{!view.risk.answers?'这是历史简版资料，建议补齐问卷。':''}</p>}
   {question('这笔资金的用途',purpose,setPurpose,[['travel','旅行'],['education','教育培训'],['reserve','应急备用'],['longterm','长期计划']])}
   <label className="block">最早用钱日期<input required type="date" min={new Date(Date.parse(view.clock+'T00:00:00Z')+86400000).toISOString().slice(0,10)} className="mission-input" value={date} onChange={e=>setDate(e.target.value)}/></label>
   {question('可承受的本金损失',loss,setLoss,[['0','不接受本金损失'],['100','最多1%'],['500','最多5%'],['1500','最多15%']])}
   {question('资金需要多快可用',liquidity,setLiquidity,[['anytime','随时可用'],['week','一周内'],['quarter','可持有较长时间']])}
   {question('投资经验',experience,setExperience,[['none','没有经验'],['basic','了解基础申购与赎回'],['experienced','有多次投资经验']])}
   {question('收入稳定程度',income,setIncome,[['irregular','不规律或不确定'],['stable','相对稳定']])}
   <label className="flex gap-2"><input type="checkbox" checked={understands} onChange={e=>setUnderstands(e.target.checked)}/>我理解这些模拟产品非保本，赎回和结算前资金不能支付。</label>
   <button className="mission-primary" disabled={busy||!complete}>核对完整风险资料</button><button type="button" className="mission-secondary" onClick={onCash}>保持现金</button>
  </form>
  <section className="mission-card"><h2 className="font-bold">比较产品与保持现金</h2><label>申购总额（元，内含费用）<input inputMode="decimal" className="mission-input" value={amount} onChange={e=>onAmount(e.target.value)}/></label><button className="mission-secondary" disabled={busy||loading} onClick={()=>void compare()}>{loading?'正在按规则比较…':'比较费用、流动性与压力情景'}</button>{error&&<p role="alert">{error}</p>}
   {comparison&&<><article className="border-t py-3"><h3 className="font-bold">保持现金</h3><p>金额 {money(comparison.amountCents)} · 申赎费 ¥0 · 不锁定。{comparison.cash.note}</p></article>
    {!comparison.matched.length&&<p role="status">当前没有匹配的产品，可以保持现金或重新核对资料。</p>}
    {comparison.matched.map(p=><article className="border-t py-3" key={p.id}><h3 className="font-bold">{p.name}</h3><p>R{p.risk} · 最低持有 {p.lockDays} 天 · 申购费 {money(p.buyFeeCents)} · 赎回费率 {p.redemptionFeeBps/100}%</p><p>净值不变情景净额 {money(p.baselineNetCents)}；压力情景（净值下降{p.stressBps/100}%）净额 {money(p.stressNetCents)}；乐观情景净额 {money(p.optimisticNetCents)}。</p><p>{p.settlement}</p><button className="mission-secondary" disabled={busy} onClick={()=>onPrepare({kind:'buy',productId:p.id,accountId:'checking',amountCents:comparison.amountCents})}>预览申购{p.name}</button></article>)}
    <details><summary className="font-bold">未匹配的产品与原因</summary>{comparison.excluded.map(p=><p key={p.id}>{p.name}：{p.reasons.join(' ')}</p>)}</details>{comparison.limitations.map(l=><p className="text-xs text-[#5A616B]" key={l}>{l}</p>)}
   </>}
  </section>
 </>;
}
