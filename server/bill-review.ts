import {type DemoState,BillPeriodInputSchema,BillReviewInputSchema} from '../shared/contracts.ts';
import {buildBillBrief} from './bill-analysis.ts';
import {stableHash,appendAuditEvent} from './governance.ts';
/** User feedback annotates a specific evidence-backed comparison, never changes money or hides transactions. */
export function billInvestigation(state:DemoState,input:unknown){
 const period=BillPeriodInputSchema.parse(input),brief=buildBillBrief(state,period);
 return {periodStart:period.periodStart,periodEnd:period.periodEnd,twinVersion:state.twinVersion,items:brief.changes.filter(c=>c.increaseCents!==0).map(c=>{
  const refs=[...c.sourceRefs].sort(),refSet=new Set(refs);
  const rows=state.normalizedStatementRows.filter(r=>refSet.has(`evidence-${r.id}`)).map(r=>({id:r.id,date:r.date,amountCents:r.amountCents,category:r.category,excludedReason:r.excludedReason,correctedValues:r.correctedValues})).sort((a,b)=>a.id.localeCompare(b.id));
  const fingerprint=stableHash({period,calculationVersion:brief.calculationVersion,category:c.category,baselineCents:c.baselineCents,currentCents:c.currentCents,refs,rows});
  const review=state.billReviews.filter(r=>r.fingerprint===fingerprint).at(-1)??null;
  return {...c,fingerprint,review,evidence:rows.map(r=>({id:`evidence-${r.id}`,date:r.date,amountCents:r.amountCents})),baselineStart:c.baselineStart??null,baselineEnd:c.baselineEnd??null,previousReviewCount:state.billReviews.filter(r=>r.category===c.category&&r.periodStart===period.periodStart&&r.periodEnd===period.periodEnd&&r.fingerprint!==fingerprint).length};
 }),limitations:brief.limitations};
}
export type BillInvestigation=ReturnType<typeof billInvestigation>;
export function reviewBillChange(input:DemoState,raw:unknown):DemoState{
 const body=BillReviewInputSchema.parse(raw);
 if(body.expectedTwinVersion!==input.twinVersion)throw new Error('TWIN_VERSION_CHANGED');
 const result=billInvestigation(input,{periodStart:body.periodStart,periodEnd:body.periodEnd});
 const item=result.items.find(c=>c.fingerprint===body.fingerprint);if(!item)throw new Error('BILL_REVIEW_STALE');
 if(item.review?.decision===body.decision)return input;
 const state=structuredClone(input);
 state.billReviews.push({id:`bill-review-${state.twinVersion}-${state.billReviews.length}`,fingerprint:item.fingerprint,periodStart:body.periodStart,periodEnd:body.periodEnd,category:item.category,decision:body.decision,sourceRefs:item.sourceRefs,reviewedOn:state.clock});state.twinVersion++;
 return appendAuditEvent(state,'bill_change_review','recorded',`用户标记账单支出变化：${body.decision}；交易、分类和权威余额保持不变。`,{operationId:state.billReviews.at(-1)!.id});
}
