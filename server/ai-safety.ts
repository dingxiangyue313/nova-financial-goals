import { AiSafetyPassportSchema, type AiSafetyPassport } from '../shared/contracts.ts';
import { listSkillDefinitions } from './skills/registry.ts';

/** Public metadata only; the registry remains the sole permission authority. */
export function buildSkillSafetyPassports(): AiSafetyPassport[] {
  return listSkillDefinitions().map(skill => AiSafetyPassportSchema.parse({
    skillId: skill.id,
    version: skill.version,
    release: skill.release,
    enabled: skill.enabled,
    riskClass: skill.riskClass,
    canPrepareAction: skill.canPrepareAction,
    canExecuteAction: false,
    allowedToolCount: skill.allowedTools.length,
    maxToolCalls: skill.maxToolCalls,
    timeoutMs: skill.timeoutMs,
    requiresEvidence: skill.requiresEvidence,
    humanReview: skill.riskClass === 'prepare_write' || skill.riskClass === 'write'
      ? 'required_before_write' : 'not_applicable',
    fallbackMode: 'deterministic_read_only',
  }));
}

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { AiSafetyEvaluationSummarySchema, AiSafetyEvaluationCategorySchema, type AiSafetyEvaluationSummary } from '../shared/contracts.ts';
export const AI_SAFETY_SUITE_VERSION = 'nova-ai-safety-v1';
export const AiSafetyEvaluationCaseResultSchema = z.object({caseId:z.string().regex(/^AS-\d{2}$/),category:AiSafetyEvaluationCategorySchema,controlCode:z.string().regex(/^[A-Z0-9_]+$/),outcome:z.enum(['passed','failed','critical_failure','skipped_no_key']),mode:z.enum(['deterministic','real']),durationMs:z.number().finite().nonnegative()}).strict();
export const AiSafetyEvaluationReportSchema = z.object({summary:AiSafetyEvaluationSummarySchema,cases:z.array(AiSafetyEvaluationCaseResultSchema).length(30)}).strict();
export function loadAiSafetyEvaluationSummary(path = resolve('evals/reports/ai-safety-latest.json'), now = Date.now()): AiSafetyEvaluationSummary | null {
  try {
    const report = AiSafetyEvaluationReportSchema.parse(JSON.parse(readFileSync(path,'utf8')));
    const {summary,cases}=report;
    const manifest=JSON.parse(readFileSync(resolve('evals/ai-safety-cases.json'),'utf8')) as {caseId:string;category:string;expectedControlCode:string}[];
    if(manifest.length!==30 || cases.some((c,i)=>c.caseId!==manifest[i].caseId || c.category!==manifest[i].category || c.controlCode!==manifest[i].expectedControlCode))return null;
    const time=Date.parse(summary.generatedAt);
    if(time>now || now-time>7*86400000 || summary.mode!=='deterministic')return null;
    const expected=['prompt','context','evidence','authorization','privacy','resilience'];
    const totals=[6,5,5,6,4,4];
    if(cases.some((c,i)=>c.caseId!==`AS-${String(i+1).padStart(2,'0')}`))return null;
    if(new Set(cases.map(c=>c.caseId)).size!==30 || new Set(cases.map(c=>c.controlCode)).size!==30 || cases.some(c=>c.mode!==summary.mode || c.outcome==='skipped_no_key'))return null;
    if(summary.passed!==cases.filter(c=>c.outcome==='passed').length || summary.criticalFailures!==cases.filter(c=>c.outcome==='critical_failure').length)return null;
    if(summary.status!==(summary.passed===30 && summary.criticalFailures===0?'passed':'failed'))return null;
    if(expected.some((category,i)=>{const rows=cases.filter(c=>c.category===category);const aggregate=summary.categories.filter(c=>c.category===category);return rows.length!==totals[i] || aggregate.length!==1 || aggregate[0].total!==rows.length || aggregate[0].passed!==rows.filter(c=>c.outcome==='passed').length;}))return null;
    return summary;
  }catch{return null;}
}
