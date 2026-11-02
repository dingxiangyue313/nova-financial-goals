import test from 'node:test';import assert from 'node:assert/strict';
import {routeChat} from './chat-routing.ts';
test('route calls semantic interpretation once',async()=>{
 const original=globalThis.fetch,key=process.env.DEEPSEEK_API_KEY;let calls=0;
 try{
  process.env.DEEPSEEK_API_KEY='test';
  globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({operation:'goal',lifecycle:'new',taskId:null,capability:null,patches:[],transfer:{recipient:null,amount:null,account:null},timeHint:null,question:null,answer:null})}}]}));};
  const r=await routeChat('想存钱买车');assert.equal(r.decision.chatIntent,'goal_planning');assert.equal(calls,1);
 }finally{globalThis.fetch=original;if(key===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=key;}
});
