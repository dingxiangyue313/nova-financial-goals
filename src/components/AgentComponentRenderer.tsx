import { useEffect, useState } from 'react';
import type { AgentComponent, GoalAssumptions, RiskPreferences } from '../../shared/contracts';
import { normalizeAgentComponent } from '../../shared/generative';
import type { ScreenId } from '../types';

const money = (cents: number) => `¥${(cents / 100).toLocaleString('zh-CN')}`;
const sourceName = { bank: '银行卡', wechat_pay: '微信支付', alipay: '支付宝' } as const;
const fieldSourceName: Record<string, string> = { user_provided: '用户提供', connected_data: '连接数据',
  system_calculated: '系统计算', default_assumption: '默认假设' };
const tone = {
  neutral: 'border-[#E5E8EB] bg-white', good: 'border-emerald-200 bg-emerald-50',
  warning: 'border-amber-200 bg-amber-50', danger: 'border-rose-200 bg-rose-50',
};

function AssumptionEditor({ assumptions, twinVersion, onPreview, busy }: {
  assumptions: GoalAssumptions; twinVersion: number;
  onPreview?: (assumptions: GoalAssumptions, twinVersion: number) => void; busy?: boolean;
}) {
  const [draft, setDraft] = useState(assumptions);
  const amount = (key: 'targetCents' | 'monthlyContributionCents' | 'protectedCents', value: string) =>
    setDraft(current => ({ ...current, [key]: Math.max(0, Math.round(Number(value || 0) * 100)) }));
  return <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
    <label className="col-span-2"><span className="mb-1 block text-[#5A616B]">目标金额（元）</span><input aria-label="目标金额" type="number" min="1" value={draft.targetCents / 100} onChange={event => amount('targetCents', event.target.value)} className="w-full rounded-lg border border-[#D0D5DD] px-3 py-2" /></label>
    <label><span className="mb-1 block text-[#5A616B]">目标日期</span><input aria-label="目标日期" type="date" value={draft.targetDate} onChange={event => setDraft(current => ({ ...current, targetDate: event.target.value }))} className="w-full rounded-lg border border-[#D0D5DD] px-2 py-2" /></label>
    <label><span className="mb-1 block text-[#5A616B]">每月投入（元）</span><input aria-label="每月投入" type="number" min="0" value={draft.monthlyContributionCents / 100} onChange={event => amount('monthlyContributionCents', event.target.value)} className="w-full rounded-lg border border-[#D0D5DD] px-2 py-2" /></label>
    <label><span className="mb-1 block text-[#5A616B]">受保护资金（元）</span><input aria-label="受保护资金" type="number" min="0" value={draft.protectedCents / 100} onChange={event => amount('protectedCents', event.target.value)} className="w-full rounded-lg border border-[#D0D5DD] px-2 py-2" /></label>
    <label><span className="mb-1 block text-[#5A616B]">可浮动周数</span><input aria-label="可浮动周数" type="number" min="0" max="52" value={draft.flexibilityWeeks} onChange={event => setDraft(current => ({ ...current, flexibilityWeeks: Math.max(0, Number(event.target.value || 0)) }))} className="w-full rounded-lg border border-[#D0D5DD] px-2 py-2" /></label>
    <button type="button" disabled={busy || !onPreview} onClick={() => onPreview?.(draft, twinVersion)} className="col-span-2 min-h-11 rounded-xl bg-[#0F6B6D] px-3 py-2 font-semibold text-white disabled:opacity-50">{busy ? '正在试算…' : '实时试算'}</button>
    <p className="col-span-2 text-[10px] text-[#727982]">试算不会修改余额、目标或 Financial Twin；确认应用后才写入。</p>
  </div>;
}

