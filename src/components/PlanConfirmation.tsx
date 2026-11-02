import type { GoalPlanChangeCandidate } from '../../shared/contracts';

export const planBlockingReason: Record<string, string> = {
  MONTHLY_CAPACITY_EXCEEDED: '超过每月可投入金额',
  FIRST_MONTH_BUFFER_NEGATIVE: '首月可用金额不足',
  PROTECTED_FUNDS_UNAVAILABLE: '保护资金不足',
  INSUFFICIENT_DATA: '数据不足，暂时不能确认',
  PLAN_NOT_AVAILABLE: '当前条件下不可执行',
  KEEP_DATE_NOT_FEASIBLE: '当前资金条件无法保持原目标日期',
  GOAL_DEADLINE_PASSED: '目标日期已过',
  FORECAST_HORIZON_INCOMPLETE: '目标日期超出当前可核算范围',
  AMBIGUOUS_SCHEDULE: '需重新核对存款安排',
};

export const money = (value: number) => `¥${(value / 100).toLocaleString('zh-CN')}`;

export function PlanCandidateCard({ candidate, title, selected, busy, onSelect }: {
  candidate: GoalPlanChangeCandidate;
  title?: string;
  selected: boolean;
  busy?: boolean;
  onSelect: () => void;
}) {
  return <button type="button" disabled={busy || !candidate.selectable} aria-pressed={selected}
    onClick={onSelect}
    className={`min-h-11 w-full rounded-xl border p-3 text-left disabled:cursor-not-allowed disabled:opacity-60 ${selected ? 'border-2 border-[#0F6B6D] bg-[#F2FAFA]' : 'border-[#D0D5DD] bg-white'}`}>
    <strong className="block text-sm">{title ?? candidate.label}{candidate.source === 'both' ? ' · NOVA 推荐' : ''}</strong>
    <span className="mt-1 block text-sm font-semibold">{money(candidate.monthlyCents)}/月</span>
    <span className="mt-1 block text-xs text-[#5A616B]">{candidate.explanation}</span>
    <span className="mt-1 block text-xs">预计完成 {candidate.projectedDate ?? '待补充数据'}</span>
    <span className="mt-1 block text-xs">首月缓冲 {money(candidate.safeToSpendCents)}</span>
    {candidate.blockingReasons.length > 0 && <span className="mt-1 block text-xs text-rose-700">
      {candidate.blockingReasons.map(reason => planBlockingReason[reason] ?? '需核对当前数据').join('；')}
    </span>}
  </button>;
}

export function PlanDifferenceTable({ rows }: { rows: Array<[string, string, string]> }) {
  return <table aria-label="计划调整前后对比" className="w-full text-left text-xs">
    <thead><tr className="text-[#5A616B]"><th className="py-1">项目</th><th>调整前</th><th>调整后</th></tr></thead>
    <tbody>{rows.map(([label, before, after]) => <tr key={label} className="border-t border-[#E5E8EB]">
      <th className="py-2 font-medium">{label}</th><td>{before}</td><td className="font-semibold text-[#0F6B6D]">{after}</td>
    </tr>)}</tbody>
  </table>;
}

export function TargetDateConfirmation({ candidate, accepted, onChange }: {
  candidate: GoalPlanChangeCandidate;
  accepted: boolean;
  onChange: (accepted: boolean) => void;
}) {
  if (!candidate.requiresTargetDateChange) return null;
  return <label className="flex min-h-11 items-center gap-2 text-xs">
    <input type="checkbox" checked={accepted} onChange={event => onChange(event.target.checked)} />
    同意将目标日期调整为 {candidate.effectiveTargetDate}（晚 {candidate.delayDays} 天）
  </label>;
}
