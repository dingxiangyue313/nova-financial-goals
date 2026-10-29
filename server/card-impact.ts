import type {FinancialServices} from '../shared/financial-services.ts';
/** Existing captured orders survive card loss; refund and unknown states remain independent. */
export function cardImpact(data:Pick<FinancialServices,'bookings'|'cardOperations'|'cards'>,id:string){
 const replacement=data.cardOperations.find(o=>o.cardId===id&&o.kind==='replace_card'&&o.status==='succeeded');
 const card=replacement?data.cards.find(c=>c.id===replacement.replacementCardId):undefined;
 return {replacementReady:card?.status==='active',replacementSuffix:card?.suffix??null,orders:data.bookings.filter(b=>b.cardId===id).map(b=>({id:b.id,status:b.status,payment:b.payment,amountCents:b.amountCents,refundable:b.refundable}))};
}
