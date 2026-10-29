import {recipientReady} from '../shared/recipient-identity.ts';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {serviceIssues} from './service-monitor.ts';
import { ServiceActionSchema } from '../shared/financial-services.ts';
import type { DemoState } from '../shared/contracts.ts';
import { appendAuditEvent, stableHash } from './governance.ts';
import { buildDatedCashflowForecast } from './cashflow-forecast.ts';
import {buildGoalPortfolio,goalContract,changedGoalContract,applyGoalContract,portfolioRepairTerms} from './goal-portfolio.ts';
import {GoalContractSchema} from '../shared/goal-contract.ts';
import {protectedCheckingReserve} from './financial-constraints.ts';
import {investmentRiskLevel} from '../shared/investment-profile.ts';
import {investmentMatch} from './investment-matching.ts';

export const investmentProducts = [
  { id: 'liquid', name: '零钱周转（模拟）', risk: 1, lockDays: 0, feeBps: 0, buyFeeBps: 0, navScaled: '100000000', paused: false },
  { id: 'steady', name: '短期稳健（模拟）', risk: 2, lockDays: 7, feeBps: 20, buyFeeBps: 20, navScaled: '100000000', paused: false },
  { id: 'term90', name: '90天计划（模拟）', risk: 2, lockDays: 90, feeBps: 0, buyFeeBps: 10, navScaled: '100000000', paused: false },
  { id: 'growth', name: '成长组合（模拟）', risk: 3, lockDays: 30, feeBps: 50, buyFeeBps: 30, navScaled: '103750000', paused: false },
  { id: 'volatile', name: '高波动探索（模拟）', risk: 4, lockDays: 0, feeBps: 80, buyFeeBps: 50, navScaled: '92750000', paused: false },
  { id: 'paused', name: '暂停受理（模拟）', risk: 2, lockDays: 7, feeBps: 20, buyFeeBps: 20, navScaled: '100000000', paused: true },
];
const key = process.env.NOVA_EXTERNAL_AGENT_SECRET || process.env.NOVA_SESSION_SECRET || randomUUID();
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
export function nextTradingDay(date: string) { let next = shift(date, 1); while ([0, 6].includes(new Date(`${next}T00:00:00Z`).getUTCDay())) next = shift(next, 1); return next; }
const integer = (n: number) => { if (!Number.isSafeInteger(n)) throw new Error('SERVICE_INVALID_CENTS'); return n; };
const fee = (amount: number, bps: number) => Number((BigInt(amount) * BigInt(bps) + 9999n) / 10000n);
const valuation = (quantity: string, nav: string) => integer(Number(BigInt(quantity) * BigInt(nav) / 1000000000000n));
const product = (id: string) => { const p = investmentProducts.find(p => p.id === id); if (!p) throw new Error('SERVICE_PRODUCT_NOT_FOUND'); return p; };
const account = (s: DemoState, id: string) => { const a = s.accounts.find(a => a.id === id); if (!a || a.protected || !['checking','goal'].includes(a.type) || a.currency !== 'CNY') throw new Error('SERVICE_PROTECTED_ACCOUNT'); return a; };
const walletOwner=(s:DemoState)=>s.financialServices.allocations.find(a=>a.accountId==='goal-wallet')?.goalId??s.goal.id;

