import type {DemoState,Subscription,SubscriptionMerchant} from '../shared/contracts.ts';
import {appendAuditEvent,createApprovalSnapshot,confirmApproval} from './governance.ts';
import {prepareSubscriptionAction,executeSubscriptionCancellation} from './subscription-service.ts';

const samples: Array<[string,string,number,'monthly'|'annual'|'once',SubscriptionMerchant['cancellationBehavior'],boolean,'confirmed'|'candidate']> = [
 ['melody','Melody',1800,'monthly','succeeded',false,'confirmed'],
 ['moviepass','MoviePass',19800,'annual','succeeded',false,'confirmed'],
 ['fitspace','FitSpace',12900,'monthly','requires_merchant',false,'confirmed'],
 ['devstudio','DevStudio',3900,'monthly','succeeded',false,'confirmed'],
 ['gameclub','GameClub',2500,'monthly','failed',false,'confirmed'],
 ['learnnow','LearnNow',4900,'monthly','not_submitted',false,'confirmed'],
 ['designkit','DesignKit',29900,'annual','unknown',false,'confirmed'],
 ['newsbrief','NewsBrief',1200,'monthly','succeeded',false,'confirmed'],
 ['travelsim','TravelSIM',3500,'once','requires_merchant',false,'candidate'],
 ['homenet','HomeNet',8000,'monthly','requires_merchant',true,'confirmed'],
 ['shoppattern','ShopPattern',5900,'once','requires_merchant',false,'candidate'],
];

/** Explicit additive synthetic scenario; never replaces balances or baseline statement history. */
export function addSubscriptionSamples(state:DemoState):DemoState {
 const missing=samples.filter(([id])=>!state.subscriptions.some(s=>s.id===id));
 if(!missing.length)return state;
 const [year,month]=state.clock.split('-').map(Number);
 const date=new Date(Date.UTC(year,month,5)).toISOString().slice(0,10);
 const paidThrough=new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10);
 const subscriptions:Subscription[]=missing.map(([id,title,chargeCents,billingCycle,,,classification])=>({id,title,chargeCents,billingCycle,
   monthlyCents:billingCycle==='annual'?Math.floor(chargeCents/12):billingCycle==='once'?0:chargeCents,nextChargeDate:date,status:'active',classification,necessary:samples.find(s=>s[0]===id)![5]}));
 const merchants:SubscriptionMerchant[]=missing.map(([id,,chargeCents,billingCycle,behavior])=>({subscriptionId:id,merchantId:id,
   monthlyCents:subscriptions.find(s=>s.id===id)!.monthlyCents,chargeCents,billingCycle,paidThrough,effectiveAt:date,renewalEnabled:true,
   cancellationBehavior:behavior,status:'active',operationId:null,cancelledAt:null}));
 let next:DemoState=appendAuditEvent({...state,subscriptions:[...state.subscriptions,...subscriptions],subscriptionMerchants:[...state.subscriptionMerchants,...merchants],twinVersion:state.twinVersion+1},
   'synthetic_subscription_catalog','added',`用户载入${missing.length}个模拟订阅画像；期初余额和历史账单不变。`);
 // NewsBrief represents a historical, already verified cancellation in this explicitly loaded fixture.
 if(missing.some(s=>s[0]==='newsbrief')){
   const preview=prepareSubscriptionAction(next,{subscriptionId:'newsbrief',action:'cancel'});
   next={...next,subscriptionActions:[...next.subscriptionActions,preview.action]};
   const approval=createApprovalSnapshot(next,'execute_subscription_cancellation',preview.approvalParameters!,state.clock+'T12:05:00.000Z');
   const confirmed=confirmApproval(approval.state,approval.approval.id,approval.approval.snapshotHash);
   next=executeSubscriptionCancellation(confirmed.state,{actionId:preview.action.id,approvalToken:confirmed.token}).state;
 }
 return next;
}

export function subscriptionReminders(state:DemoState){
 return state.subscriptions.flatMap(item=>{
   const decision=state.subscriptionActions.filter(a=>a.subscriptionId===item.id).at(-1);
   if(item.status==='cancelled'||decision?.action!=='remind'||!decision.reminderAt)return [];
   return [{id:`subscription-reminder-${decision.id}`,subscriptionId:item.id,title:item.title,dueDate:decision.reminderAt,
     status:decision.reminderAt<=state.clock?'due' as const:'scheduled' as const,actionId:decision.id}];
 });
}

/** A post-cancellation charge is evidence to investigate, never authority to credit a refund. */
export function subscriptionDisputes(state:DemoState){
 return state.subscriptions.flatMap(item=>{
  const action=state.subscriptionActions.filter(a=>a.subscriptionId===item.id&&a.nextChargeSuppressed&&['succeeded','reconciled'].includes(a.status)).at(-1);
  if(!action)return [];
  return state.normalizedStatementRows.filter(row=>row.date>=action.effectiveAt&&row.amountCents<0&&!row.excludedReason&&
    state.statementImportBatches.some(b=>b.id===row.batchId&&b.status==='committed')&&
    (row.title===item.title||row.merchantId===item.id||item.id==='cloudbox-plus'&&row.merchantId==='cloudbox')).map(row=>({
      id:`subscription-dispute-${row.id}`,subscriptionId:item.id,title:item.title,amountCents:Math.abs(row.amountCents),date:row.date,
      evidenceId:`evidence-${row.id}`,actionId:action.id,status:'needs_review' as const,
    }));
 });
}
