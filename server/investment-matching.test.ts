import test from 'node:test';
import assert from 'node:assert/strict';
import {InvestmentAnswersSchema,investmentRiskLevel,type InvestmentAnswers} from '../shared/investment-profile.ts';
import {DemoStateSchema} from '../shared/contracts.ts';
import {createJapanMoneyMissionFixture} from './money-mission-fixture.ts';
import {initializeServices,executeServiceAction,describeServiceAction,investmentProducts,validateServiceBalances} from './financial-services.ts';
import {compareInvestments,investmentMatch} from './investment-matching.ts';
const answers:InvestmentAnswers={purpose:'education',useByDate:'2027-06-30',lossToleranceBps:1500,liquidity:'quarter',experience:'basic',incomeStability:'stable',understandsRisk:true};
const base=()=>initializeServices(createJapanMoneyMissionFixture());
test('questionnaire is complete and deterministic; loss, experience, income and reserve impose hard ceilings',()=>{
 assert.equal(investmentRiskLevel(answers),2);assert.equal(investmentRiskLevel({...answers,lossToleranceBps:0}),0);
 assert.equal(investmentRiskLevel({...answers,purpose:'reserve'}),0);assert.equal(investmentRiskLevel({...answers,understandsRisk:false}),0);
 assert.equal(investmentRiskLevel({...answers,experience:'none'}),1);assert.equal(investmentRiskLevel({...answers,incomeStability:'irregular'}),1);
 assert.equal(investmentRiskLevel({...answers,experience:'experienced',lossToleranceBps:1500}),4);
 const {experience:_e,...partial}=answers;assert.equal(InvestmentAnswersSchema.safeParse(partial).success,false);
});
test('confirmed questionnaire preserves money and binds execution to the same matching rules',()=>{
 const state=base(),before=structuredClone(state),preview=describeServiceAction(state,{kind:'investment_questionnaire',answers});
 assert.deepEqual(state,before);assert.match(preview.label,/最多承受15%/);
 const next=executeServiceAction(state,{kind:'investment_questionnaire',answers},'risk');validateServiceBalances(state,next);
 assert.deepEqual(next.accounts,state.accounts);assert.deepEqual(next.finance,state.finance);assert.equal(next.financialServices.risk!.expiresOn,'2027-04-24');
 assert.ok(DemoStateSchema.safeParse(next).success);assert.deepEqual(next.financialServices.risk!.answers,answers);
 assert.doesNotThrow(()=>describeServiceAction(next,{kind:'buy',productId:'steady',accountId:'checking',amountCents:100000}));
 assert.throws(()=>describeServiceAction(next,{kind:'buy',productId:'growth',accountId:'checking',amountCents:100000}),/NOT_SUITABLE/);
 const liquid=executeServiceAction(state,{kind:'investment_questionnaire',answers:{...answers,liquidity:'anytime'}},'anytime');
 assert.equal(compareInvestments(liquid,investmentProducts,100000).matched.length,0);
 assert.throws(()=>describeServiceAction(liquid,{kind:'buy',productId:'liquid',accountId:'checking',amountCents:100000}),/NOT_SUITABLE/);
});
test('comparison is read-only, limited to three, exact fee cents, cash first and no invented yield probability',()=>{
 const state=executeServiceAction(base(),{kind:'investment_questionnaire',answers},'risk'),before=structuredClone(state);
 const model=compareInvestments(state,investmentProducts,100000);assert.equal(model.matched.length,3);assert.deepEqual(model.matched.map(p=>p.id),['liquid','steady','term90']);
 const steady=model.matched.find(p=>p.id==='steady')!;assert.equal(steady.buyFeeCents,200);assert.equal(steady.baselineNetCents,99600);assert.equal(steady.stressNetCents,94620);
 assert.equal(model.cash.feeCents,0);assert.deepEqual(state,before);assert.equal(compareInvestments(base(),investmentProducts,100000).matched.length,0);
 assert.throws(()=>compareInvestments(state,investmentProducts,0),/INVALID_CENTS/);
});
test('short liquidity, expiry, mismatched answers and earliest-use deadlines fail closed',()=>{
 const state=executeServiceAction(base(),{kind:'investment_questionnaire',answers:{...answers,liquidity:'week'}},'risk');
 assert.deepEqual(compareInvestments(state,investmentProducts,100000).matched.map(p=>p.id),['liquid']);
 assert.equal(investmentMatch({...state,clock:'2027-04-25'},investmentProducts[0]).suitable,false);
 state.financialServices.risk!.level=4;assert.equal(investmentMatch(state,investmentProducts[0]).suitable,false);
 const short=executeServiceAction(base(),{kind:'investment_questionnaire',answers:{...answers,useByDate:'2026-10-27'}},'short');
 assert.equal(compareInvestments(short,investmentProducts,100000).matched.length,0);
 assert.throws(()=>describeServiceAction(base(),{kind:'investment_questionnaire',answers:{...answers,useByDate:'2026-10-26'}}),/USE_DATE_PASSED/);
});
test('loss tolerance includes purchase and redemption fees at the exact amount',()=>{
 const state=executeServiceAction(base(),{kind:'investment_questionnaire',answers:{...answers,lossToleranceBps:500}},'risk');
 const model=compareInvestments(state,investmentProducts,100000);
 assert.deepEqual(model.matched.map(p=>p.id),['liquid']);
 assert.ok(model.excluded.find(p=>p.id==='steady')!.reasons.some(r=>r.includes('申赎费用')));
 assert.throws(()=>describeServiceAction(state,{kind:'buy',productId:'steady',accountId:'checking',amountCents:100000}),/NOT_SUITABLE/);
});
