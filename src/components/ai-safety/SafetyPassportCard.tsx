import type { AiSafetyPassport, SkillId } from '../../../shared/contracts';

export const skillLabels: Record<SkillId, string> = {
  statement_ingestion_and_reconciliation: '账单导入与核对', bill_and_subscription_investigator: '账单与订阅调查',
  dated_cashflow_forecast: '现金流预测', goal_portfolio_planner: '目标规划', transfer_and_savings_executor: '转账与储蓄准备',
  mandate_builder: '授权范围设置', external_agent_request_inbox: '外部助手请求', outcome_monitor_and_replanner: '结果监测与调整',
  financial_explanation_and_provenance: '财务解释与证据', human_handoff_case_pack: '人工复核材料',
  recipient_and_split_coordinator: '收款人与分账', investment_lifecycle_manager: '投资流程管理', card_lifecycle_manager: '银行卡管理',
};
export function SafetyPassportCard({ passport: p }: { passport: AiSafetyPassport }) {
  return <article data-testid="safety-passport" className="rounded-xl border border-[#E5E8EB] bg-white p-4 space-y-2">
    <h3 className="font-bold">{skillLabels[p.skillId]}</h3>
    <p>◇ {p.enabled ? '已启用' : '未启用'} · AI 不可直接执行</p>
    <p>{p.riskClass === 'write' || p.riskClass === 'prepare_write' ? '需要你确认' : p.riskClass === 'recommend' ? '提供建议' : '只读查询'}</p>
    <p>{p.requiresEvidence ? '结论需要证据支持' : '按规则核对'} · {p.humanReview === 'required_before_write' ? '写操作前需人工确认' : '本能力不涉及写操作'}</p>
    <p>最多调用 {p.maxToolCalls} 次工具 · 超时后使用确定性只读功能</p>
    <details><summary className="cursor-pointer text-[#0F6B6D]">查看技术证据</summary><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(p, null, 2)}</pre></details>
  </article>;
}
