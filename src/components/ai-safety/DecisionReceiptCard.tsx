import { useEffect, useRef, useState } from 'react';
import type { AiSafetyDecisionReceipt, AgentReadToolName } from '../../../shared/contracts';
import { api } from '../../api';
import { skillLabels } from './SafetyPassportCard';
const tools: Record<AgentReadToolName, string> = {
  financial_overview: '财务概览', essential_bills: '必要账单', relevant_transactions: '相关交易核对', data_sufficiency: '数据覆盖核对',
  candidate_preview: '候选方案预览', search_goal_options: '目标方案试算', stress_test_goal_options: '方案压力测试', repair_stressed_goal_option: '方案调整',
  bill_period_summary: '账期汇总', spending_baseline_comparison: '消费基线对比', subscription_candidates: '订阅核对', evidence_detail: '证据核对', dated_cashflow_forecast: '现金流预测',
};
const confirmation = { not_required: '无需确认', awaiting_confirmation: '等待你确认', confirmed: '已确认', cancelled: '已取消', blocked: '已阻断' };
const fallback = { AGENT_RUN_BUDGET_EXHAUSTED: '调查预算用尽', AI_SAFE_MODE: '安全模式', MODEL_UNAVAILABLE: '模型不可用', MODEL_TIMEOUT: '模型超时', INVALID_MODEL_RESPONSE: '模型响应无效' };
export function DecisionReceiptCard({ runId, onClose }: { runId: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [receipt, setReceipt] = useState<AiSafetyDecisionReceipt | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { dialog.current?.close(); previous?.focus(); };
  }, []);
  useEffect(() => {
    let active = true;
    setReceipt(null); setError(false);
    void api<AiSafetyDecisionReceipt>(`/api/ai-safety/runs/${encodeURIComponent(runId)}/receipt`)
      .then(value => { if (active) setReceipt(value); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [runId]);
  return <dialog ref={dialog} aria-labelledby="decision-receipt-title" onCancel={event => { event.preventDefault(); onClose(); }} className="m-auto w-[calc(100%-2rem)] max-w-md max-h-[85dvh] overflow-y-auto rounded-2xl bg-white p-5 text-sm text-[#1F2329] backdrop:bg-black/40">
    <h2 id="decision-receipt-title" className="text-lg font-bold">AI 决策回执</h2>
    <button autoFocus type="button" onClick={onClose} className="mission-secondary my-3">关闭回执</button>
    {error ? <p role="alert">○ 回执暂不可用，尚未验证。</p> : !receipt ? <p role="status">正在读取回执…</p> : <div className="space-y-2">
      <p>运行结果：{({running:'进行中',completed:'已完成',awaiting_user:'等待补充信息',cancelled:'已取消',failed:'未完成',timed_out:'已超时',fallback:'已使用规则完成'})[receipt.status]}</p>
      <p>处理来源：{receipt.provider === 'deepseek' ? 'DeepSeek 模型' : receipt.provider === 'deterministic' ? '确定性规则' : '未记录'}</p>
      <p>降级原因：{receipt.fallbackReason ? fallback[receipt.fallbackReason] : '无记录'}</p>
      <p>能力：{receipt.skillId ? skillLabels[receipt.skillId] : '未记录'}</p>
      <p>工具计数：{receipt.toolCallCount} · 决策步骤：{receipt.decisionCount}</p>
      <ul>{receipt.tools.map((tool, index) => <li key={index}>{tools[tool.name]}：{({ ok: '已完成', insufficient_data: '数据不足', constraint_violation: '触及边界', unsupported: '暂不支持' })[tool.status]}</li>)}</ul>
      <p>证据引用：{receipt.evidenceIds.length} 项 · 数据版本：{receipt.twinVersion ?? '未记录'}</p>
      <p>人审状态：{confirmation[receipt.confirmationStatus]} · {receipt.requiresHumanConfirmation ? '需要人工确认' : '无需人工确认'}</p>
      <p>{receipt.auditChainValid ? '◇ 审计链验证通过' : '⚠ 审计链未通过验证'}</p>
      <details><summary className="text-[#0F6B6D]">查看技术证据</summary><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(receipt, null, 2)}</pre></details>
    </div>}
  </dialog>;
}
