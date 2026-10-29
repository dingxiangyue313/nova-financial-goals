import {randomUUID} from 'node:crypto';import {z} from 'zod';
import type {DemoState} from '../shared/contracts.ts';import {verifyExternalRequest,signExternalRequest} from './security.ts';
import {initializeServices,requestTravelQuotes,sealTravelQuote} from './financial-services.ts';
const key=process.env.NOVA_EXTERNAL_AGENT_SECRET||process.env.NOVA_SESSION_SECRET||randomUUID();
const money=z.number().int().nonnegative().max(100000000);
const Offer=z.object({currency:z.literal('CNY'),merchantId:z.enum(['air-demo','stay-demo']),kind:z.enum(['flight','hotel']),baseCents:money,taxCents:money,feeCents:money,totalCents:money.positive(),refundable:z.boolean(),expiresAt:z.iso.datetime()}).strict();
export const TravelEnvelopeSchema=z.object({agentId:z.literal('travel-agent-demo'),subject:z.string().max(300),timestamp:z.number().int(),nonce:z.string().max(100),body:z.object({requestId:z.string().uuid(),goalId:z.string().max(100),revision:z.number().int().positive().max(1000000),replacesRequestId:z.string().optional(),quotes:z.array(Offer).length(2)}).strict()}).strict();
export type TravelEnvelope=z.infer<typeof TravelEnvelopeSchema>;
export const signTravelEnvelope=(envelope:TravelEnvelope)=>signExternalRequest(key,envelope);
export function receiveTravelRequest(input:DemoState,sessionId:string,raw:unknown,signature:string,now=Date.now()){
 const e=TravelEnvelopeSchema.parse(raw),s=verifyExternalRequest(initializeServices(input),key,e,signature,now,`${sessionId}:${e.body.goalId}`).state,d=s.financialServices;
 if(!s.goals.some(g=>g.id===e.body.goalId))throw new Error('SERVICE_GOAL_NOT_FOUND');
 if(d.travelRequests.some(r=>r.id===e.body.requestId))throw new Error('SERVICE_TRAVEL_REQUEST_REPLAY');
 if(new Set(e.body.quotes.map(q=>q.kind)).size!==2||e.body.quotes.some(q=>q.merchantId!==(q.kind==='flight'?'air-demo':'stay-demo')||q.totalCents!==q.baseCents+q.taxCents+q.feeCents||Date.parse(q.expiresAt)<=now||Date.parse(q.expiresAt)>now+900000))throw new Error('SERVICE_TRAVEL_OFFER_INVALID');
 const old=e.body.replacesRequestId?d.travelRequests.find(r=>r.id===e.body.replacesRequestId):undefined;
 if(e.body.replacesRequestId&&(!old||old.goalId!==e.body.goalId||old.status==='superseded'||e.body.revision!==old.revision+1))throw new Error('SERVICE_TRAVEL_REQUEST_STALE');
 if(old&&d.bookings.some(b=>old.quoteIds.includes(b.quoteId)&&!['failed','refunded'].includes(b.status)))throw new Error('SERVICE_TRAVEL_ORDER_EXISTS');
 if(old)old.status='superseded';
 const quotes=e.body.quotes.map(q=>{const previous=old?d.quotes.find(v=>old.quoteIds.includes(v.id)&&v.kind===q.kind):undefined;return sealTravelQuote({...q,id:`${e.body.requestId}:${q.kind}`,label:q.kind==='flight'?'樱旅航空 · 往返机票':'京都旅宿 · 三晚住宿',requestId:e.body.requestId,revision:e.body.revision,...(previous?{replacesQuoteId:previous.id}:{})});});
 d.quotes.push(...quotes);d.travelRequests.push({id:e.body.requestId,agentId:e.agentId,goalId:e.body.goalId,quoteIds:quotes.map(q=>q.id),status:'received',expiresAt:new Date(Math.min(...quotes.map(q=>Date.parse(q.expiresAt)))).toISOString(),receivedAt:new Date(now).toISOString(),revision:e.body.revision,...(old?{replacesRequestId:old.id}:{})});s.twinVersion++;return s;
}
export function travelPacket(input:DemoState,sessionId:string,now=Date.now(),goalId=input.goal.id):TravelEnvelope{
 const temp=requestTravelQuotes(input,now);return {agentId:'travel-agent-demo',subject:`${sessionId}:${goalId}`,timestamp:now,nonce:randomUUID(),body:{requestId:randomUUID(),goalId,revision:1,quotes:temp.financialServices.quotes.slice(-2).map(({merchantId,kind,baseCents,taxCents,feeCents,totalCents,refundable,expiresAt})=>Offer.parse({currency:'CNY',merchantId,kind,baseCents,taxCents,feeCents,totalCents,refundable,expiresAt}))}};
}
export function requestSignedTravelQuotes(input:DemoState,sessionId:string,now=Date.now(),goalId=input.goal.id){const e=travelPacket(input,sessionId,now,goalId);return receiveTravelRequest(input,sessionId,e,signTravelEnvelope(e),now);}
export function requestTravelCounteroffer(input:DemoState,sessionId:string,id:string,kind:'flight'|'hotel',budgetCents:number,now=Date.now()){
 const d=input.financialServices,old=d.travelRequests.find(r=>r.id===id);if(!old||old.status==='superseded'||Date.parse(old.expiresAt)<=now)throw new Error('SERVICE_TRAVEL_REQUEST_STALE');
 const quotes=old.quoteIds.map(id=>d.quotes.find(q=>q.id===id)!);const target=quotes.find(q=>q.kind===kind)!;const minimum=Math.ceil(target.baseCents*95/100)+target.taxCents+target.feeCents;
 if(budgetCents<minimum||budgetCents>=target.totalCents)throw new Error('SERVICE_COUNTEROFFER_UNAVAILABLE');
 const envelope:TravelEnvelope={agentId:'travel-agent-demo',subject:`${sessionId}:${old.goalId}`,timestamp:now,nonce:randomUUID(),body:{requestId:randomUUID(),goalId:old.goalId,revision:old.revision+1,replacesRequestId:old.id,quotes:quotes.map(q=>Offer.parse({currency:'CNY',merchantId:q.merchantId,kind:q.kind,baseCents:q.kind===kind?budgetCents-q.taxCents-q.feeCents:q.baseCents,taxCents:q.taxCents,feeCents:q.feeCents,totalCents:q.kind===kind?budgetCents:q.totalCents,refundable:q.kind===kind?false:q.refundable,expiresAt:new Date(now+900000).toISOString()}))}};
 return receiveTravelRequest(input,sessionId,envelope,signTravelEnvelope(envelope),now);
}
