import test from 'node:test';
import assert from 'node:assert/strict';
import {cardImpact} from './card-impact.ts';
import {createJapanMoneyMissionFixture} from './money-mission-fixture.ts';
import {initializeServices,executeServiceAction} from './financial-services.ts';
import {serviceIssues} from './service-monitor.ts';
test('replacement resolves lost-card pending issue only after independent unlock; old card stays lost and cash stays unchanged',()=>{
 const base=initializeServices(createJapanMoneyMissionFixture());let s=executeServiceAction(base,{kind:'card',id:'card-travel',action:'lost'},'lost');
 assert.ok(serviceIssues(s).some(i=>i.sourceId==='card-travel'));s=executeServiceAction(s,{kind:'replace_card',id:'card-travel'},'replace');assert.equal(cardImpact(s.financialServices,'card-travel').replacementReady,false);
 s=executeServiceAction(s,{kind:'card',id:'replacement:replace',action:'unlock'},'unlock');assert.equal(cardImpact(s.financialServices,'card-travel').replacementReady,true);assert.equal(serviceIssues(s).some(i=>i.sourceId==='card-travel'),false);assert.equal(s.financialServices.cards.find(c=>c.id==='card-travel')!.status,'lost');assert.deepEqual(s.accounts,base.accounts);
});
