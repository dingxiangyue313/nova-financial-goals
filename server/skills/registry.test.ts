import test from 'node:test';
import assert from 'node:assert/strict';
import { listSkillDefinitions,getEnabledSkill,assertSkillToolAllowed,routeMoneyMissionSkill,CORE_SKILL_IDS } from './registry.ts';
test('ten exact Skill definitions expose eight P0 skills and two disabled P1 skills',()=>{
  const definitions=listSkillDefinitions();assert.equal(definitions.length,10);
  assert.deepEqual(definitions.filter(s=>s.enabled).map(s=>s.id),CORE_SKILL_IDS);
  assert.throws(()=>getEnabledSkill('mandate_builder'),/SKILL_NOT_ENABLED/);
  assert.throws(()=>assertSkillToolAllowed('bill_and_subscription_investigator','execute_subscription_cancellation'),/SKILL_TOOL_FORBIDDEN/);
  assert.doesNotThrow(()=>assertSkillToolAllowed('outcome_monitor_and_replanner','search_repair_options'));
  assert.equal(routeMoneyMissionSkill('查一下CloudBox订阅','investigating'),'bill_and_subscription_investigator');
  assert.equal(routeMoneyMissionSkill('帮我生成给人工的问题包','investigating'),'human_handoff_case_pack');
  assert.equal(routeMoneyMissionSkill('解释这个结论的来源','monitoring'),'financial_explanation_and_provenance');
});
