import {createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
import {ProviderEventSchema,type ProviderEvent} from '../shared/financial-services.ts';
import type {DemoState} from '../shared/contracts.ts';
import {stableHash,appendAuditEvent} from './governance.ts';
import {reconcileServices} from './financial-services.ts';
const key=process.env.NOVA_EXTERNAL_AGENT_SECRET||process.env.NOVA_SESSION_SECRET||randomUUID();
export function signProviderEvent(sessionId:string,event:ProviderEvent){return createHmac('sha256',key).update(stableHash({sessionId,event:ProviderEventSchema.parse(event)})).digest('hex');}
export function applyProviderEvent(input:DemoState,sessionId:string,raw:unknown,signature:string):DemoState{
 const event=ProviderEventSchema.parse(raw),expected=signProviderEvent(sessionId,event);
 if(!/^[a-f0-9]{64}$/.test(signature)||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))throw new Error('SERVICE_PROVIDER_SIGNATURE_INVALID');
 if(event.reportedOn>input.clock)throw new Error('SERVICE_PROVIDER_EVENT_FUTURE');
 const d=input.financialServices,hash=stableHash(event),seen=d.providerEventLog.find(e=>e.id===event.id);
 if(seen){if(seen.payloadHash!==hash)throw new Error('SERVICE_PROVIDER_EVENT_CONFLICT');return input;}
 if(event.domain==='investment'&&!['pending','settled','failed'].includes(event.status)||event.domain==='booking'&&!['pending','confirmed','failed'].includes(event.status))throw new Error('SERVICE_PROVIDER_STATUS_INVALID');
 const target=event.domain==='investment'?d.investments.find(o=>o.id===event.subjectId):d.bookings.find(o=>o.id===event.subjectId);if(!target)throw new Error('SERVICE_PROVIDER_SUBJECT_NOT_FOUND');
 const originalReceipt=d.receipts.find(r=>r.operationId===target.operationId);if(originalReceipt&&event.reportedOn<originalReceipt.date)throw new Error('SERVICE_PROVIDER_EVENT_BEFORE_OPERATION');
 const cursor=d.providerRevisions.find(r=>r.domain===event.domain&&r.subjectId===event.subjectId);
 let outcome:'applied'|'stale'|'terminal_ignored'=cursor&&event.revision<=cursor.revision?'stale':'applied';
 const terminal=event.domain==='investment'?(['settled','failed'].includes(target.status)||('externalRevision' in target&&Boolean(target.externalRevision)&&target.providerStatus==='settled')):['confirmed','failed','cancelled','refund_pending','refunded'].includes(target.status);
 if(outcome==='applied'&&terminal)outcome='terminal_ignored';
 const s=structuredClone(input),next=s.financialServices;
 next.providerEventLog.push({id:event.id,payloadHash:hash,subjectId:event.subjectId,domain:event.domain,revision:event.revision,outcome,reportedOn:event.reportedOn});
 if(outcome!=='stale'){next.providerRevisions=next.providerRevisions.filter(r=>r.domain!==event.domain||r.subjectId!==event.subjectId);next.providerRevisions.push({subjectId:event.subjectId,domain:event.domain,revision:event.revision});}
 if(outcome==='applied'){
  if(event.domain==='investment'){const o=next.investments.find(o=>o.id===event.subjectId)!;o.externalRevision=event.revision;o.providerStatus=event.status as 'pending'|'settled'|'failed';}
  else next.bookings.find(o=>o.id===event.subjectId)!.providerStatus=event.status as 'pending'|'confirmed'|'failed';
 }
 s.twinVersion++;
 const recorded=appendAuditEvent(s,'simulated_provider_event',outcome,'已核对模拟服务身份、会话、原操作与事件版本；不创建新付款。',{operationId:event.subjectId});
 return outcome==='applied'?reconcileServices(recorded,event.subjectId):recorded;
}
