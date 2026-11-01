import type { Goal } from '../../shared/contracts';

export const goalStatus = { draft: '待启用', active: '推进中', paused: '已暂停', achieved: '已完成' };
const money = (cents: number) => `¥${(cents / 100).toLocaleString('zh-CN')}`;

export function GoalDetailScreen({ goal }: { goal: Goal }) {
  const progress = Math.min(100, goal.savedCents / Math.max(1, goal.targetCents) * 100);
  return <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 no-scrollbar">
    <section className="rounded-xl border border-[#E5E8EB] bg-white p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-2"><h2 className="text-[20px] font-bold">{goal.title}</h2><span className="rounded-full bg-[#E6F2F2] px-2 py-1 text-[11px] text-[#0F6B6D]">{goalStatus[goal.status]}</span></div>
      <p className="text-[12px] text-[#5A616B]">{goal.quote}</p>
      <p className="text-[22px] font-bold text-[#0F6B6D]">{money(goal.savedCents)}<span className="ml-2 text-[13px] font-normal text-[#5A616B]">/ {money(goal.targetCents)}</span></p>
      <div className="h-2 overflow-hidden rounded-full bg-[#F0F2F5]"><div className="h-full rounded-full bg-[#0F6B6D]" style={{ width: `${progress}%` }} /></div>
      <p className="text-[12px] text-[#5A616B]">已完成 {progress.toFixed(0)}% · 还需 {money(Math.max(0, goal.targetCents - goal.savedCents))}</p>
    </section>
    <section className="rounded-xl border border-[#E5E8EB] bg-white p-4 shadow-sm space-y-3">
      <h3 className="text-[15px] font-bold">资金计划</h3>
      <dl className="space-y-3 text-[13px]">
        <div className="flex justify-between"><dt className="text-[#5A616B]">目标日期</dt><dd>{goal.targetDate.replace(/-/g, ' / ')}</dd></div>
        <div className="flex justify-between"><dt className="text-[#5A616B]">每月计划</dt><dd>{money(goal.monthlyContributionCents)}</dd></div>
        <div className="flex justify-between"><dt className="text-[#5A616B]">应急金保护底线</dt><dd>{money(goal.protectedCents)}</dd></div>
      </dl>
      <p className="rounded-lg bg-[#F5F7F8] p-3 text-[12px] leading-relaxed text-[#5A616B]">{goal.status === 'achieved' ? '目标资金已备齐，可以按需要安排使用。' : goal.status === 'paused' ? '计划已暂停，已存资金保留，继续前请重新核对资金安排。' : goal.status === 'draft' ? '计划尚未启用，确认资金安排后再开始推进。' : '按当前计划积累，实际完成情况取决于后续收入、支出与投入。'}模拟进度仅供演示，未设置自动转账。</p>
    </section>
  </div>;
}
