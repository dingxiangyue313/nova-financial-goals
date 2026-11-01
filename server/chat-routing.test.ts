import test from 'node:test';import assert from 'node:assert/strict';
import {routeChat} from './chat-routing.ts';
test('explicit draft cancellation works without any model or financial tool',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('Model must not be called');};
 try{
  for(const message of ['取消刚才的任务','取消当前任务','请取消这个草稿']){
   const result=await routeChat(message,[],{destination:'transfer',status:'active'});
   assert.equal(result.decision.mode,'clarify');assert.equal('memoryAction' in result.decision?result.decision.memoryAction:null,'cancel');assert.equal(result.provider,'deterministic');
  }
 }finally{globalThis.fetch=original;}
});
test('return commands resolve the active task and do not revive cancelled drafts',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('Model must not be called');};
 try{
  for(const message of ['回到刚才那个','刚才那个页面','回去看看']){
   const active=await routeChat(message,[],{destination:'transfer',status:'active'});
   assert.equal(active.decision.mode,'navigate');assert.equal(active.decision.destination,'transfer');
   const cancelled=await routeChat(message,[],{destination:'transfer',status:'cancelled'});
   assert.equal(cancelled.decision.mode,'clarify');
  }
 }finally{globalThis.fetch=original;}
});