export function initializeServices(input: DemoState): DemoState {
  const s = structuredClone(input), d = s.financialServices;
  if (d.initialized) return s;
  d.initialized = true;
  d.recipients = [{ id: 'self', name: '我', phone: '', alias: '本人', suffix: '自己', version: 1 }, ...Array.from({ length: 20 }, (_, i) => ({ id: `contact-${i+1}`, name: ['小林','小陈','小王','小林','Alex'][i%5], phone: `1990000${1001+i}`, alias: `${i%2 ? '同行朋友' : '同事'} ${i+1}`, suffix: String(1001+i), version: 1,identityStatus:(i%5===3?'needs_review':'verified') as 'needs_review'|'verified',...(i%5===3?{}:{verifiedVersion:1}) }))];
  d.cards = [{ id:'card-main',label:'日常借记卡',suffix:'1001',type:'debit',accountId:'checking',status:'active',online:true,overseas:false,limitCents:500000,version:1 },{ id:'card-travel',label:'旅行借记卡',suffix:'2002',type:'debit',accountId:'goal-wallet',status:'active',online:false,overseas:false,limitCents:500000,version:1 },{ id:'card-credit',label:'日常信用卡',suffix:'3003',type:'credit',accountId:'checking',status:'active',online:true,overseas:false,limitCents:1000000,version:1 }];
  const wallet = s.accounts.find(a => a.id === 'goal-wallet');
  if (wallet) d.allocations.push({ goalId:s.goal.id,accountId:wallet.id,amountCents:wallet.balanceCents });
  for (const a of s.accounts) journal(s, a.id, a.balanceCents, 'opening', `opening:${a.id}`, '权威期初余额');
  return s;
}
function journal(s: DemoState, accountId: string, delta: number, operationId: string, eventId: string, reason: string) {
  s.financialServices.journals.push({id:randomUUID(),eventId,operationId,accountId,amountCents:delta,date:s.clock,reason},{id:randomUUID(),eventId,operationId,accountId:`external:${reason}`,amountCents:-delta,date:s.clock,reason});
}
export function availableFunds(s: DemoState, id: string, goalId: string | null = null) {
  const a=account(s,id),d=s.financialServices,h=d.holds.filter(h=>h.accountId===id&&h.status==='active');
  const held=h.reduce((n,h)=>n+h.amountCents,0);
  const other=d.allocations.filter(x=>x.accountId===id&&x.goalId!==goalId).reduce((n,x)=>n+Math.max(0,x.amountCents-h.filter(h=>h.goalId===x.goalId).reduce((n,h)=>n+h.amountCents,0)),0);
  const reserveFromChecking=protectedCheckingReserve(s);
  return Math.max(0,a.balanceCents-held-other-(a.type==='checking'?reserveFromChecking:0));
}
function requireFunds(s: DemoState,id:string,amount:number,goalId:string|null=null) {
  const a=account(s,id); if(a.type==='goal'&&walletOwner(s)!==goalId)throw new Error('SERVICE_GOAL_FUNDS_PROTECTED');
  const available=spendableFunds(s,id,goalId);
  if(available===null)throw new Error('SERVICE_BALANCE_STALE');
  if(!Number.isSafeInteger(amount)||amount<0||available<amount)throw new Error('SERVICE_INSUFFICIENT_AVAILABLE_FUNDS');
}
/** Same conservative amount for consumer previews and execution gates. */
function spendableFunds(s:DemoState,id:string,goalId:string|null=null):number|null{
  const a=account(s,id);
  const latest=s.accountSnapshots.filter(x=>x.accountId===id&&x.asOf<=s.clock).sort((a,b)=>b.asOf.localeCompare(a.asOf)||b.twinVersion-a.twinVersion||b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id))[0];
  if(!latest||latest.asOf!==s.clock||latest.balanceCents!==a.balanceCents||latest.currency!==a.currency||latest.twinVersion>s.twinVersion)return null;
  let available=availableFunds(s,id,goalId);
  if(a.type==='checking'){
    const f=buildDatedCashflowForecast(s,{accountId:id,horizonEnd:shift(s.clock,32),scenario:'baseline'});
    if(f.precision!=='exact'||f.minimumBalanceCents===null)return null;
    available=Math.min(available,Math.max(0,f.minimumBalanceCents-(a.balanceCents-available)));
  }
  return available;
}
function post(s:DemoState,id:string,delta:number,op:string,eventId:string,reason:string,goalId:string|null=null,settlingReserved=false){
  const d=s.financialServices;if(d.events.includes(eventId))return;const a=account(s,id);
  if(delta<0){if(settlingReserved){if(a.balanceCents < -delta)throw new Error('SERVICE_RESERVED_FUNDS_MISSING');}else requireFunds(s,id,-delta,goalId);}a.balanceCents=integer(a.balanceCents+delta);
  if(id==='checking'){s.finance.checkingCents=a.balanceCents;s.finance.updatedAt=s.clock;}
  if(id==='goal-wallet'){const owner=walletOwner(s);s.goals=s.goals.map(g=>g.id===owner?{...g,savedCents:a.balanceCents}:g);if(s.goal.id===owner)s.goal={...s.goal,savedCents:a.balanceCents};}
  if(goalId&&delta<0)d.allocations=d.allocations.map(x=>x.accountId===id&&x.goalId===goalId?{...x,amountCents:Math.max(0,x.amountCents+delta)}:x);
  s.accountSnapshots.push({id:randomUUID(),accountId:id,balanceCents:a.balanceCents,currency:'CNY',asOf:s.clock,sourceKind:'simulated_connection',sourceId:`service:${eventId}`,twinVersion:s.twinVersion+1,createdAt:`${s.clock}T12:00:00+08:00`});
  d.events.push(eventId);journal(s,id,delta,op,eventId,reason);
  s.transactions.push({id:`service:${eventId}`,accountId:id,date:s.clock,title:reason,category:delta>0?'transfer':'service_payment',amountCents:delta,sourceKind:'bank',provenance:'connected_data'});
}
const sign=(value:unknown)=>createHmac('sha256',key).update(stableHash(value)).digest('hex');
function verifyQuote(q:DemoState['financialServices']['quotes'][number],now:number){const {signature,...fields}=q,expected=sign(fields);if(signature.length!==expected.length||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))throw new Error('SERVICE_INVALID_SIGNATURE');if(Date.parse(q.expiresAt)<=now)throw new Error('SERVICE_QUOTE_EXPIRED');if(q.totalCents!==q.baseCents+q.taxCents+q.feeCents)throw new Error('SERVICE_QUOTE_CHANGED');}
export function requestTravelQuotes(input:DemoState,now=Date.now()){
  const s=initializeServices(input),prefix=randomUUID();
  const values=[{id:`${prefix}:flight`,merchantId:'air-demo',label:'樱旅航空 · 往返机票',kind:'flight' as const,baseCents:240000,taxCents:38000,feeCents:2000,totalCents:280000,refundable:true},{id:`${prefix}:hotel`,merchantId:'stay-demo',label:'京都旅宿 · 三晚住宿',kind:'hotel' as const,baseCents:200000,taxCents:18000,feeCents:2000,totalCents:220000,refundable:true}];
  const quotes=values.map(v=>{const fields={...v,expiresAt:new Date(now+900000).toISOString()};return {...fields,signature:sign(fields)};});
  s.financialServices.quotes=[...s.financialServices.quotes.filter(q=>Date.parse(q.expiresAt)>now).slice(-18),...quotes];return s;
}

