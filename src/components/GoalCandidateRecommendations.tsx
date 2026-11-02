import {useState} from 'react';
import type {AgentComponent} from '../../shared/contracts';
const money=(cents:number)=>`¥${(cents/100).toLocaleString('zh-CN')}`;
const planReason: Record<string, string> = {
  MONTHLY_CAPACITY_EXCEEDED: '超过每月可投入金额', FIRST_MONTH_BUFFER_NEGATIVE: '首月可用金额不足',
  PROTECTED_FUNDS_UNAVAILABLE: '会影响保护资金', INSUFFICIENT_DATA: '需要补充数据',
  GOAL_PRIORITY_CONFLICT: '与其他目标的预算冲突', FORECAST_HORIZON_INCOMPLETE: '超出当前可核算日期范围',
  GOAL_DEADLINE_PASSED: '目标日期已过', AMBIGUOUS_SCHEDULE: '需要核对存款安排',
};

export function GoalCandidateRecommendations({component,onSelectCandidate,busy}:{component:Extract<AgentComponent,{type:'candidate_recommendations'}>;onSelectCandidate:(resultId:string,threadId?:string)=>void;busy?:boolean}){
  const [selected,setSelected]=useState<number|null>(null);
  const first=component.items[0];
  const feasible=component.items.some(item=>item.selectable && item.status==='on_track' && item.resultId);
  const stages=[{title:'目标条件',body:first ? `目标预算 ${money(first.targetCents)} · 原目标日期 ${first.originalTargetDate ?? first.targetDate}` : '需要先补充目标条件'}, {title:'可行方案',body:`已核算 ${component.items.length} 个候选；月存金额、首月投入和完成日期见下方。`},{title:'确认计划',body:'选择适合自己的节奏，核对目标解释后再确认启用；不会自动扣款。'}];
  return <article className="rounded-2xl border border-[#D8E7E7] bg-[#F8FAFB] p-3 shadow-sm">
    <section aria-label="目标可行性结论" className="mb-3 flex gap-2.5 rounded-xl border border-[#E5E8EB] bg-white p-3.5 shadow-sm"><span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#E6F2F2] font-bold text-[#0F6B6D]">{feasible ? '✓' : '!'}</span><div><h4 className="text-sm font-bold">{feasible ? '按当前数据和假设，有可按时完成的方案' : '当前方案需要调整，请核对下方原因'}</h4><p className="mt-1 text-[11px] text-[#5A616B]">模拟数据核算 · 仍需你选择并确认</p></div></section>
    <section aria-label="推演与推进阶段" className="mb-4 rounded-xl border border-[#E5E8EB] bg-white p-3.5 shadow-sm"><h4 className="mb-3 text-xs font-bold">推演与推进阶段</h4><ol className="ml-3 space-y-2 border-l-2 border-[#E5E8EB] pl-5">{stages.map((stage,index)=><li key={stage.title} className="relative rounded-lg border border-[#E5E8EB] bg-[#F8FAFB] p-2.5"><span aria-hidden="true" className="absolute -left-[31px] top-3 grid h-5 w-5 place-items-center rounded-full bg-[#E6F2F2] text-[10px] font-semibold text-[#0F6B6D]">{index+1}</span><div className="flex justify-between text-[10px] text-[#5A616B]"><span>阶段 0{index+1}</span><span>{stage.title}</span></div><p className="mt-1 text-xs leading-5">{stage.body}</p></li>)}</ol></section>
    <div className="flex items-center justify-between gap-2"><h4 className="text-sm font-bold">{component.title}</h4><span className="text-[10px] text-[#5A616B]">请选择一种节奏</span></div><p className="mt-1 whitespace-pre-line text-[11px] leading-relaxed text-[#5A616B]">{component.body}</p>
    <div className="mt-2 space-y-2">{component.conditionalPlan && <div className="rounded-xl border border-[#D8E7E7] bg-[#F5FAFA] p-2.5 text-[11px]">
      <div className="flex justify-between font-semibold"><span>保守方案</span><span className="text-amber-700">需调整日期</span></div>
      <p className="mt-1">每月存 {money(component.conditionalPlan.monthlyContributionCents)} · 预计 {component.conditionalPlan.projectedDate} 完成</p>
      <p className="mt-1 text-[#5A616B]">每月留给日常的钱更多，但赶不上原目标日 {component.conditionalPlan.targetDate}。愿意延期的话，先修改目标日期再选择。</p>
    </div>}{component.items.map((item, index) => <div key={item.resultId ?? `user-${index}`} className={`rounded-xl border bg-white p-3 ${selected === index ? 'border-[#0F6B6D] ring-1 ring-[#0F6B6D]' : 'border-[#E5E8EB]'}`}>
      <label className="mb-2 flex min-h-11 cursor-pointer items-start gap-2.5"><input type="radio" name={`candidate-${component.id}`} aria-label={`选择${item.label || `方案 ${index + 1}`}`} checked={selected === index} disabled={busy || !item.selectable || !item.resultId} onChange={() => setSelected(index)} className="mt-0.5 h-5 w-5 shrink-0 accent-[#0F6B6D]"/><span><b className="text-[13px]">{item.label || `方案 ${index + 1}`} <span className="text-[#0F6B6D]">{money(item.monthlyContributionCents)} / 月</span></b><span className={`mt-1 block text-[11px] ${item.status === 'on_track' ? 'text-emerald-700' : 'text-amber-700'}`}>{item.status === 'on_track' ? '预计按时' : '存在延期风险'} · 预计 {item.projectedDate ?? '待补充数据'} 完成</span></span></label>
      <p className="mt-1 text-[11px] text-[#36404A]">{item.firstMonthContributionCents === undefined ? `每月存 ${money(item.monthlyContributionCents)}` : `首月存 ${money(item.firstMonthContributionCents)}，之后每月存 ${money(item.monthlyContributionCents)}`} · 预计 {item.projectedDate ?? '待补充数据'} 完成</p>
      <p className="mt-1 text-[11px] text-[#5A616B]">首月可用余量 {money(item.bufferCents)}。{item.firstMonthContributionCents === undefined ? '每个月保持同一笔存款。' : '先给这个月留出更多空间，之后再恢复月存。'}</p>
      <p className="mt-1 text-[11px] text-[#5A616B]">{item.firstMonthContributionCents === undefined
        ? '适合能稳定按月存这笔钱、想早一点完成的人。'
        : '适合这个月想留点余地，同时仍想赶上原定日期的人。'} 收入和日常支出若有变化，可以再重新计算。</p>
      <details open className="mt-3 border-t border-[#E5E8EB] pt-2 text-[11px] text-[#5A616B]"><summary className="cursor-pointer text-[#0F6B6D]">看看计算依据</summary>
        <p className="mt-1 whitespace-pre-line leading-relaxed">{item.explanation}</p></details>
      {item.source === 'both' && <p className="mt-1 text-xs font-semibold text-[#0F6B6D]">你的方案 · NOVA 推荐</p>}
      {item.delayDays > 0 && <p className="mt-1 text-xs text-amber-800">原目标日 {item.originalTargetDate}，预计晚 {item.delayDays} 天；确认时同时调整目标日期。</p>}
      {!item.selectable && <p role="status" className="mt-1 text-xs text-rose-700">暂不可选：{item.blockingReasons.map(reason => planReason[reason] ?? '请核对当前数据和目标条件').join('；')}</p>}
      <button type="button" disabled={busy || !item.selectable || !item.resultId} onClick={() => { setSelected(index); if (item.resultId) onSelectCandidate(item.resultId, component.taskThreadId); }} className="mt-2 min-h-11 w-full rounded-xl border border-[#0F6B6D] bg-white px-3 text-[11px] font-semibold text-[#0F6B6D] disabled:opacity-50">选择此候选并核对确认</button>
    </div>)}</div><p className="mt-2 text-[11px] text-[#5A616B]">你更想这个月轻松一些，还是早点完成？</p>
    <p className="mt-2 text-xs text-[#5A616B]">想换一个月存金额？直接告诉 NOVA，我会重新计算。</p>
  </article>;
}
