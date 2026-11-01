import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYuan, parseGoalDate, understandGoalMessage } from './understanding.ts';

test('goal amounts preserve units and cents rather than truncating numeric prefixes', () => {
  for (const [input, expected] of [['1.2万',1200000],['2.35万元',2350000],['1.5千',150000],['12,500.50元',1250050],['八千',800000]] as const)
    assert.equal(parseYuan(input), expected, input);
  assert.equal(parseYuan('1.234元'), null);
});

test('relative year and month ends use the business clock', () => {
  for (const [input, expected] of [['明年六月底','2027-06-30'],['明年12月31日','2027-12-31'],['后年年底','2028-12-31'],['今年十二月底','2026-12-31'],['三个月后','2027-01-26']] as const)
    assert.equal(parseGoalDate(input,'2026-10-26'), expected, input);
  assert.equal(parseGoalDate('2027年2月30日','2026-10-26'),null);
});

test('goal extraction handles natural savings wording and monthly caps without a model', async () => {
  const previous=process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    for (const prefix of ['每月最多1000元','每个月最多存1000元','每月上限1000元','每月不超过1000元']) {
      const result=await understandGoalMessage(`我想明年六月底前存1.2万元去日本旅行，已存2000元，${prefix}，应急金20000元不能动。`,'2026-10-26',null);
      assert.deepEqual(result.changes.targetCents,{op:'set',value:1200000});
      assert.deepEqual(result.changes.targetDate,{op:'set',value:'2027-06-30'});
      assert.deepEqual(result.changes.savedCents,{op:'set',value:200000});
      assert.deepEqual(result.changes.monthlyContributionCapCents,{op:'set',value:100000},prefix);
      assert.deepEqual(result.changes.protectedCents,{op:'set',value:2000000});
    }
    const monthly=await understandGoalMessage('每月存1000元，已存2000元。','2026-10-26',null);
    assert.equal(monthly.changes.targetCents,undefined);
  } finally { if(previous===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=previous; }
});


test('model semantic patches accept grounded amounts without fixed budget prefixes',async()=>{
 const fetchBefore=globalThis.fetch,keyBefore=process.env.DEEPSEEK_API_KEY;
 process.env.DEEPSEEK_API_KEY='test-only';
 globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({kind:'supplement',titleQuote:null,amountQuote:null,amountField:null,dateQuote:'明年暑假',datePrecision:'approximate',dateQuestion:null,amountPatches:[{field:'targetCents',quote:'10000'},{field:'savedCents',quote:'2000'}]})}}]}),{headers:{'content-type':'application/json'}});
 try{
  const result=await understandGoalMessage('合起来10000，已经留了2000，明年暑假去。','2026-10-26',null);
  assert.deepEqual(result.changes.targetCents,{op:'set',value:1000000});
  assert.deepEqual(result.changes.savedCents,{op:'set',value:200000});
  assert.deepEqual(result.changes.targetDate,{op:'clear'});
  assert.match(result.ambiguity!,/明年暑假/);
 }finally{globalThis.fetch=fetchBefore;if(keyBefore===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=keyBefore;}
});