export function describeServiceAction(input:DemoState,raw:unknown,now=Date.now()){
  const state=initializeServices(input),action=ServiceActionSchema.parse(raw),d=state.financialServices;
  let label='',amountCents=0;let details:Record<string,unknown>={};
  switch(action.kind){
    case 'verify_recipient':case 'review_recipient':{const r=d.recipients.find(r=>r.id===action.id&&r.id!=='self');if(!r||r.version!==action.expectedVersion)throw new Error('SERVICE_RECIPIENT_CHANGED');if(action.kind==='verify_recipient'&&r.suffix!==action.suffix)throw new Error('SERVICE_RECIPIENT_SUFFIX_MISMATCH');details={recipientId:r.id,recipientVersion:r.version};label=action.kind==='verify_recipient'?`核对合成联系人${r.name}（${r.alias}，尾号${r.suffix}），仅保存本版本的用户核对记录；不是银行实名验证，不会转账或创建AA。`:`将${r.name}（${r.alias}，尾号${r.suffix}）标记为需重新核对；新转账与AA将暂停准备，既有付款结果仍按原操作查询。`;break;}

    case 'investment_questionnaire':{
      if(action.answers.useByDate<=state.clock)throw new Error('SERVICE_USE_DATE_PASSED');
      const level=investmentRiskLevel(action.answers);details={level,answers:action.answers,expiresOn:shift(state.clock,180)};
      label=`保存模拟理财问卷：用途${({travel:'旅行',education:'教育培训',reserve:'应急备用',longterm:'长期计划'})[action.answers.purpose]}，最早用钱日${action.answers.useByDate}，最多承受${action.answers.lossToleranceBps/100}%本金损失，流动性${({anytime:'随时可用',week:'一周内',quarter:'可持有较长时间'})[action.answers.liquidity]}，经验${({none:'无经验',basic:'基础',experienced:'较丰富'})[action.answers.experience]}，收入${action.answers.incomeStability==='stable'?'稳定':'不规律'}。规则匹配${level===0?'仅现金':`最高R${level}`}，有效至${shift(state.clock,180)}。本次不申购、不转账；后续操作需单独确认。`;break;
    }
    case 'goal_contract':{
      const old=state.goals.find(g=>g.id===action.goalId);if(!old)throw new Error('SERVICE_GOAL_NOT_FOUND');
      const before=goalContract(state,old);if(before.revision!==action.expectedRevision)throw new Error('GOAL_CONTRACT_CHANGED');
      const {kind:_kind,expectedRevision:_revision,...terms}=action;
      const after=changedGoalContract(state,terms);details={before,after};
      label=`修改「${old.title}」目标约束：金额¥${before.targetCents/100}→¥${after.targetCents/100}，日期${before.targetDate}→${after.targetDate}，每月投入¥${before.monthlyContributionCents/100}→¥${after.monthlyContributionCents/100}，保护底线¥${after.protectedCents/100}，优先级${after.priority}（1最高）。最多允许月存增加¥${after.maxMonthlyIncreaseCents/100}、延期${after.maxExtensionDays}天。${after.allowPayments?'允许在独立确认后付款':'暂停此目标的新付款'}。本次不移动资金、不扩大原付款授权；关联转账计划暂停，需重新核对启用。`;break;
    }
    case 'portfolio_repair':{
      if(action.expectedTwinVersion!==state.twinVersion)throw new Error('TWIN_VERSION_CHANGED');
      const option=buildGoalPortfolio(state).options.find(o=>o.id===action.optionId);if(!option)throw new Error('PORTFOLIO_OPTION_STALE');
      for(const change of option.changes)changedGoalContract(state,portfolioRepairTerms(state,change));
      details={option,changes:option.changes};label=`采用「${option.label}」，调整${option.changedGoals}个目标。日期试算最低余额¥${option.minimumBalanceCents/100}（${option.minimumBalanceDate}）。只修改下列目标约束并暂停关联转账计划；没有转账、申购或新增付款授权，未来工资与预测不是保证。`;break;
    }
    case 'transfer':{const r=d.recipients.find(r=>r.id===action.recipientId&&r.id!=='self');if(!r||r.version!==action.recipientVersion)throw new Error('SERVICE_RECIPIENT_CHANGED');if(!recipientReady(r))throw new Error('SERVICE_RECIPIENT_REVIEW_REQUIRED');requireFunds(state,action.accountId,action.amountCents);amountCents=action.amountCents;details={recipient:r,feesCents:0};label=`向${r.name}（尾号${r.suffix}，${r.alias}）转入¥${amountCents/100}，手续费¥0。备注只作说明。`;break;}
    case 'split':{
      const ids=action.participantIds,payerId=action.payerId??'self';
      if(new Set(ids).size!==ids.length||!ids.includes('self')||!ids.includes(payerId)||ids.some(id=>!d.recipients.some(r=>r.id===id)))throw new Error('SERVICE_INVALID_SPLIT');
      if(ids.some(id=>!recipientReady(d.recipients.find(r=>r.id===id)!)))throw new Error('SERVICE_RECIPIENT_REVIEW_REQUIRED');
      if(action.dueDate<state.clock)throw new Error('SERVICE_SPLIT_DATE_PASSED');
      if(payerId!=='self'&&!action.alreadyPaid)throw new Error('SERVICE_OTHER_PAYER_NOT_PAID');
      const base=Math.floor(action.totalCents/ids.length),extra=action.totalCents%ids.length;
      const shares=action.shares??ids.map((recipientId,i)=>({recipientId,amountCents:base+(i<extra?1:0)}));
      if(shares.length!==ids.length||new Set(shares.map(s=>s.recipientId)).size!==ids.length||shares.some(s=>!ids.includes(s.recipientId))||shares.reduce((sum,s)=>sum+BigInt(s.amountCents),0n)!==BigInt(action.totalCents))throw new Error('SERVICE_SPLIT_SHARES_MISMATCH');
      account(state,action.accountId);if(!action.alreadyPaid)requireFunds(state,action.accountId,action.totalCents);
      amountCents=action.alreadyPaid?0:action.totalCents;
      details={payer:d.recipients.find(r=>r.id===payerId),recipientVersions:ids.map(id=>{const r=d.recipients.find(r=>r.id===id)!;return {id:r.id,version:r.version,suffix:r.suffix};}),shares:ids.map(id=>{const share=shares.find(s=>s.recipientId===id)!;return {...share,collectedCents:id===payerId?share.amountCents:0};})};
      label=`总额¥${action.totalCents/100}，${ids.length}人AA。${payerId!=='self'?'同行已垫付，本次只登记本人应付款；不会代同行收款或增加你的余额。':action.alreadyPaid?'你声明已经垫付，本次仅创建模拟收款请求，不再扣款。':'本次先垫付全额，再创建收款请求。'}待收不计入余额。`;break;
    }
    case 'pay_split_share':{
      const split=d.splits.find(s=>s.id===action.id),own=split?.shares.find(s=>s.recipientId==='self');
      if(!split||!['open','partial'].includes(split.status)||!split.payerId||split.payerId==='self'||!own||own.collectedCents>=own.amountCents)throw new Error('SERVICE_SPLIT_NOT_PAYABLE');
      if(d.receipts.some(r=>r.kind==='pay_split_share'&&r.status==='unknown'&&d.events.includes(`split-share-target:${r.operationId}:${split.id}`)))throw new Error('SERVICE_SPLIT_STATUS_REQUIRED');
      amountCents=own.amountCents-own.collectedCents;requireFunds(state,action.accountId,amountCents);
      const payer=d.recipients.find(r=>r.id===split.payerId);if(!payer)throw new Error('SERVICE_RECIPIENT_CHANGED');if(!recipientReady(payer))throw new Error('SERVICE_RECIPIENT_REVIEW_REQUIRED');
      details={payer,splitId:split.id};label=`向垫付人${payer.name}（尾号${payer.suffix}，${payer.alias}）支付本人AA份额¥${amountCents/100}，来源${action.accountId}，手续费¥0。其他人的欠款不会由你支付。`;break;
    }
    case 'close_split':if(!d.splits.some(s=>s.id===action.id&&['open','partial'].includes(s.status)))throw new Error('SERVICE_SPLIT_NOT_OPEN');if(d.receipts.some(r=>r.kind==='pay_split_share'&&r.status==='unknown'&&d.events.includes(`split-share-target:${r.operationId}:${action.id}`)))throw new Error('SERVICE_SPLIT_STATUS_REQUIRED');label='关闭剩余收款请求，已收款和凭证保留；不撤销已经结算的本人付款。';break;
    case 'risk_profile':if(action.useByDate<=state.clock)throw new Error('SERVICE_USE_DATE_PASSED');label=`保存模拟风险等级R${action.level}，${action.tolerateLoss?'可以承受范围内的波动':'不接受本金损失'}，最早用钱日${action.useByDate}。`;break;
    case 'buy':{const p=product(action.productId),r=d.risk;if(!r||r.expiresOn<state.clock)throw new Error('SERVICE_RISK_PROFILE_REQUIRED');if(p.paused)throw new Error('SERVICE_PRODUCT_PAUSED');if(!investmentMatch(state,p,action.amountCents).suitable)throw new Error('SERVICE_PRODUCT_NOT_SUITABLE');requireFunds(state,action.accountId,action.amountCents);const fees=fee(action.amountCents,p.buyFeeBps);if(action.amountCents<=fees)throw new Error('SERVICE_AMOUNT_TOO_SMALL');const q=(BigInt(action.amountCents-fees)*1000000000000n/BigInt(p.navScaled)).toString();if(BigInt(q)===0n)throw new Error('SERVICE_AMOUNT_TOO_SMALL');amountCents=action.amountCents;details={product:p,feeCents:fees,quantityMicro:q,settlesOn:nextTradingDay(state.clock)};label=`${p.name}：申购总额¥${amountCents/100}，内含费用¥${fees/100}；固定模拟净值成交，${nextTradingDay(state.clock)}确认份额，最低持有${p.lockDays}天。非保本，预测收益不是现金。`;break;}
    case 'redeem':{const p=product(action.productId),position=d.positions.find(x=>x.productId===p.id);if(p.paused)throw new Error('SERVICE_PRODUCT_PAUSED');if(!position||BigInt(action.quantityMicro)<=0n||BigInt(action.quantityMicro)>BigInt(position.quantityMicro)-BigInt(position.reservedMicro))throw new Error('SERVICE_INSUFFICIENT_SHARES');if(shift(position.acquiredOn,p.lockDays)>state.clock)throw new Error('SERVICE_POSITION_LOCKED');account(state,action.accountId);const gross=valuation(action.quantityMicro,p.navScaled),fees=fee(gross,p.feeBps);amountCents=gross-fees;details={product:p,feeCents:fees,grossCents:gross,settlesOn:nextTradingDay(state.clock)};label=`赎回${Number(action.quantityMicro)/1000000}份${p.name}，毛额¥${gross/100}、费用¥${fees/100}、净额¥${amountCents/100}；预计${nextTradingDay(state.clock)}到账，未到账不可支付。`;break;}
    case 'card':{if(d.cardOperations.some(o=>(o.cardId===action.id||o.replacementCardId===action.id)&&o.status==='unknown'))throw new Error('SERVICE_CARD_STATUS_REQUIRED');const c=d.cards.find(c=>c.id===action.id);if(!c)throw new Error('SERVICE_CARD_NOT_FOUND');if(c.status==='lost')throw new Error('SERVICE_CARD_LOST');if(action.action==='unlock'&&c.status!=='locked'||action.action==='lock'&&c.status!=='active')throw new Error('SERVICE_CARD_INVALID_TRANSITION');if(action.action==='limit'&&(!action.limitCents||action.limitCents>2000000))throw new Error('SERVICE_CARD_LIMIT_INVALID');details={cardVersion:c.version,approvedLimitCents:Math.min(action.limitCents??c.limitCents,c.type==='credit'?Math.max(0,state.finance.monthlyIncomeCents*2):2000000)};label=`${c.label}（尾号${c.suffix}）：${({lock:'临时锁定',unlock:'解除临时锁',lost:'挂失，不可普通解锁',limit:`申请${c.type==='credit'?'信用额度':'单笔限制'}¥${(action.limitCents??0)/100}`,controls:`线上交易${action.online??c.online?'开启':'关闭'}、境外交易${action.overseas??c.overseas?'开启':'关闭'}`})[action.action]}。本次生效限额¥${Number(details.approvedLimitCents)/100}。额度不增加现金，新状态不撤销已扣交易。`;break;}
    case 'withdraw_card_application':{const application=d.applications.find(a=>a.id===action.id);if(!application)throw new Error('SERVICE_APPLICATION_NOT_FOUND');if(!['under_review','needs_information'].includes(application.status))throw new Error('SERVICE_APPLICATION_NOT_WITHDRAWABLE');label='撤回仍在审核中的卡片申请，费用¥0；不会注销已有卡片或改变账户余额。';break;}
    case 'supplement_card_application':{const application=d.applications.find(a=>a.id===action.id);if(!application||application.status!=='needs_information')throw new Error('SERVICE_APPLICATION_NOT_AWAITING_INFORMATION');details={applicationId:application.id,requestedCents:application.requestedCents,employment:action.employment};label=`为原申请补交${action.employment==='synthetic_salaried'?'合成在职证明':'合成自由职业收入说明'}，不含真实身份信息；提交后重新审核，不保证通过，费用¥0。`;break;}
    case 'apply_card':if(d.applications.some(a=>a.product===action.product&&['under_review','unknown','needs_information'].includes(a.status)))throw new Error('SERVICE_CARD_APPLICATION_PENDING');label=`申请${action.product==='travel_debit'?'模拟旅行借记卡':'模拟信用卡'}，费用¥0，使用合成资料（${action.employmentEvidence==='missing'?'缺少就业说明，需补充':'就业说明已具备'}），审核可能通过、拒绝、待审或要求补充资料。`;break;
    case 'replace_card':{
      const card=d.cards.find(c=>c.id===action.id);if(!card||card.status!=='lost')throw new Error('SERVICE_CARD_REPLACEMENT_REQUIRES_LOSS');
      if(d.cardOperations.some(o=>o.cardId===card.id&&(o.status==='unknown'||o.kind==='replace_card'&&o.status==='succeeded')))throw new Error('SERVICE_CARD_REPLACEMENT_EXISTS');
      details={cardVersion:card.version};label=`补发${card.label}（旧尾号${card.suffix}），费用¥0，结算账户仍为${card.accountId}。旧卡持续挂失，新卡初始锁定且关闭线上/境外；需单独确认解锁和开关，旧订单不撤销、现金不增加。`;break;
    }
    case 'allocate':{if(!state.goals.some(g=>g.id===action.goalId))throw new Error('SERVICE_GOAL_NOT_FOUND');const a=account(state,action.accountId);if(a.type==='goal')throw new Error('SERVICE_GOAL_FUNDS_PROTECTED');requireFunds(state,a.id,action.amountCents,action.goalId);amountCents=action.amountCents;label=`将${a.label}的¥${amountCents/100}分配给此目标，不发生银行转账，不再供其他目标使用。`;break;}
    case 'mandate':{account(state,action.accountId);if(!state.goals.some(g=>g.id===action.goalId))throw new Error('SERVICE_GOAL_NOT_FOUND');if(action.maxPerOrderCents>action.totalCents||Date.parse(action.expiresAt)<=now||Date.parse(action.expiresAt)>now+30*86400000||action.merchants.some(m=>!['air-demo','stay-demo'].includes(m)))throw new Error('SERVICE_MANDATE_INVALID');if(action.id){const m=d.mandates.find(m=>m.id===action.id&&m.status==='active');if(!m||m.goalId!==action.goalId||m.accountId!==action.accountId||action.totalCents<m.spentCents+m.reservedCents)throw new Error('SERVICE_MANDATE_SCOPE');}label=`${action.id?'修改':'创建'}授权：${action.merchants.join('、')}服务此目标，来源${action.accountId}，单笔上限¥${action.maxPerOrderCents/100}、累计¥${action.totalCents/100}，有效至${action.expiresAt}。每份订单仍需核对确认，实质变更重新确认。`;break;}
    case 'revoke_mandate':if(!d.mandates.some(m=>m.id===action.id&&m.status==='active'))throw new Error('SERVICE_MANDATE_SCOPE');label='撤销此授权，停止新订单；已提交或未知订单仍按原操作核对，不自动退款。';break;
    case 'book':{if(state.financialServices.goalContracts.find(c=>c.goalId===action.goalId)?.allowPayments===false)throw new Error('GOAL_PAYMENT_NOT_ALLOWED');if(new Set(action.quoteIds).size!==action.quoteIds.length)throw new Error('SERVICE_DUPLICATE_QUOTE');const quotes=action.quoteIds.map(id=>{const q=d.quotes.find(q=>q.id===id);if(!q)throw new Error('SERVICE_QUOTE_NOT_FOUND');verifyQuote(q,now);return q;});const m=d.mandates.find(m=>m.id===action.mandateId&&m.status==='active');if(!m||m.accountId!==action.accountId||m.goalId!==action.goalId||Date.parse(m.expiresAt)<=now||quotes.some(q=>!m.merchants.includes(q.merchantId)||q.totalCents>m.maxPerOrderCents))throw new Error('SERVICE_MANDATE_SCOPE');const c=d.cards.find(c=>c.id===action.cardId);if(c&&d.cardOperations.some(o=>(o.cardId===c.id||o.replacementCardId===c.id)&&o.status==='unknown'))throw new Error('SERVICE_CARD_STATUS_REQUIRED');if(!c||c.type!=='debit'||c.accountId!==action.accountId||c.status!=='active'||!c.online||!c.overseas||quotes.some(q=>q.totalCents>c.limitCents))throw new Error('SERVICE_CARD_PAYMENT_BLOCKED');if(quotes.some(q=>d.bookings.some(b=>b.quoteId===q.id&&!['failed','refunded'].includes(b.status))))throw new Error('SERVICE_BOOKING_EXISTS');amountCents=integer(quotes.reduce((n,q)=>n+q.totalCents,0));if(m.spentCents+m.reservedCents+amountCents>m.totalCents)throw new Error('SERVICE_MANDATE_LIMIT');requireFunds(state,action.accountId,amountCents,action.goalId);details={quotes,cardVersion:c.version,mandateId:m.id};label=`预留并支付${quotes.map(q=>q.label).join('、')}，总计¥${amountCents/100}（含税费），来源${action.accountId}、卡尾号${c.suffix}。两单分别执行；失败只修未完成项，未知先查原操作，退款按已列条款。`;break;}
    case 'cancel_booking':{const b=d.bookings.find(b=>b.id===action.id);if(!b||b.status!=='confirmed'||!b.refundable)throw new Error('SERVICE_BOOKING_NOT_REFUNDABLE');amountCents=b.amountCents;label=`取消此订单并申请原路退款¥${amountCents/100}，预计${nextTradingDay(state.clock)}到账；当前余额不立即增加。`;break;}
  }
  return {state,action,label,amountCents,details,manifestHash:stableHash({action,details,amountCents,twinVersion:state.twinVersion})};
}