function ScenarioCompare({ component, onAction, busy }: {
  component: Extract<AgentComponent, { type: 'scenario_compare' }>;
  onAction: (actionId: string) => void; busy?: boolean;
}) {
  const [selected, setSelected] = useState(component.selectedPlanId);
  const action = component.actions.find(item => item.planId === selected);
  return <article className="rounded-2xl border border-[#D8E7E7] bg-white p-4 shadow-sm"><h4 className="text-[14px] font-bold">{component.title}</h4><div className="mt-2 space-y-2">{component.plans.map(plan => {
    const disabled = plan.status === 'infeasible' || !component.actions.some(item => item.planId === plan.id);
    return <button type="button" key={plan.id} disabled={disabled || busy} onClick={() => setSelected(plan.id)} className={`w-full rounded-xl border p-3 text-left disabled:cursor-not-allowed disabled:opacity-55 ${selected === plan.id ? 'border-[#0F6B6D] bg-[#F2FAFA] ring-1 ring-[#0F6B6D]' : plan.recommended ? 'border-[#93C7C8] bg-[#F7FBFB]' : 'border-[#E5E8EB]'}`}><div className="flex justify-between text-[12px] font-semibold"><span>{plan.label}{plan.recommended ? ' · 推荐' : ''}</span><span>{money(plan.monthlyCents)}/月</span></div><p className="mt-1 text-[11px] text-[#5A616B]">{plan.explanation}</p></button>;
  })}</div>{component.actions.length > 0 && <button type="button" disabled={!action || busy} onClick={() => action && onAction(action.actionId)} className="mt-3 min-h-11 w-full rounded-xl bg-[#0F6B6D] px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-40">{busy ? '正在启用…' : selected ? '确认并启用该方案' : '先选择一种方案'}</button>}</article>;
}

