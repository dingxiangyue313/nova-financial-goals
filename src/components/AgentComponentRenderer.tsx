import type { AgentComponent } from '../../shared/contracts';
import { normalizeAgentComponent } from '../../shared/generative';
import type { ScreenId } from '../types';

const money = (cents: number) => `¥${(cents / 100).toLocaleString('zh-CN')}`;
const tone = {
  neutral: 'border-[#E5E8EB] bg-white', good: 'border-emerald-200 bg-emerald-50',
  warning: 'border-amber-200 bg-amber-50', danger: 'border-rose-200 bg-rose-50',
};

export function AgentComponentRenderer({ value, onAction, onCancel, onNavigate, busy }: {
  value: unknown; onAction: (actionId: string) => void; onCancel: (actionId: string) => void;
  onNavigate: (screen: ScreenId) => void; busy?: boolean;
}) {
  const component = normalizeAgentComponent(value);
  if (component.type === 'goal_summary') return <article className="rounded-2xl border border-[#D8E7E7] bg-white p-3 shadow-sm">
    <div className="text-[11px] font-semibold text-[#0F6B6D]">目标草案</div>
    <h4 className="mt-1 text-[15px] font-bold">{component.goal.title}</h4>
    <div className="mt-2 grid grid-cols-2 gap-2 text-[12px] text-[#646A73]">
      <div className="rounded-xl bg-[#F5F7F8] p-2"><span className="block text-[10px]">目标金额</span><b className="text-[#1F2329]">{money(component.goal.targetCents)}</b></div>
      <div className="rounded-xl bg-[#F5F7F8] p-2"><span className="block text-[10px]">目标日期</span><b className="text-[#1F2329]">{component.goal.targetDate}</b></div>
      <div className="col-span-2 rounded-xl bg-[#EBF7F2] p-2 text-[#2E7D5B]">应急金 {money(component.goal.protectedCents)} 严格隔离</div>
    </div>
    <button onClick={() => onNavigate('create_goal')} className="mt-2 text-[11px] font-semibold text-[#0F6B6D]">打开目标详情 →</button>
  </article>;
  if (component.type === 'feasibility') return <article className="rounded-2xl border border-[#D8E7E7] bg-white p-3 shadow-sm">
    <div className="flex items-center justify-between"><h4 className="text-[14px] font-bold">{component.title}</h4><span className="rounded-full bg-[#EBF7F2] px-2 py-1 text-[10px] font-semibold text-[#2E7D5B]">{component.assessment.status}</span></div>
    <p className="mt-2 text-[12px] text-[#646A73]">{component.assessment.dataSufficiency} · 预计月存 {money(component.assessment.requiredMonthlyCents)}</p><button onClick={() => onNavigate('feasibility')} className="mt-2 text-[11px] font-semibold text-[#0F6B6D]">打开可行性详情 →</button>
  </article>;
  if (component.type === 'plan_compare') return <article className="rounded-2xl border border-[#D8E7E7] bg-white p-3 shadow-sm">
    <h4 className="text-[14px] font-bold">{component.title}</h4>
    <div className="mt-2 space-y-1.5">{component.plans.map(plan => <div key={plan.id} className={`rounded-xl border p-2 ${plan.recommended ? 'border-[#0F6B6D] bg-[#F2FAFA]' : 'border-[#E5E8EB]'}`}>
      <div className="flex justify-between text-[12px] font-semibold"><span>{plan.label}{plan.recommended ? ' · NOVA 推荐' : ''}</span><span>{money(plan.monthlyCents)}/月</span></div>
      <p className="mt-1 text-[11px] text-[#646A73]">{plan.explanation}</p>
    </div>)}</div>
  </article>;
  if (component.type === 'impact_summary') return <article className="rounded-2xl border border-amber-200 bg-amber-50 p-3 shadow-sm">
    <div className="text-[11px] font-semibold text-amber-700">目标影响信号</div><h4 className="mt-1 text-[14px] font-bold">{component.title}</h4>
    <p className="mt-2 text-[12px] text-[#646A73]">新增支出 {money(component.impact.expenseCents)}，预计延期 {component.impact.delayDays} 天。</p>
    <p className="mt-2 rounded-lg bg-white/80 p-2 text-[11px] font-semibold text-[#2E7D5B]">应急金 {money(component.protectedCents)} 未受影响</p><button onClick={() => onNavigate('impact')} className="mt-2 text-[11px] font-semibold text-[#0F6B6D]">打开影响详情 →</button>
  </article>;
  if (component.type === 'risk_signal') return <article className="rounded-2xl border border-amber-200 bg-amber-50 p-3 shadow-sm">
    <div className="text-[11px] font-semibold text-amber-700">目标感知风险</div>
    <h4 className="mt-1 text-[14px] font-bold">{component.title}</h4>
    <div className="mt-3 rounded-xl bg-white/80 p-2.5">
      <div className="text-[11px] font-bold">哪些流水形成趋势</div>
      <p className="mt-1 text-[11px] text-[#646A73]">过去两个月平均 {money(component.pattern.baselineCents)}，本期 {component.pattern.transactionCount} 笔累计 {money(component.pattern.currentCents)}。</p>
    </div>
    <div className="mt-2 rounded-xl bg-white/80 p-2.5 text-[11px] text-[#646A73]">
      <b className="text-[#1F2329]">具体影响</b> · 目标预计延期 {component.signal.impact.delayDays} 天；应急金 {money(component.protectedCents)} 未受影响。
    </div>
    <div className="mt-2 space-y-1 text-[11px]"><div className="rounded-lg border border-amber-100 bg-white px-2 py-1.5">1. 降低未来可选支出</div><div className="rounded-lg border border-amber-100 bg-white px-2 py-1.5">2. 增加目标投入</div><div className="rounded-lg border border-amber-100 bg-white px-2 py-1.5">3. 调整目标日期</div></div>
  </article>;
  if (component.type === 'mandate_preview') return <article className="rounded-2xl border border-[#D8E7E7] bg-white p-3 shadow-sm">
    <div className="text-[11px] font-semibold text-[#0F6B6D]">受控自主执行</div><h4 className="mt-1 text-[14px] font-bold">{component.title}</h4>
    <dl className="mt-2 grid grid-cols-2 gap-2 text-[11px]"><div><dt className="text-[#646A73]">用途</dt><dd>{component.mandate.category}</dd></div><div><dt className="text-[#646A73]">单笔上限</dt><dd>{money(component.mandate.maxPerOperationCents)}</dd></div><div><dt className="text-[#646A73]">累计上限</dt><dd>{money(component.mandate.totalLimitCents)}</dd></div><div><dt className="text-[#646A73]">有效期</dt><dd>{component.mandate.expiresAt}</dd></div></dl><button onClick={() => onNavigate('banking_demo')} className="mt-2 text-[11px] font-semibold text-[#0F6B6D]">打开授权与执行记录 →</button>
  </article>;
  if (component.type === 'confirmation') return <article className={`rounded-2xl border p-3 shadow-sm ${tone[component.tone]}`}>
    <div className="text-[10px] font-semibold uppercase tracking-wide text-[#8A6A13]">需要你明确确认</div><h4 className="mt-1 text-[14px] font-bold">{component.title}</h4>
    <p className="mt-1 text-[12px] leading-relaxed text-[#646A73]">{component.body}</p>
    <div className="mt-3 grid grid-cols-[1fr_auto] gap-2"><button disabled={busy} onClick={() => onAction(component.action.actionId)} className="min-h-11 rounded-xl bg-[#0F6B6D] px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-50">{busy ? '正在执行…' : component.action.label}</button><button disabled={busy} onClick={() => onCancel(component.action.actionId)} className="min-h-11 rounded-xl border border-[#D0D5DD] bg-white px-3 text-[12px] text-[#646A73]">取消</button></div>
  </article>;
  if (component.type === 'receipt') return <article className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 shadow-sm">
    <div className="text-[10px] font-bold text-emerald-700">{component.status.toUpperCase()}</div><h4 className="mt-1 text-[14px] font-bold">{component.title}</h4><p className="mt-1 text-[12px] text-[#47605A]">{component.body}</p>
  </article>;
  if (component.type === 'audit_summary') return <article className="rounded-2xl border border-[#D8E7E7] bg-white p-3"><h4 className="text-[13px] font-bold">{component.title}</h4><p className="mt-1 text-[11px] text-[#646A73]">{component.body}</p><span className="mt-2 inline-block rounded-full bg-[#EBF7F2] px-2 py-1 text-[10px] text-[#2E7D5B]">Hash 链{component.chainValid ? '有效' : '异常'}</span><button onClick={() => onNavigate('activity')} className="ml-2 text-[11px] font-semibold text-[#0F6B6D]">查看审计 →</button></article>;
  if (component.type === 'clarification') return <article className="rounded-2xl border border-[#D8E7E7] bg-white p-3"><h4 className="text-[13px] font-bold">{component.title}</h4><p className="mt-1 text-[12px] text-[#646A73]">{component.body}</p></article>;
  const fallbackTone = component.type === 'error_recovery' ? 'warning' : component.tone;
  return <article className={`rounded-2xl border p-3 ${tone[fallbackTone]}`}><h4 className="text-[13px] font-bold">{component.title}</h4><p className="mt-1 text-[12px] leading-relaxed text-[#646A73]">{component.body}</p></article>;
}