function receipt(s:DemoState,op:string,kind:string,label:string,amountCents:number,status:'succeeded'|'pending'|'failed'|'unknown'){
  s.financialServices.receipts.push({id:randomUUID(),operationId:op,kind,label,amountCents,status,date:s.clock});
}
function captureBooking(s:DemoState,b:DemoState['financialServices']['bookings'][number]){
  if(b.payment==='captured')return;
  const d=s.financialServices,h=d.holds.find(h=>h.operationId===b.id&&h.status==='active');if(!h)throw new Error('SERVICE_HOLD_NOT_FOUND');
  h.status='consumed';post(s,b.accountId,-b.amountCents,b.operationId,`capture:${b.id}`,'旅行服务付款',b.goalId,true);
  b.payment='captured';b.status='confirmed';const m=d.mandates.find(m=>m.id===b.mandateId)!;m.reservedCents-=b.amountCents;m.spentCents+=b.amountCents;
}
function failBooking(s:DemoState,b:DemoState['financialServices']['bookings'][number]){
  const d=s.financialServices,h=d.holds.find(h=>h.operationId===b.id&&h.status==='active');
  if(h){h.status='released';d.mandates.find(m=>m.id===b.mandateId)!.reservedCents-=b.amountCents;}b.payment='released';b.status='failed';
}

