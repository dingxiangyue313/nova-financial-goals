import { z } from 'zod';
import { MissionSkillResultSchema,SkillDefinitionSchema,SkillIdSchema,type SkillId } from '../../shared/contracts.ts';

const entries = [
  ['statement_ingestion_and_reconciliation','账单导入、数据质量与对账',['read_import_quality','preview_statement_import']],
  ['bill_and_subscription_investigator','月账单、订阅和逐笔证据调查',['bill_period_summary','spending_baseline_comparison','subscription_candidates','evidence_detail','prepare_subscription_action']],
  ['dated_cashflow_forecast','按日期核算收入、账单与资金低谷',['dated_cashflow_forecast']],
  ['goal_portfolio_planner','生成目标方案并检测共享资金冲突',['dated_cashflow_forecast','build_goal_portfolio']],
  ['transfer_and_savings_executor','准备受控储蓄计划并查询执行结果',['simulate_transfer_schedule','get_transfer_schedule_status']],
  ['mandate_builder','可编辑外部授权（P1暂不启用）',[]],
  ['external_agent_request_inbox','已签名的外部请求收件箱（P1暂不启用）',[]],
  ['outcome_monitor_and_replanner','检查显著变化并生成只读修复建议',['read_material_outcomes','search_repair_options']],
  ['financial_explanation_and_provenance','说明事实、假设、预测与来源',['read_explanation_evidence']],
  ['human_handoff_case_pack','生成隐私最小化的人工问题包',['prepare_case_pack']],
] as const;
const definitions=entries.map(([id,description,tools])=>SkillDefinitionSchema.parse({id,version:'1.0.0',enabled:!['mandate_builder','external_agent_request_inbox'].includes(id),release:['mandate_builder','external_agent_request_inbox'].includes(id)?'p1_stretch':'p0',description,tools:[...tools],maxToolCalls:8,confirmationRequired:['statement_ingestion_and_reconciliation','bill_and_subscription_investigator','transfer_and_savings_executor'].includes(id)}));
export const CORE_SKILL_IDS=definitions.filter(s=>s.enabled).map(s=>s.id);
export const CoreSkillInputSchema=z.object({artifactId:z.string().max(200).optional()}).strict();
export const CoreSkillOutputSchema=MissionSkillResultSchema;
export function listSkillDefinitions(){return structuredClone(definitions);}
export function getEnabledSkill(id:string){const parsed=SkillIdSchema.parse(id);const definition=definitions.find(s=>s.id===parsed)!;if(!definition.enabled)throw new Error('SKILL_NOT_ENABLED');return structuredClone(definition);}
export function assertSkillToolAllowed(id:string,tool:string){const definition=getEnabledSkill(id);if(!definition.tools.includes(tool)||/^(execute|confirm|consume|activate)_/.test(tool))throw new Error('SKILL_TOOL_FORBIDDEN');}
export function isMoneyMissionRequest(text:string){return /账单|订阅|CloudBox|续费|导入|流水|现金流|证据|工资.*到账|储蓄计划|定时转|人工.*问题包|数据.*冲突|目标.*争用|多个目标|为什么.*最低/i.test(text);}
export function routeMoneyMissionSkill(intent:string,phase:string):SkillId {
  if(/人工|问题包|商户处理|无法解决|股票|贷款|保险产品/.test(intent))return 'human_handoff_case_pack';
  if(/授权|mandate/i.test(intent))return 'mandate_builder';
  if(/外部.*请求|收件箱/.test(intent))return 'external_agent_request_inbox';
  if(/导入|文件|数据覆盖|核对字段/.test(intent))return 'statement_ingestion_and_reconciliation';
  if(/储蓄计划|定时转|安排.*转|工资.*到账.*存|工资.*到账.*转/.test(intent))return 'transfer_and_savings_executor';
  if(/失败|跳过|重规划|监测|提醒.*变化/.test(intent)||phase==='monitoring')return 'outcome_monitor_and_replanner';
  if(/为什么|来源|解释|依据/.test(intent))return 'financial_explanation_and_provenance';
  if(/现金流|低谷|预测|工资延迟/.test(intent))return 'dated_cashflow_forecast';
  if(/目标.*争用|多个目标|方案|规划/.test(intent))return 'goal_portfolio_planner';
  return 'bill_and_subscription_investigator';
}

export function getSkillSchemas(id:SkillId){getEnabledSkill(id);return {input:CoreSkillInputSchema,output:CoreSkillOutputSchema.refine(result=>result.skillId===id,{message:'SKILL_OUTPUT_MISMATCH'})};}
