import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {createAgentThread,getChatMemory,saveChatMemory,getState} from './store.ts';
test('navigation memory persists per session and thread without touching balances or goals',()=>{
 const session=randomUUID(),other=randomUUID();const a=createAgentThread(session,{title:'a'}),b=createAgentThread(session,{title:'b'});const before=structuredClone(getState(session));
 saveChatMemory(session,a.id,{destination:'transfer',recipientQuery:'林夏',amountCents:30000,sourceAccount:'checking'});
 assert.equal(getChatMemory(session,a.id).amountCents,30000);assert.equal(getChatMemory(session,b.id).destination,null);assert.throws(()=>getChatMemory(other,a.id));
 saveChatMemory(session,a.id,{...getChatMemory(session,a.id),status:'cancelled'});assert.equal(getChatMemory(session,a.id).status,'cancelled');assert.deepEqual(getState(session),before);
});