/** Called only from a confirmed, version-bound server action. */
export function executeServiceAction(input:DemoState,raw:unknown,operationId:string,now=Date.now()){
  if(input.financialServices.receipts.some(r=>r.operationId===operationId))return input;
  const preview=describeServiceAction(input,raw,now),s=preview.state,d=s.financialServices,a=preview.action;
  let status:'succeeded'|'pending'|'failed'|'unknown'='succeeded';const fault=d.fault;d.fault='none';
  switch(a.kind){
    case 'verify_recipient':case 'review_recipient':{const r=d.recipients.find(r=>r.id===a.id)!;r.version++;r.identityStatus=a.kind==='verify_recipient'?'verified':'needs_review';r.verifiedVersion=a.kind==='verify_recipient'?r.version:undefined;break;}

    case 'investment_questionnaire':d.risk={level:investmentRiskLevel(a.answers),tolerateLoss:investmentRiskLevel(a.answers)>0,useByDate:a.answers.useByDate,expiresOn:shift(s.clock,180),answers:a.answers};break;
    case 'goal_contract':Object.assign(s,applyGoalContract(s,GoalContractSchema.parse(preview.details.after)));break;
    case 'portfolio_repair':{
      const option=buildGoalPortfolio(s).options.find(o=>o.id===a.optionId);if(!option)throw new Error('PORTFOLIO_OPTION_STALE');
      for(const change of option.changes)Object.assign(s,applyGoalContract(s,changedGoalContract(s,portfolioRepairTerms(s,change))));
      break;
    }
    case 'transfer':
      if(fault==='decline'){status='failed';break;}
      if(fault.startsWith('timeout')){d.holds.push({id:randomUUID(),operationId,accountId:a.accountId,goalId:null,amountCents:a.amountCents,status:'active'});d.events.push(`transfer-provider:${operationId}:${fault==='timeout_after'?'committed':'not_committed'}`);status='unknown';}
      else post(s,a.accountId,-a.amountCents,operationId,`transfer:${operationId}`,'联系人转账');break;
    case 'split':
      if(!a.alreadyPaid)post(s,a.accountId,-a.totalCents,operationId,`split-pay:${operationId}`,'AA垫付');
      d.splits.push({id:operationId,accountId:a.accountId,totalCents:a.totalCents,alreadyPaid:a.alreadyPaid,dueDate:a.dueDate,...(a.payerId?{payerId:a.payerId}:{}),status:'open',shares:preview.details.shares as typeof d.splits[number]['shares']});break;
    case 'pay_split_share':{
      if(fault==='decline'){status='failed';break;}
      if(fault.startsWith('timeout')){
        d.holds.push({id:randomUUID(),operationId,accountId:a.accountId,goalId:null,amountCents:preview.amountCents,status:'active'});
        d.events.push(`transfer-provider:${operationId}:${fault==='timeout_after'?'committed':'not_committed'}`,`split-share-target:${operationId}:${a.id}`);
        status='unknown';break;
      }
      post(s,a.accountId,-preview.amountCents,operationId,`split-share:${operationId}`,'支付本人AA份额');
      const split=d.splits.find(x=>x.id===a.id)!,own=split.shares.find(x=>x.recipientId==='self')!;own.collectedCents=own.amountCents;
      split.status=split.shares.every(x=>x.collectedCents===x.amountCents)?'collected':'partial';break;
    }
    case 'close_split':d.splits.find(x=>x.id===a.id)!.status='closed';break;
    case 'risk_profile':d.risk={level:a.level,tolerateLoss:a.tolerateLoss,useByDate:a.useByDate,expiresOn:shift(s.clock,180)};break;
    case 'buy':{
      if(fault==='decline'){status='failed';break;}
      // Submission posts cash once; an uncertain order keeps its provider record.
      // A query resolves acceptance before settlement, never starts another order.
      post(s,a.accountId,-a.amountCents,operationId,`buy:${operationId}`,'模拟理财申购');
      d.investments.push({id:operationId,kind:'buy',productId:a.productId,accountId:a.accountId,amountCents:a.amountCents,feeCents:Number(preview.details.feeCents),quantityMicro:String(preview.details.quantityMicro),settlesOn:String(preview.details.settlesOn),operationId,status:fault.startsWith('timeout')?'unknown':'pending',providerStatus:fault==='timeout_before'?'failed':'pending'});
      status=fault.startsWith('timeout')?'unknown':'pending';break;
    }
    case 'redeem':{
      if(fault==='decline'){status='failed';break;}
      const p=d.positions.find(p=>p.productId===a.productId)!;p.reservedMicro=(BigInt(p.reservedMicro)+BigInt(a.quantityMicro)).toString();
      d.investments.push({id:operationId,kind:'redeem',productId:a.productId,accountId:a.accountId,amountCents:preview.amountCents,feeCents:Number(preview.details.feeCents),quantityMicro:a.quantityMicro,settlesOn:String(preview.details.settlesOn),operationId,status:fault.startsWith('timeout')?'unknown':'pending',providerStatus:fault==='timeout_before'?'failed':'pending'});
      status=fault.startsWith('timeout')?'unknown':'pending';break;
    }
    case 'card':{
      const c=d.cards.find(c=>c.id===a.id)!;if(fault==='decline'){status='failed';break;}
      if(fault.startsWith('timeout'))d.cardOperations.push({id:operationId,cardId:c.id,kind:'card',status:'unknown',providerStatus:fault==='timeout_after'?'succeeded':'failed',replacementCardId:null,originalVersion:c.version});
      if(fault==='timeout_before'){status='unknown';break;}
      if(a.action==='lock')c.status='locked';if(a.action==='unlock')c.status='active';if(a.action==='lost')c.status='lost';
      if(a.action==='limit')c.limitCents=Number(preview.details.approvedLimitCents);
      if(a.action==='controls'){c.online=a.online??c.online;c.overseas=a.overseas??c.overseas;}c.version++;if(fault==='timeout_after')status='unknown';break;
    }
    case 'replace_card':{
      const old=d.cards.find(c=>c.id===a.id)!,created=fault==='none'||fault==='timeout_after';
      const replacementId=created?`replacement:${operationId}`:null;
      if(created)d.cards.push({...old,id:replacementId!,label:old.label+'（补发）',suffix:stableHash(operationId).slice(0,4),status:'locked',online:false,overseas:false,version:1});
      status=fault.startsWith('timeout')?'unknown':fault==='decline'?'failed':'succeeded';
      d.cardOperations.push({id:operationId,cardId:old.id,kind:'replace_card',status:status==='unknown'?'unknown':created?'succeeded':'failed',providerStatus:created?'succeeded':'failed',replacementCardId:replacementId,originalVersion:old.version});break;
    }
    case 'withdraw_card_application':{const application=d.applications.find(x=>x.id===a.id)!;if(fault!=='none')throw new Error('SERVICE_APPLICATION_QUERY_REQUIRED');application.status='withdrawn';application.decisionReason='用户在审核完成前撤回；如需申请，请重新核对确认。';d.receipts.filter(r=>r.operationId===application.operationId||r.kind==='supplement_card_application'&&d.events.includes(`card-supplement:${r.operationId}:${a.id}`)).forEach(r=>{r.status='failed';r.label+='（已由用户撤回）';});break;}
    case 'supplement_card_application':{if(fault!=='none')throw new Error('SERVICE_APPLICATION_QUERY_REQUIRED');const application=d.applications.find(x=>x.id===a.id)!;d.events.push(`card-supplement:${operationId}:${a.id}`);application.employmentEvidence='available';application.employment=a.employment;application.supplementedOn=s.clock;application.status='under_review';application.decisionReason='合成资料已提交，等待重新审核；尚未获批额度。';status='pending';break;}
    case 'apply_card':d.applications.push({id:operationId,product:a.product,requestedCents:a.requestedLimitCents,employmentEvidence:a.employmentEvidence,approvedCents:0,status:fault==='decline'?'rejected':fault.startsWith('timeout')?'unknown':'under_review',providerAccepted:!['decline','timeout_before'].includes(fault),...(fault==='decline'?{decisionReason:'模拟审核未通过，未创建新卡，也未改变账户余额。'}:{}),operationId});status=fault==='decline'?'failed':fault.startsWith('timeout')?'unknown':'pending';break;
    case 'allocate':d.allocations=[...d.allocations.filter(x=>x.goalId!==a.goalId||x.accountId!==a.accountId),{goalId:a.goalId,accountId:a.accountId,amountCents:a.amountCents}];break;
    case 'mandate':{const {id,kind:_kind,...fields}=a;if(id){const m=d.mandates.find(m=>m.id===id)!;Object.assign(m,fields);}else d.mandates.push({...fields,id:operationId,status:'active',reservedCents:0,spentCents:0});break;}
    case 'revoke_mandate':d.mandates.find(m=>m.id===a.id)!.status='revoked';break;
    case 'book':{
      const quotes=preview.details.quotes as typeof d.quotes,m=d.mandates.find(m=>m.id===a.mandateId)!;
      const allocation=d.allocations.find(x=>x.goalId===a.goalId&&x.accountId===a.accountId);
      const held=d.holds.filter(h=>h.status==='active'&&h.accountId===a.accountId&&h.goalId===a.goalId).reduce((n,h)=>n+h.amountCents,0);
      if(allocation)allocation.amountCents=Math.max(allocation.amountCents,held+preview.amountCents);else d.allocations.push({goalId:a.goalId,accountId:a.accountId,amountCents:preview.amountCents});
      for(const [i,q]of quotes.entries()){
        const id=`${operationId}:${i}`;d.holds.push({id:randomUUID(),operationId:id,accountId:a.accountId,goalId:a.goalId,amountCents:q.totalCents,status:'active'});m.reservedCents+=q.totalCents;
        const b:typeof d.bookings[number]={id,quoteId:q.id,merchantId:q.merchantId,accountId:a.accountId,cardId:a.cardId,goalId:a.goalId,mandateId:a.mandateId,amountCents:q.totalCents,refundable:q.refundable,operationId,status:'submitted',payment:'held',providerStatus:fault==='decline'||fault==='timeout_before'||fault==='partial'&&i>0?'failed':'confirmed',refundOn:null};d.bookings.push(b);
        if(fault.startsWith('timeout')){b.status='unknown';status='unknown';}else if(b.providerStatus==='failed'){failBooking(s,b);status='failed';}else captureBooking(s,b);
      }break;
    }
    case 'cancel_booking':{const b=d.bookings.find(b=>b.id===a.id)!;b.status='refund_pending';b.refundOn=nextTradingDay(s.clock);status='pending';break;}
  }
  receipt(s,operationId,a.kind,preview.label,preview.amountCents,status);s.twinVersion++;
  return appendAuditEvent(s,`service_${a.kind}`,status,preview.label,{operationId});
}

