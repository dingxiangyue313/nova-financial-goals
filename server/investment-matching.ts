import type {DemoState} from '../shared/contracts.ts';
import {investmentRiskLevel} from '../shared/investment-profile.ts';
export type InvestmentProduct={id:string;name:string;risk:number;lockDays:number;feeBps:number;buyFeeBps:number;navScaled:string;paused:boolean};
export function investmentMatch(state:DemoState,p:InvestmentProduct,amountCents?:number){
 const r=state.financialServices.risk,reasons:string[]=[];
 if(!r)reasons.push('请先填写风险和用钱资料。');
 else{
  if(r.expiresOn<state.clock)reasons.push('风险资料已过期，请重新确认。');
  if(!r.tolerateLoss||r.level===0)reasons.push('当前只适合保持现金，不接受本金损失。');
  if(p.risk>r.level)reasons.push('产品风险超过当前承受范围。');
  const available=new Date(Date.parse(state.clock+'T00:00:00Z')+(p.lockDays+2)*86400000).toISOString().slice(0,10);
  if(available>r.useByDate)reasons.push('持有和结算时间晚于最早用钱日。');
  if(r.answers){
   if(investmentRiskLevel(r.answers)!==r.level)reasons.push('风险资料与问卷不一致，请重新确认。');
   if(r.answers.liquidity==='anytime')reasons.push('需要随时可用的资金应保持现金，赎回存在结算等待。');
   if(r.answers.liquidity==='week'&&p.lockDays+2>7)reasons.push('持有及结算期超出一周流动性要求。');
   if(r.answers.lossToleranceBps<({1:100,2:500,3:1000,4:1500}[p.risk]??1500))reasons.push('压力情景损失超出填写的可承受损失。');
   if(amountCents){const fee=(n:number,bps:number)=>Number((BigInt(n)*BigInt(bps)+9999n)/10000n),stressBps=({1:100,2:500,3:1000,4:1500}[p.risk]??1500);
    const invested=amountCents-fee(amountCents,p.buyFeeBps),gross=Number(BigInt(Math.max(0,invested))*BigInt(10000-stressBps)/10000n),net=Math.max(0,gross-fee(gross,p.feeBps));
    if(BigInt(amountCents-net)*10000n>BigInt(amountCents)*BigInt(r.answers.lossToleranceBps))reasons.push('计入申赎费用后的压力损失超过承受上限。');
   }
  }
 }
 if(p.paused)reasons.push('产品暂停受理。');
 return {suitable:reasons.length===0,reasons};
}
export function compareInvestments(state:DemoState,products:InvestmentProduct[],amountCents:number){
 if(!Number.isSafeInteger(amountCents)||amountCents<=0||amountCents>100000000)throw new Error('SERVICE_INVALID_CENTS');
 const fee=(n:number,bps:number)=>Number((BigInt(n)*BigInt(bps)+9999n)/10000n);
 const rows=products.map(p=>{
  const match=investmentMatch(state,p,amountCents),buyFeeCents=fee(amountCents,p.buyFeeBps),invested=amountCents-buyFeeCents;
  const stressBps=({1:100,2:500,3:1000,4:1500}[p.risk]??1500),optimisticBps=({1:50,2:150,3:300,4:500}[p.risk]??0);
  const net=(bps:number)=>{const gross=Number(BigInt(invested)*BigInt(10000+bps)/10000n);return Math.max(0,gross-fee(gross,p.feeBps));};
  return {id:p.id,name:p.name,risk:p.risk,lockDays:p.lockDays,...match,buyFeeCents,redemptionFeeBps:p.feeBps,
   baselineNetCents:net(0),stressNetCents:net(-stressBps),optimisticNetCents:net(optimisticBps),stressBps,
   settlement:'模拟交易日T+1；未结算资金不可支付。'};
 });
 return {amountCents,asOf:state.clock,sourceVersion:state.twinVersion,profileComplete:Boolean(state.financialServices.risk?.answers),
  cash:{name:'保持现金',availableCents:amountCents,feeCents:0,note:'不申购、不锁定，不增加现有账户余额。'},
  matched:rows.filter(r=>r.suitable).sort((a,b)=>a.risk-b.risk||a.lockDays-b.lockDays||a.buyFeeCents-b.buyFeeCents||a.id.localeCompare(b.id)).slice(0,3),
  excluded:rows.filter(r=>!r.suitable),limitations:['仅模拟规则匹配，不是持牌投资建议。','三种情景为固定假设，不是收益预测或概率；基准假设净值不变。','费用向上取整到分；实际模拟申赎使用整数微份额，可能再有不足一分的取整差异。']};
}
