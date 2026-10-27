import type { GoalPlanOption } from '../../../shared/money-mission';
import { money } from '../../lib/format';

export function PlanComparison({
  plans,
  savedCents,
  targetCents,
  selectedLabel,
  onSelect
}: {
  plans: GoalPlanOption[];
  savedCents: number;
  targetCents: number;
  selectedLabel: string;
  onSelect: (plan: GoalPlanOption) => void;
}) {
  return (
    <section className="mission-card">
      <span className="text-xs text-[#0F6B6D]">日本旅行 · 2027年6月30日前</span>
      <h2 className="text-[19px] font-bold">为旅行选一个舒服的节奏</h2>
      <p>已存 {money(savedCents)} / {money(targetCents)}。应急金 ¥20,000 独立保护，三个方案都不动用。</p>
      {plans.map(plan => (
        <button key={plan.id} type="button" aria-pressed={selectedLabel === plan.label} className={`mission-secondary text-left ${selectedLabel === plan.label ? '!border-[#0F6B6D] !bg-[#E6F2F2]' : ''}`} onClick={() => onSelect(plan)}>
          <strong>{plan.label}{plan.label === '平衡' ? ' · 推荐' : ''}</strong>
          <span className="block text-xs mt-1">
            {plan.upfrontCents > 0 ? `先转${money(plan.upfrontCents)}，再` : ''}每月 {money(plan.monthlyCents)} · {plan.occurrences}次 · 预计 {plan.projectedDate ?? '待核对'}
          </span>
          {plan.conflicts.map(item => <span key={item} className="block text-xs text-amber-800 mt-1">{item}</span>)}
        </button>
      ))}
      <p className="text-xs">日期假设工资按时到账。加速方案须先单独确认一次性转入，再创建月度计划。</p>
    </section>
  );
}