export function reconcileServices(input:DemoState,id?:string):DemoState{
  const s=initializeServices(input),d=s.financialServices;let changed=false;
  for(const op of d.cardOperations.filter(o=>o.status==='unknown'&&(!id||o.id===id))){op.status=op.providerStatus;d.receipts.filter(r=>r.operationId===op.id).forEach(r=>r.status=op.status==='succeeded'?'succeeded':'failed');changed=true;}
  for(const a of d.applications.filter(a=>a.status==='unknown'&&(!id||a.id===id))){a.status=a.providerAccepted?'under_review':'rejected';if(a.status==='rejected')a.decisionReason='模拟服务未受理原申请，可重新核对后申请。';if(a.status==='rejected')d.receipts.filter(r=>r.operationId===a.id).forEach(r=>r.status='failed');changed=true;}
  for(const a of d.applications.filter(a=>a.status==='under_review'&&(!id||a.id===id||d.events.includes(`card-supplement:${id}:${a.id}`)))){
    if(a.employmentEvidence==='missing'){a.status='needs_information';a.decisionReason='缺少就业说明。请选择合成在职证明或自由职业收入说明，核对确认后再审核；无需真实证件。';changed=true;continue;}
    a.approvedCents=a.product==='travel_debit'?a.requestedCents:Math.min(a.requestedCents,Math.max(0,s.finance.monthlyIncomeCents*2));a.status=a.approvedCents>0?'approved':'rejected';a.decisionReason=a.status==='rejected'?'当前合成收入不足以支持申请额度，未创建新卡。':a.approvedCents<a.requestedCents?'按合成月收入两倍核定额度，低于申请值；信用额度不计入现金。':'模拟审核通过，线上与境外支付默认关闭；信用额度不计入现金。';
    if(a.status==='approved')d.cards.push({id:`card:${a.id}`,label:a.product==='travel_debit'?'新旅行借记卡':'新日常信用卡',suffix:stableHash(a.id).slice(0,4),type:a.product==='travel_debit'?'debit':'credit',accountId:a.product==='travel_debit'?'goal-wallet':'checking',status:'active',online:false,overseas:false,limitCents:a.approvedCents,version:1});
    d.receipts.filter(r=>r.operationId===a.operationId||r.kind==='supplement_card_application'&&d.events.includes(`card-supplement:${r.operationId}:${a.id}`)).forEach(r=>r.status=a.status==='approved'?'succeeded':'failed');changed=true;
  }
  for(const b of d.bookings.filter(b=>b.status==='unknown'&&(!id||b.id===id||b.operationId===id))){if(b.providerStatus==='confirmed')captureBooking(s,b);else if(b.providerStatus==='failed')failBooking(s,b);else continue;changed=true;}
  for(const r of d.receipts.filter(r=>['transfer','pay_split_share'].includes(r.kind)&&r.status==='unknown'&&(!id||r.operationId===id))){
    const h=d.holds.find(h=>h.operationId===r.operationId&&h.status==='active');if(!h)continue;const committed=d.events.includes(`transfer-provider:${r.operationId}:committed`);h.status=committed?'consumed':'released';
    if(committed)post(s,h.accountId,-h.amountCents,r.operationId,`transfer:${r.operationId}`,'联系人转账',null,true);r.status=committed?'succeeded':'failed';changed=true;
    if(committed&&r.kind==='pay_split_share'){
      const prefix=`split-share-target:${r.operationId}:`,splitId=d.events.find(e=>e.startsWith(prefix))?.slice(prefix.length);
      const split=d.splits.find(s=>s.id===splitId);if(!split)throw new Error('SERVICE_SPLIT_NOT_FOUND');
      const own=split.shares.find(s=>s.recipientId==='self')!;own.collectedCents=own.amountCents;
      if(split.status!=='closed')split.status=split.shares.every(s=>s.collectedCents===s.amountCents)?'collected':'partial';
    }
  }
  for(const o of d.investments.filter(o=>['pending','unknown'].includes(o.status)&&(!id||o.id===id))){
    if(o.providerStatus==='failed'){
      if(o.kind==='buy')post(s,o.accountId,o.amountCents,o.operationId,`buy-rejected:${o.id}`,'申购未受理原额退回');
      else{const p=d.positions.find(p=>p.productId===o.productId)!;p.reservedMicro=(BigInt(p.reservedMicro)-BigInt(o.quantityMicro)).toString();}
      o.status='failed';d.receipts.filter(r=>r.operationId===o.operationId).forEach(r=>r.status='failed');changed=true;continue;
    }
    if(o.settlesOn>s.clock){if(o.status==='unknown'){o.status='pending';changed=true;}continue;}
    const eventId=`settle:${o.id}`;if(d.events.includes(eventId))continue;
    if(o.kind==='buy'){const p=d.positions.find(p=>p.productId===o.productId);if(p){p.quantityMicro=(BigInt(p.quantityMicro)+BigInt(o.quantityMicro)).toString();p.acquiredOn=s.clock;}else d.positions.push({productId:o.productId,quantityMicro:o.quantityMicro,reservedMicro:'0',acquiredOn:s.clock});d.events.push(eventId);}
    else{const p=d.positions.find(p=>p.productId===o.productId)!;p.quantityMicro=(BigInt(p.quantityMicro)-BigInt(o.quantityMicro)).toString();p.reservedMicro=(BigInt(p.reservedMicro)-BigInt(o.quantityMicro)).toString();post(s,o.accountId,o.amountCents,o.operationId,eventId,'模拟理财赎回结算');}
    o.providerStatus='settled';o.status='settled';d.receipts.filter(r=>r.operationId===o.operationId).forEach(r=>r.status='succeeded');changed=true;
  }
  for(const b of d.bookings.filter(b=>b.status==='refund_pending'&&b.refundOn!<=s.clock&&(!id||b.id===id||b.operationId===id))){
    post(s,b.accountId,b.amountCents,b.operationId,`refund:${b.id}`,'旅行订单退款',b.goalId);const allocation=d.allocations.find(x=>x.goalId===b.goalId&&x.accountId===b.accountId);if(allocation)allocation.amountCents+=b.amountCents;b.payment='refunded';b.status='refunded';changed=true;
  }
  for(const op of new Set(d.bookings.map(b=>b.operationId))){const bookings=d.bookings.filter(b=>b.operationId===op),r=d.receipts.find(r=>r.operationId===op&&r.kind==='book');if(r&&!bookings.some(b=>['submitted','unknown'].includes(b.status)))r.status=bookings.every(b=>b.status==='confirmed')?'succeeded':'failed';}
  if(!changed)return input;s.twinVersion++;return appendAuditEvent(s,'service_reconcile','verified','已查询原操作并核对到账/订单状态，没有重复执行。',{operationId:id});
}

