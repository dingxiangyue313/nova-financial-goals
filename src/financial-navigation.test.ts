import test from 'node:test';import assert from 'node:assert/strict';
import {ChatRouteDecisionSchema,chatDestinations} from '../shared/chat-routing';
test('all model routes map to existing pages and invalid routes cannot pass validation',()=>{
 for(const key of Object.keys(chatDestinations))assert.ok(ChatRouteDecisionSchema.safeParse({mode:'navigate',destination:key,question:null}).success);
 for(const data of [{mode:'navigate',destination:'execute_transfer',question:null},{mode:'navigate',destination:null,question:null},{mode:'chat',destination:'transfer',question:null}])assert.equal(ChatRouteDecisionSchema.safeParse(data).success,false);
});
