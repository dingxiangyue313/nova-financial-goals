import { useEffect, useRef, useState } from 'react';
import { GoalPlanChangeDraftSchema, GoalPlanChangePreviewSchema, SnapshotSchema,
  type Snapshot, type GoalPlanChangePreview, type GoalPlanChangeDraft } from '../../shared/contracts';
import { api } from '../api';

const money = (value: number) => `¥${(value / 100).toLocaleString('zh-CN')}`;
const reasons: Record<string, string> = {
  MONTHLY_CAPACITY_EXCEEDED: '超过每月可投入金额', FIRST_MONTH_BUFFER_NEGATIVE: '首月可用金额不足',
  PROTECTED_FUNDS_UNAVAILABLE: '保护资金不足', INSUFFICIENT_DATA: '数据不足，暂时不能确认',
  PLAN_NOT_AVAILABLE: '当前条件下不可执行', GOAL_DEADLINE_PASSED: '目标日期已过',
  FORECAST_HORIZON_INCOMPLETE: '目标日期超出当前可核算范围', AMBIGUOUS_SCHEDULE: '需重新核对存款安排',
};
export function PlanChangePanel({ snapshot, onApplied, onRefresh, onCancel }: {
  snapshot: Snapshot; onApplied: (snapshot: Snapshot, review: boolean) => void;
  onRefresh: (snapshot: Snapshot) => void; onCancel: () => void;
}) {
  const [draft, setDraft] = useState<GoalPlanChangeDraft>(() => ({
    targetCents: snapshot.goal.targetCents, targetDate: snapshot.goal.targetDate,
    savedCents: snapshot.goal.savedCents, protectedCents: snapshot.goal.protectedCents,
    monthlyContributionCents: snapshot.goal.monthlyContributionCents,
    flexibilityWeeks: snapshot.goal.flexibilityWeeks,
  }));
  const [preview, setPreview] = useState<GoalPlanChangePreview | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [preview]);
  const candidates = preview ? [...preview.novaPlans, preview.customPlan] : [];
  const chosen = candidates.find(candidate => candidate.id === selected);
  const stale = preview && snapshot.twinVersion !== preview.baseTwinVersion;
  function explain(reason: unknown) {
    return reason instanceof Error && /TWIN_VERSION_CHANGED/.test(reason.message)
      ? '数据已更新，请重新计算' : reason instanceof Error ? reason.message : '暂时无法完成，请重试';
  }
  async function recover(reason: unknown) {
    setError(explain(reason));
    if (reason instanceof Error && /TWIN_VERSION_CHANGED/.test(reason.message)) {
      try { onRefresh(await api<Snapshot>('/api/session')); setPreview(null); setSelected(null); }
      catch { setError('数据已更新，暂时无法重新加载；请稍后重试。'); }
    }
  }
  async function calculate() {
    setError('');
    if (!GoalPlanChangeDraftSchema.safeParse(draft).success) {
      setError('请核对金额和日期；已存金额不能高于目标金额，每月投入必须大于 0。'); return;
    }
    setBusy(true);
    try {
      const result = await api('/api/goals/current/plan-preview', 'POST', {
        expectedTwinVersion: snapshot.twinVersion, draft,
      });
      setPreview(GoalPlanChangePreviewSchema.parse(result)); setSelected(null); setAccepted(false);
    } catch (reason) { await recover(reason); }
    finally { setBusy(false); }
  }
  async function apply() {
    if (!chosen || !preview || stale) return;
    setBusy(true); setError('');
    try {
      const result = await api<{ snapshot: Snapshot; scheduleReviewRequired: boolean }>(
        '/api/goals/current/plan-change', 'POST', { expectedTwinVersion: preview.baseTwinVersion,
          draft, selection: { candidateId: chosen.id, acceptTargetDateChange: accepted } });
      onApplied(SnapshotSchema.parse(result.snapshot), result.scheduleReviewRequired);
    } catch (reason) { await recover(reason); }
    finally { setBusy(false); }
  }
  const field = (key: 'targetCents' | 'savedCents' | 'protectedCents' | 'monthlyContributionCents', label: string) =>
    <label className="block text-sm">{label}<input type="number" min={key === 'targetCents' || key === 'monthlyContributionCents' ? '0.01' : '0'} step="0.01"
      value={draft[key] / 100} onChange={event => setDraft(value => ({ ...value, [key]: Math.round(Number(event.target.value) * 100) }))}
      className="mt-1 min-h-11 w-full rounded-lg border border-[#D0D5DD] bg-white px-3" /></label>;
  return <section id="plan-change-panel" aria-label="修改方案" className="rounded-xl border border-[#D8E7E7] bg-white p-3.5 space-y-3">
    <h2 ref={heading} tabIndex={-1} className="text-base font-bold">{preview ? '第二步 · 比较新方案' : '第一步 · 调整目标与存钱条件'}</h2>
    <p className="text-xs text-[#5A616B]">试算期间当前计划继续生效，确认后一次性更新。</p>
    {!preview ? <form onSubmit={event => { event.preventDefault(); void calculate(); }} className="space-y-3">
      {field('targetCents', '目标金额（元）')}
      <label className="block text-sm">目标日期<input type="date" value={draft.targetDate} onChange={event => setDraft(value => ({ ...value, targetDate: event.target.value }))} className="mt-1 min-h-11 w-full rounded-lg border border-[#D0D5DD] px-3" /></label>
      {field('savedCents', '已存金额（元）')}{field('protectedCents', '保护资金（元）')}{field('monthlyContributionCents', '每月投入（元）')}
      <details><summary className="min-h-11 cursor-pointer text-sm">高级项</summary><label className="block text-sm">允许浮动周数<input type="number" min="0" max="52" value={draft.flexibilityWeeks} onChange={event => setDraft(value => ({ ...value, flexibilityWeeks: Number(event.target.value) }))} className="min-h-11 w-full rounded-lg border px-3" /></label></details>
      <button disabled={busy} className="min-h-11 w-full rounded-xl bg-[#0F6B6D] px-3 text-white">{busy ? '正在计算…' : '重新计算'}</button>
    </form> : <>
      <p role="status" className="text-xs">已生成 {candidates.length} 个方案，请选择并核对变更。</p>
      {candidates.map(candidate => <button type="button" key={candidate.id} disabled={busy || !candidate.selectable}
        aria-pressed={selected === candidate.id} onClick={() => { setSelected(candidate.id); setAccepted(false); }}
        className={`min-h-11 w-full rounded-xl border p-3 text-left disabled:opacity-60 ${selected === candidate.id ? 'border-[#0F6B6D] bg-[#F2FAFA]' : 'border-[#D0D5DD]'}`}>
        <strong className="block text-sm">{candidate.label}{candidate.source === 'both' ? ' · NOVA 推荐' : ''} · {money(candidate.monthlyCents)}/月</strong>
        <span className="block text-xs mt-1">{candidate.explanation}</span>
        <span className="block text-xs mt-1">预计完成 {candidate.projectedDate ?? '待补充数据'}</span>
        <span className="block text-xs mt-1">首月缓冲 {money(candidate.safeToSpendCents)}</span>
        {candidate.firstMonthContributionCents !== undefined && candidate.firstMonthContributionCents !== candidate.monthlyCents && <span className="block text-xs mt-1">首月合计投入 {money(candidate.firstMonthContributionCents)}</span>}
        {candidate.blockingReasons.length > 0 && <span className="block text-xs mt-1">{candidate.blockingReasons.map(reason => reasons[reason] ?? '需核对当前数据').join('；')}</span>}
      </button>)}
      {chosen && <div className="rounded-xl bg-[#F5F7F8] p-3 space-y-2 text-xs">
        <h3 className="font-bold text-sm">确认变更</h3>
        {[
          ['目标金额', money(snapshot.goal.targetCents), money(draft.targetCents)],
          ['目标日期', snapshot.goal.targetDate, chosen.effectiveTargetDate],
          ['已存金额', money(snapshot.goal.savedCents), money(draft.savedCents)],
          ['保护资金', money(snapshot.goal.protectedCents), money(draft.protectedCents)],
          ['每月投入', money(snapshot.goal.monthlyContributionCents), money(chosen.monthlyCents)],
          ['允许浮动', `${snapshot.goal.flexibilityWeeks} 周`, `${draft.flexibilityWeeks} 周`],
        ].map(([label, before, after]) => <p key={label}>{label}：{before} → {after}</p>)}
        {chosen.requiresTargetDateChange && <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} />同意将目标日期调整为 {chosen.effectiveTargetDate}（晚 {chosen.delayDays} 天）</label>}
      </div>}
      <button type="button" disabled={busy || !chosen?.selectable || Boolean(stale) || Boolean(chosen?.requiresTargetDateChange && !accepted)} onClick={() => void apply()} className="min-h-11 w-full rounded-xl bg-[#0F6B6D] px-3 text-white disabled:opacity-50">{busy ? '正在保存…' : '确认修改方案'}</button>
      <button type="button" disabled={busy} onClick={() => { setPreview(null); setError(''); }} className="min-h-11 w-full rounded-xl border border-[#D0D5DD]">返回编辑</button>
    </>}
    {(error || stale) && <p role="alert" className="text-sm text-rose-700">{stale ? '数据已更新，请返回编辑并重新计算' : error}</p>}
    <button type="button" disabled={busy} onClick={onCancel} className="min-h-11 w-full rounded-xl border border-[#D0D5DD] text-sm">取消修改</button>
  </section>;
}