export function collectSplit(input:DemoState,id:string){
  const s=initializeServices(input),d=s.financialServices,split=d.splits.find(x=>x.id===id);if(!split)throw new Error('SERVICE_SPLIT_NOT_FOUND');if(['closed','collected'].includes(split.status))return input;
  if(split.payerId&&split.payerId!=='self')return input;
  let changed=false;
  // Two fixed synthetic participants have paid; the remainder is outstanding.
  // Queries never message or charge real contacts and are safe to repeat.
  for(const share of split.shares.filter(x=>x.recipientId!=='self').slice(0,2)){if(share.collectedCents>=share.amountCents)continue;post(s,split.accountId,share.amountCents,split.id,`collection:${split.id}:${share.recipientId}`,'模拟AA到账');share.collectedCents=share.amountCents;changed=true;}
  if(!changed)return input;split.status=split.shares.every(x=>x.collectedCents===x.amountCents)?'collected':'partial';s.twinVersion++;return appendAuditEvent(s,'aa_collection','verified','已核对模拟同行收款，未收部分不计入余额。',{operationId:id});
}

/** Applied to every financial write, including the original banking tools. */
export function validateServiceBalances(old:DemoState,next:DemoState){
  const d=next.financialServices;if(!d.initialized)return;
  for(const a of next.accounts){
    const holds=d.holds.filter(h=>h.accountId===a.id&&h.status==='active').reduce((n,h)=>n+h.amountCents,0);if(holds>a.balanceCents)throw new Error('INSUFFICIENT_RESERVED_FUNDS');
    const before=old.accounts.find(b=>b.id===a.id)?.balanceCents??0;
    const recorded=d.journals.slice(old.financialServices.journals.length).filter(j=>j.accountId===a.id).reduce((n,j)=>n+j.amountCents,0);
    const opening=old.financialServices.initialized?0:before,remainder=a.balanceCents-before-(recorded-opening);
    if(remainder&&a.id==='goal-wallet'&&next.goal.id!==walletOwner(next))throw new Error('SERVICE_GOAL_FUNDS_PROTECTED');
    if(remainder)journal(next,a.id,remainder,`bridge:${old.twinVersion}:${next.twinVersion}`,`bridge:${old.twinVersion}:${next.twinVersion}:${a.id}:${d.journals.length}`,'共享银行工具入账');
    if(a.id==='goal-wallet')d.allocations.filter(x=>x.accountId===a.id&&x.goalId===walletOwner(next)).forEach(x=>x.amountCents=a.balanceCents);
    const assigned=d.allocations.filter(x=>x.accountId===a.id).reduce((n,x)=>n+x.amountCents,0);
    const unassignedHolds=d.holds.filter(h=>h.accountId===a.id&&h.status==='active'&&!d.allocations.some(x=>x.accountId===a.id&&x.goalId===h.goalId)).reduce((n,h)=>n+h.amountCents,0);
    if(assigned+unassignedHolds>a.balanceCents)throw new Error('SERVICE_ALLOCATION_CONFLICT');
  }
  for(const p of d.positions)if(BigInt(p.reservedMicro)>BigInt(p.quantityMicro))throw new Error('SERVICE_INSUFFICIENT_SHARES');
}

