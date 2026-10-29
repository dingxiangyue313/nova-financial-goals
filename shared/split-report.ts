import type {FinancialServices} from './financial-services.ts';
export function splitSummary(splits:FinancialServices['splits'],clock:string){
 let receivableCents=0,payableCents=0,overdueCount=0,closedOutstandingCents=0;
 for(const s of splits){const other=Boolean(s.payerId&&s.payerId!=='self');const remaining=s.shares.filter(p=>other?p.recipientId==='self':p.recipientId!=='self').reduce((n,p)=>n+Math.max(0,p.amountCents-p.collectedCents),0);if(s.status==='closed'){closedOutstandingCents+=remaining;continue;}if(!['open','partial'].includes(s.status))continue;if(other)payableCents+=remaining;else receivableCents+=remaining;if(remaining&&s.dueDate<clock)overdueCount++;}
 return {receivableCents,payableCents,overdueCount,closedOutstandingCents};
}
export function splitStatement(s:FinancialServices['splits'][number],clock:string){
 return {schemaVersion:1,asOf:clock,simulation:true,id:s.id,status:s.status,totalCents:s.totalCents,dueDate:s.dueDate,payerId:s.payerId??'self',dateChanges:s.dateChanges??[],participants:s.shares.map(p=>{const identity=s.participants?.find(r=>r.id===p.recipientId);return {recipientId:p.recipientId,name:identity?.name??null,alias:identity?.alias??null,suffix:identity?.suffix??null,identitySnapshotAvailable:Boolean(identity),amountCents:p.amountCents,settledCents:p.collectedCents,outstandingCents:Math.max(0,p.amountCents-p.collectedCents)};}),limitations:['只含当前会话模拟AA记录；不是银行到账证明。','待收和关闭后未结清金额不能计入可用余额。','未记录其他参与人的全部实际付款，不代表外部完整结算。']};
}