function AgentRequestBatch({ component, onAction, busy }: {
  component: Extract<AgentComponent, { type: 'agent_request_batch' }>;
  onAction: (actionId: string, selection?: string[]) => void; busy?: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (id: string) => setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  const all = selected.length === component.options.length;
  return <article className="rounded-2xl border border-[#D8E7E7] bg-white p-4 shadow-sm"><h4 className="text-[14px] font-bold">{component.title}</h4><p className="mt-1 text-[11px] text-[#5A616B]">{component.body}</p><label className="mt-3 flex items-center gap-2 border-b border-[#E5E8EB] pb-2 text-[11px] font-semibold"><input type="checkbox" checked={all} onChange={() => setSelected(all ? [] : component.options.map(item => item.id))}/>全选</label><div className="mt-2 space-y-2">{component.options.map(option => <label key={option.id} className="flex items-start gap-2 rounded-xl bg-[#F5F7F8] p-3 text-[11px]"><input type="checkbox" checked={selected.includes(option.id)} onChange={() => toggle(option.id)} className="mt-0.5 accent-[#0F6B6D]"/><span><b className="block">{option.label}</b><span className="text-[#5A616B]">{option.detail}</span></span></label>)}</div><button type="button" disabled={!selected.length || busy} onClick={() => onAction(component.action.actionId, selected)} className="mt-3 min-h-11 w-full rounded-xl bg-[#0F6B6D] px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-40">{busy ? '正在发起…' : component.action.label}</button></article>;
}

function PreferenceEditor({ preferences, goalId, onUpdate, busy }: {
  preferences: RiskPreferences; goalId: string; onUpdate?: (changes: Partial<RiskPreferences>) => void; busy?: boolean;
}) {
  const override = preferences.goalOverrides[goalId];
  const effective = { amountThresholdCents: override?.amountThresholdCents ?? preferences.amountThresholdCents,
    goalImpactRatioThresholdBps: override?.goalImpactRatioThresholdBps ?? preferences.goalImpactRatioThresholdBps };
  const [overrideEnabled, setOverrideEnabled] = useState(Boolean(override));
  const [advanced, setAdvanced] = useState(false);
  const [amountYuan, setAmountYuan] = useState((effective.amountThresholdCents / 100).toString());
  const [ratio, setRatio] = useState((effective.goalImpactRatioThresholdBps / 100).toString());
  const [quietStart, setQuietStart] = useState(preferences.quietHours?.start || '22:00');
  const [quietEnd, setQuietEnd] = useState(preferences.quietHours?.end || '07:00');
  useEffect(() => {
    setOverrideEnabled(Boolean(override));
    setAmountYuan((effective.amountThresholdCents / 100).toString());
    setRatio((effective.goalImpactRatioThresholdBps / 100).toString());
    setQuietStart(preferences.quietHours?.start || '22:00');
    setQuietEnd(preferences.quietHours?.end || '07:00');
  }, [goalId, Boolean(override), effective.amountThresholdCents, effective.goalImpactRatioThresholdBps,
    preferences.quietHours?.start, preferences.quietHours?.end]);
  const thresholds = { amountThresholdCents: Math.max(0, Math.round(Number(amountYuan || 0) * 100)),
    goalImpactRatioThresholdBps: Math.max(0, Math.min(10000, Math.round(Number(ratio || 0) * 100))) };
  const withoutOverride = () => Object.fromEntries(Object.entries(preferences.goalOverrides).filter(([id]) => id !== goalId));
  const save = () => onUpdate?.(overrideEnabled
    ? { quietHours: { start: quietStart, end: quietEnd },
      goalOverrides: { ...preferences.goalOverrides, [goalId]: thresholds } }
    : { ...thresholds, quietHours: { start: quietStart, end: quietEnd }, goalOverrides: withoutOverride() });
  return <div className="mt-3 space-y-2 text-[11px]">
    <label className="flex min-h-10 items-center justify-between rounded-xl bg-[#F5F7F8] px-3"><span>每周安静摘要</span><input aria-label="每周安静摘要" type="checkbox" checked={preferences.weeklySummaryEnabled} disabled={busy} onChange={event => onUpdate?.({ weeklySummaryEnabled: event.target.checked })} className="h-4 w-4 accent-[#0F6B6D]" /></label>
    <button type="button" onClick={() => setAdvanced(value => !value)} className="font-semibold text-[#0F6B6D]">{advanced ? '收起高级设置' : '展开高级设置'}</button>
    {advanced && <div className="grid grid-cols-2 gap-2 rounded-xl border border-[#E5E8EB] p-3">
      <label><span className="mb-1 block text-[#5A616B]">金额阈值（元）</span><input aria-label="金额阈值" type="number" value={amountYuan} onChange={event => setAmountYuan(event.target.value)} className="w-full rounded-lg border border-[#D0D5DD] p-2" /></label>
      <label><span className="mb-1 block text-[#5A616B]">目标占比（%）</span><input aria-label="目标占比阈值" type="number" value={ratio} onChange={event => setRatio(event.target.value)} className="w-full rounded-lg border border-[#D0D5DD] p-2" /></label>
      <label className="col-span-2"><span className="mb-1 block text-[#5A616B]">暂停守护至</span><input aria-label="暂停守护至" type="date" value={preferences.pausedUntil || ''} disabled={busy} onChange={event => onUpdate?.({ pausedUntil: event.target.value || null })} className="w-full rounded-lg border border-[#D0D5DD] p-2 disabled:opacity-50" /></label>
      <label><span className="mb-1 block text-[#5A616B]">静默开始</span><input aria-label="静默开始" type="time" value={quietStart} onChange={event => setQuietStart(event.target.value)} className="w-full rounded-lg border border-[#D0D5DD] p-2" /></label>
      <label><span className="mb-1 block text-[#5A616B]">静默结束</span><input aria-label="静默结束" type="time" value={quietEnd} onChange={event => setQuietEnd(event.target.value)} className="w-full rounded-lg border border-[#D0D5DD] p-2" /></label>
      <label className="col-span-2 flex items-center gap-2"><input aria-label="当前目标单独覆盖" type="checkbox" checked={overrideEnabled} disabled={busy} onChange={event => { const checked = event.target.checked; setOverrideEnabled(checked); onUpdate?.({ goalOverrides: checked ? { ...preferences.goalOverrides, [goalId]: thresholds } : withoutOverride() }); }} /><span>当前目标单独覆盖</span></label>
      <button type="button" disabled={busy} onClick={save} className="col-span-2 min-h-10 rounded-lg bg-[#0F6B6D] font-semibold text-white">保存守护设置</button>
    </div>}
  </div>;
}

export function AgentComponentRenderer({ value, onAction, onCancel, onNavigate, busy, onPreview, onUpdateRiskPreferences }: {
  value: unknown; onAction: (actionId: string, selection?: string[]) => void; onCancel: (actionId: string) => void;
  onNavigate: (screen: ScreenId) => void; busy?: boolean;
  onPreview?: (assumptions: GoalAssumptions, twinVersion: number) => void;
  onUpdateRiskPreferences?: (changes: Partial<RiskPreferences>) => void;
}) {
  const component = normalizeAgentComponent(value);
  if (component.type === 'goal_input_card') return <article className="rounded-2xl border border-[#D8E7E7] bg-white p-4 shadow-sm"><div className="text-[11px] font-semibold text-[#0F6B6D]">目标输入</div><h4 className="mt-1 text-[16px] font-bold">{component.goal.title}</h4><div className="mt-3 grid grid-cols-2 gap-2 text-[12px]"><div className="rounded-xl bg-[#F5F7F8] p-2">目标 {money(component.goal.targetCents)}<span className="mt-1 block text-[9px] text-[#727982]">{fieldSourceName[component.fieldSources.targetCents] || '待核对'}</span></div><div className="rounded-xl bg-[#F5F7F8] p-2">日期 {component.goal.targetDate}<span className="mt-1 block text-[9px] text-[#727982]">{fieldSourceName[component.fieldSources.targetDate] || '待核对'}</span></div><div className="rounded-xl bg-[#F5F7F8] p-2">已存 {money(component.goal.savedCents)}<span className="mt-1 block text-[9px] text-[#727982]">{fieldSourceName[component.fieldSources.savedCents] || '默认假设'}</span></div><div className="rounded-xl bg-[#F5F7F8] p-2">保护资金 {money(component.goal.protectedCents)}<span className="mt-1 block text-[9px] text-[#727982]">{fieldSourceName[component.fieldSources.protectedCents] || '连接数据'}</span></div></div></article>;
  if (component.type === 'assumption_editor' || component.type === 'what_if_simulator') return <article data-testid="assumption-editor" className="rounded-2xl border border-[#D8E7E7] bg-white p-4 shadow-sm"><h4 className="text-[14px] font-bold">{component.title}</h4><AssumptionEditor assumptions={component.assumptions} twinVersion={component.baseTwinVersion} onPreview={onPreview} busy={busy} /></article>;
  if (component.type === 'goal_feasibility_card') return <article className="rounded-2xl border border-[#D8E7E7] bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><h4 className="text-[14px] font-bold">{component.title}</h4><span className="rounded-full bg-[#EBF7F2] px-2 py-1 text-[10px] text-[#276B4E]">{component.assessment.status}</span></div><p className="mt-2 text-[12px] text-[#5A616B]">预计完成：{component.assessment.projectedDate || '需调整条件'} · 建议月存 {money(component.assessment.requiredMonthlyCents)}</p></article>;
  if (component.type === 'goal_progress_card') return <article className="rounded-2xl border border-[#D8E7E7] bg-white p-4 shadow-sm"><h4 className="text-[14px] font-bold">{component.title}</h4><p className="mt-2 text-[22px] font-bold text-[#0F6B6D]">{component.progressPercent.toFixed(1)}%</p><p className="text-[11px] text-[#5A616B]">已存 {money(component.goal.savedCents)} / {money(component.goal.targetCents)}</p></article>;
  if (component.type === 'scenario_compare') return <ScenarioCompare component={component} onAction={onAction} busy={busy}/>;
  if (component.type === 'agent_request_batch') return <AgentRequestBatch component={component} onAction={onAction} busy={busy}/>;
  if (component.type === 'plan_steps') return <article className="rounded-2xl border border-[#D8E7E7] bg-white p-4 shadow-sm"><h4 className="text-[14px] font-bold">{component.title}</h4><ol className="mt-3 space-y-2">{component.steps.map((step, index) => <li key={step.id} className="flex gap-2 text-[11px]"><span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${step.status === 'complete' ? 'bg-[#0F6B6D] text-white' : 'bg-[#F0F2F5] text-[#5A616B]'}`}>{index + 1}</span><span><b className="block">{step.label}</b><span className="text-[#5A616B]">{step.detail}</span></span></li>)}</ol></article>;
  if (component.type === 'goal_impact_brief') return <article className="rounded-2xl border border-[#D8E7E7] bg-white p-4 shadow-sm"><div className="text-[10px] font-semibold text-[#0F6B6D]">每周安静摘要</div><h4 className="mt-1 text-[14px] font-bold">{component.title}</h4><p className="mt-2 text-[12px] leading-relaxed text-[#5A616B]">{component.body}</p>{component.summary && <p className="mt-2 text-[10px] text-[#727982]">{component.summary.weekStart} 至 {component.summary.weekEnd} · 不触发紧急红点</p>}</article>;
  if (component.type === 'notification_preference_card') return <article className="rounded-2xl border border-[#D8E7E7] bg-white p-4 shadow-sm"><h4 className="text-[14px] font-bold">{component.title}</h4><p className="mt-1 text-[11px] text-[#5A616B]">流水持续在后台分析；只有目标或安全资金真正受影响时才即时提示。</p><PreferenceEditor preferences={component.preferences} goalId={component.goalId} onUpdate={onUpdateRiskPreferences} busy={busy} /></article>;
  if (component.type === 'goal_summary') return <article className="rounded-2xl border border-[#D8E7E7] bg-white p-3 shadow-sm">
    <div className="text-[11px] font-semibold text-[#0F6B6D]">目标草案</div>
    <h4 className="mt-1 text-[15px] font-bold">{component.goal.title}</h4>
    <div className="mt-2 grid grid-cols-2 gap-2 text-[12px] text-[#5A616B]">
      <div className="rounded-xl bg-[#F5F7F8] p-2"><span className="block text-[10px]">目标金额</span><b className="text-[#1F2329]">{money(component.goal.targetCents)}</b></div>
      <div className="rounded-xl bg-[#F5F7F8] p-2"><span className="block text-[10px]">目标日期</span><b className="text-[#1F2329]">{component.goal.targetDate}</b></div>
      <div className="col-span-2 rounded-xl bg-[#EBF7F2] p-2 text-[#276B4E]">应急金 {money(component.goal.protectedCents)} 严格隔离</div>
    </div>
    <button onClick={() => onNavigate('create_goal')} className="mt-2 text-[11px] font-semibold text-[#0F6B6D]">打开目标详情 →</button>
  </article>;
  if (component.type === 'feasibility') return <article className="rounded-2xl border border-[#D8E7E7] bg-white p-3 shadow-sm">
    <div className="flex items-center justify-between"><h4 className="text-[14px] font-bold">{component.title}</h4><span className="rounded-full bg-[#EBF7F2] px-2 py-1 text-[10px] font-semibold text-[#276B4E]">{component.assessment.status}</span></div>
    <p className="mt-2 text-[12px] text-[#5A616B]">{component.assessment.dataSufficiency} · 预计月存 {money(component.assessment.requiredMonthlyCents)}</p><button onClick={() => onNavigate('feasibility')} className="mt-2 text-[11px] font-semibold text-[#0F6B6D]">打开可行性详情 →</button>
  </article>;
  if (component.type === 'plan_compare') return <article className="rounded-2xl border border-[#D8E7E7] bg-white p-3 shadow-sm">
    <h4 className="text-[14px] font-bold">{component.title}</h4>
    <div className="mt-2 space-y-1.5">{component.plans.map(plan => <div key={plan.id} className={`rounded-xl border p-2 ${plan.recommended ? 'border-[#0F6B6D] bg-[#F2FAFA]' : 'border-[#E5E8EB]'}`}>
      <div className="flex justify-between text-[12px] font-semibold"><span>{plan.label}{plan.recommended ? ' · NOVA 推荐' : ''}</span><span>{money(plan.monthlyCents)}/月</span></div>
      <p className="mt-1 text-[11px] text-[#5A616B]">{plan.explanation}</p>
    </div>)}</div>
  </article>;
  if (component.type === 'impact_summary') return <article className="rounded-2xl border border-amber-200 bg-amber-50 p-3 shadow-sm">
    <div className="text-[11px] font-semibold text-amber-700">目标影响信号</div><h4 className="mt-1 text-[14px] font-bold">{component.title}</h4>
    <p className="mt-2 text-[12px] text-[#5A616B]">新增支出 {money(component.impact.expenseCents)}，预计延期 {component.impact.delayDays} 天。</p>
    <p className="mt-2 rounded-lg bg-white/80 p-2 text-[11px] font-semibold text-[#276B4E]">应急金未受影响 · {money(component.protectedCents)} 严格隔离</p><button onClick={() => onNavigate('impact')} className="mt-2 text-[11px] font-semibold text-[#0F6B6D]">打开影响详情 →</button>
  </article>;
  if (component.type === 'risk_signal') return <article className="rounded-2xl border border-amber-200 bg-amber-50 p-3 shadow-sm">
    <div className="text-[11px] font-semibold text-amber-700">目标感知风险</div>
    <h4 className="mt-1 text-[14px] font-bold">{component.title}</h4>
    <div className="mt-3 rounded-xl bg-white/80 p-2.5">
      <div className="text-[11px] font-bold">哪些流水形成趋势</div>
      <p className="mt-1 text-[11px] text-[#5A616B]">过去两个月平均 {money(component.pattern.baselineCents)}，本期 {component.pattern.transactionCount} 笔累计 {money(component.pattern.currentCents)}。</p>
    </div>
    <div className="mt-2 rounded-xl bg-white/80 p-2.5 text-[11px] text-[#5A616B]">
      <b className="text-[#1F2329]">具体影响</b> · 目标预计延期 {component.signal.impact.delayDays} 天；应急金未受影响，{money(component.protectedCents)} 继续严格隔离。
    </div>
    <dl className="mt-2 grid gap-1 rounded-xl border border-amber-100 bg-white/80 p-2.5 text-[10px] text-[#5A616B]">
      <div><dt className="inline font-semibold text-[#1F2329]">客观模拟流水：</dt><dd className="inline">{[...new Set(component.signal.evidence.map(item => item.sourceKind).filter((item): item is keyof typeof sourceName => Boolean(item)))].map(item => sourceName[item]).join('、') || '已连接来源'} · {component.pattern.periodStart} 至 {component.pattern.periodEnd}</dd></div>
      <div><dt className="inline font-semibold text-[#1F2329]">系统计算结果：</dt><dd className="inline">规则 {component.signal.ruleVersion} · Twin v{component.signal.twinVersion}</dd></div>
      <div><dt className="inline font-semibold text-[#1F2329]">用户目标假设：</dt><dd className="inline">日本旅行目标与受保护资金设置 · 更新于 {component.signal.createdAt}</dd></div>
    </dl>
    <div className="mt-2 space-y-1 text-[11px]"><div className="rounded-lg border border-amber-100 bg-white px-2 py-1.5">1. 降低未来可选支出</div><div className="rounded-lg border border-amber-100 bg-white px-2 py-1.5">2. 增加目标投入</div><div className="rounded-lg border border-amber-100 bg-white px-2 py-1.5">3. 调整目标日期</div></div>
  </article>;
  if (component.type === 'mandate_preview') return <article className="rounded-2xl border border-[#D8E7E7] bg-white p-3 shadow-sm">
    <div className="text-[11px] font-semibold text-[#0F6B6D]">受控自主执行</div><h4 className="mt-1 text-[14px] font-bold">{component.title}</h4>
    <dl className="mt-2 grid grid-cols-2 gap-2 text-[11px]"><div><dt className="text-[#5A616B]">用途</dt><dd>{component.mandate.category}</dd></div><div><dt className="text-[#5A616B]">单笔上限</dt><dd>{money(component.mandate.maxPerOperationCents)}</dd></div><div><dt className="text-[#5A616B]">累计上限</dt><dd>{money(component.mandate.totalLimitCents)}</dd></div><div><dt className="text-[#5A616B]">有效期</dt><dd>{component.mandate.expiresAt}</dd></div></dl><button onClick={() => onNavigate('banking_demo')} className="mt-2 text-[11px] font-semibold text-[#0F6B6D]">打开授权与执行记录 →</button>
  </article>;
  if (component.type === 'confirmation') return <article className={`rounded-2xl border p-3 shadow-sm ${tone[component.tone]}`}>
    <div className="text-[10px] font-semibold uppercase tracking-wide text-[#8A6A13]">需要你明确确认</div><h4 className="mt-1 text-[14px] font-bold">{component.title}</h4>
    <p className="mt-1 text-[12px] leading-relaxed text-[#5A616B]">{component.body}</p>
    <div className="mt-3 grid grid-cols-[1fr_auto] gap-2"><button disabled={busy} onClick={() => onAction(component.action.actionId)} className="min-h-11 rounded-xl bg-[#0F6B6D] px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-50">{busy ? '正在执行…' : component.action.label}</button><button disabled={busy} onClick={() => onCancel(component.action.actionId)} className="min-h-11 rounded-xl border border-[#D0D5DD] bg-white px-3 text-[12px] text-[#5A616B]">取消</button></div>
  </article>;
  if (component.type === 'receipt') return <article className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 shadow-sm">
    <div className="text-[10px] font-bold text-emerald-700">{component.status.toUpperCase()}</div><h4 className="mt-1 text-[14px] font-bold">{component.title}</h4><p className="mt-1 text-[12px] text-[#47605A]">{component.body}</p>
  </article>;
  if (component.type === 'audit_summary') return <article className="rounded-2xl border border-[#D8E7E7] bg-white p-3"><h4 className="text-[13px] font-bold">{component.title}</h4><p className="mt-1 text-[11px] text-[#5A616B]">{component.body}</p><span className="mt-2 inline-block rounded-full bg-[#EBF7F2] px-2 py-1 text-[10px] text-[#276B4E]">Hash 链{component.chainValid ? '有效' : '异常'}</span><button onClick={() => onNavigate('activity')} className="ml-2 text-[11px] font-semibold text-[#0F6B6D]">查看审计 →</button></article>;
  if (component.type === 'clarification') return <article className="rounded-2xl border border-[#D8E7E7] bg-white p-3"><h4 className="text-[13px] font-bold">{component.title}</h4><p className="mt-1 text-[12px] text-[#5A616B]">{component.body}</p></article>;
  const fallbackTone = component.type === 'error_recovery' ? 'warning' : component.tone;
  return <article className={`rounded-2xl border p-3 ${tone[fallbackTone]}`}><h4 className="text-[13px] font-bold">{component.title}</h4><p className="mt-1 text-[12px] leading-relaxed text-[#5A616B]">{component.body}</p></article>;
}