export function financialServicesView(input:DemoState){
  const s=initializeServices(input),d=s.financialServices;
  const goals=s.goals.map(g=>{const cash=d.allocations.filter(a=>a.goalId===g.id).reduce((n,a)=>n+a.amountCents,0),held=d.holds.filter(h=>h.goalId===g.id&&h.status==='active').reduce((n,h)=>n+h.amountCents,0),booked=d.bookings.filter(b=>b.goalId===g.id&&b.payment==='captured'&&b.status==='confirmed').reduce((n,b)=>n+b.amountCents,0);return {id:g.id,title:g.title,targetCents:g.targetCents,cashCents:cash,heldCents:held,spendableCents:cash-held,bookedCents:booked,coveredCents:cash+booked,funded:cash+booked>=g.targetCents,bookingReady:['air-demo','stay-demo'].every(m=>d.bookings.some(b=>b.goalId===g.id&&b.merchantId===m&&b.status==='confirmed'))};});
  return {simulated:true,clock:s.clock,twinVersion:s.twinVersion,goals,issues:serviceIssues(s),
    accounts:s.accounts.filter(a=>!a.protected&&['checking','goal'].includes(a.type)).map(a=>{const owner=a.id==='goal-wallet'?walletOwner(s):null,available=spendableFunds(s,a.id,owner);return {...a,goalId:owner,availableCents:available??0,balanceCurrent:available!==null};}),
    recipients:d.recipients,products:investmentProducts.map(p=>({...p,...investmentMatch(s,p)})),risk:d.risk,
    positions:d.positions.map(p=>({...p,valueCents:valuation((BigInt(p.quantityMicro)-BigInt(p.reservedMicro)).toString(),product(p.productId).navScaled)})),investments:d.investments.map(({providerStatus:_p,...o})=>o),
    cards:d.cards,applications:d.applications.map(({providerAccepted:_accepted,...application})=>application),cardOperations:d.cardOperations.map(({providerStatus:_provider,...operation})=>operation),splits:d.splits,quotes:d.quotes.map(q=>{let identityVerified=true;try{verifyQuote(q,Math.min(Date.now(),Date.parse(q.expiresAt)-1));}catch{identityVerified=false;}const {signature:_s,...fields}=q;return {...fields,identityVerified,expired:Date.parse(q.expiresAt)<=Date.now()};}),
    mandates:d.mandates,bookings:d.bookings.map(({providerStatus:_p,...b})=>b),receipts:d.receipts,journals:d.journals.slice(-80),
    limitations:['所有商户、风险、净值、审核和到账均为模拟。','投资采用固定模拟报价；未结算和AA待收不可支付。','同产品合并持仓以最近一次份额确认日重新计算整笔最低持有期。','模拟交易日为周一至周五，不代表真实银行节假日日历。','信用卡暂不用于旅行付款，额度不进入现金。']};
}
export type FinancialServicesView=ReturnType<typeof financialServicesView>;
