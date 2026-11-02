import { useEffect, useRef, useState } from 'react';
import { RiskRepairPreviewSchema, SnapshotSchema, type RiskRepairPreview,
  type RiskRepairStrategy, type Snapshot } from '../../shared/contracts';
import { api } from '../api';
import { money, PlanCandidateCard, PlanDifferenceTable, TargetDateConfirmation } from '../components/PlanConfirmation';
import type { Goal } from '../types';

interface GoalImpactScreenProps {
  snapshot: Snapshot; goal: Goal;
  onRefresh: (snapshot: Snapshot) => void;
  onResolved: (snapshot: Snapshot, destination: 'home' | 'money_mission') => void;
  onManualAdjust: () => void; onLater: () => void; onDismiss: () => void;
}

const optionTitle: Record<RiskRepairStrategy, string> = {
  keep_target_date: '方案 A · 保持目标日期',
  keep_monthly_contribution: '方案 B · 保持每月投入',
};

function errorText(reason: unknown) {
  if (reason instanceof Error && /TWIN_VERSION_CHANGED|PREVIEW_STALE/.test(reason.message))
    return '数据已更新，请重新计算';
  if (reason instanceof Error && /RISK_NOT_ACTIVE/.test(reason.message)) return '这条风险已处理或已过期';
  return reason instanceof Error ? reason.message : '暂时无法核验调整方案';
}

export function GoalImpactScreen({ snapshot, goal, onRefresh, onResolved, onManualAdjust,
  onLater, onDismiss }: GoalImpactScreenProps) {
  const impactId = snapshot.pendingImpact!.id;
  const [previews, setPreviews] = useState<Record<RiskRepairStrategy, RiskRepairPreview> | null>(null);
  const [selected, setSelected] = useState<RiskRepairStrategy | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [success, setSuccess] = useState<{ snapshot: Snapshot; review: boolean } | null>(null);
  const idempotencyKey = useRef(crypto.randomUUID());

  async function recoverLatest() {
    const live = SnapshotSchema.parse(await api<Snapshot>('/api/session'));
    setPreviews(null); setSelected(null); setAccepted(false);
    idempotencyKey.current = crypto.randomUUID();
    onRefresh(live);
    setRefreshKey(value => value + 1);
  }

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setPreviews(null); setSelected(null); setAccepted(false);
    Promise.all((['keep_target_date', 'keep_monthly_contribution'] as const).map(async strategy => {
      const result = await api('/api/impact/plan-preview', 'POST', {
        impactId, expectedTwinVersion: snapshot.twinVersion, strategy,
      });
      return RiskRepairPreviewSchema.parse(result);
    })).then(([keepTargetDate, keepMonthlyContribution]) => {
      if (!active) return;
      if (keepTargetDate.baseTwinVersion !== keepMonthlyContribution.baseTwinVersion)
        throw new Error('TWIN_VERSION_CHANGED');
      setError('');
      setPreviews({ keep_target_date: keepTargetDate,
        keep_monthly_contribution: keepMonthlyContribution });
    }).catch(async reason => {
      if (!active) return;
      setError(errorText(reason));
      if (reason instanceof Error && /TWIN_VERSION_CHANGED/.test(reason.message)) {
        try { await recoverLatest(); } catch { setError('数据已更新，暂时无法重新加载；请稍后重试。'); }
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [impactId, snapshot.twinVersion, onRefresh, refreshKey]);

  const chosen = selected && previews ? previews[selected] : null;
  const verified = previews?.keep_monthly_contribution ?? previews?.keep_target_date ?? null;
  const evidenceTotal = verified?.evidence.transactions.reduce((sum, item) => sum + item.amountCents, 0) ?? 0;

  async function checkStatus() {
    const status = await api<{ applied: boolean; receipt: { scheduleReviewRequired: boolean } | null }>(
      '/api/impact/plan-status', 'POST', { impactId, idempotencyKey: idempotencyKey.current });
    if (!status.applied) return false;
    const live = await api<Snapshot>('/api/session');
    setSuccess({ snapshot: live, review: Boolean(status.receipt?.scheduleReviewRequired) });
    return true;
  }

  async function apply() {
    if (!chosen || !chosen.candidate.selectable) return;
    setBusy(true); setError('');
    try {
      const result = await api<{ snapshot: Snapshot; scheduleReviewRequired: boolean }>(
        '/api/impact/plan-apply', 'POST', {
          impactId, previewId: chosen.previewId, expectedTwinVersion: chosen.baseTwinVersion,
          strategy: chosen.strategy, candidateId: chosen.candidate.id,
          acceptTargetDateChange: accepted, idempotencyKey: idempotencyKey.current,
        });
      setSuccess({ snapshot: SnapshotSchema.parse(result.snapshot), review: result.scheduleReviewRequired });
    } catch (reason) {
      try { if (await checkStatus()) return; } catch { /* show original failure */ }
      setError(errorText(reason));
      if (reason instanceof Error && /TWIN_VERSION_CHANGED|PREVIEW_STALE/.test(reason.message)) {
        try { await recoverLatest(); } catch { setError('数据已更新，暂时无法重新加载；请稍后重试。'); }
      }
    } finally { setBusy(false); }
  }

  if (success) return <div className="flex-1 overflow-y-auto px-4 py-5">
    <section className="rounded-xl border border-[#D8E7E7] bg-white p-5 shadow-sm">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[#EBF7F2] text-[#276B4E]">
        <span className="material-symbols-outlined">check_circle</span>
      </div>
      <h2 className="text-xl font-bold">计划已调整</h2>
      <p className="mt-2 text-sm text-[#5A616B]">风险已标记为已处理，NOVA 会基于新计划继续守护。</p>
      {success.review && <p className="mt-3 rounded-lg bg-[#FFF9ED] p-3 text-xs text-[#76551D]">已有自动转入安排保持不变，请单独核对金额与日期。</p>}
      <button type="button" onClick={() => onResolved(success.snapshot, 'home')}
        className="mt-4 min-h-11 w-full rounded-xl bg-[#0F6B6D] px-4 text-sm font-semibold text-white">返回目标</button>
      {success.review && <button type="button" onClick={() => onResolved(success.snapshot, 'money_mission')}
        className="mt-2 min-h-11 w-full rounded-xl border border-[#B9D9D8] px-4 text-sm font-semibold text-[#0F6B6D]">查看转账安排</button>}
    </section>
  </div>;

  return <div className="flex-1 overflow-y-auto px-4 py-2">
    <div className="space-y-3 pb-5">
      {verified && <section className="space-y-2 rounded-xl border border-[#E5E8EB] bg-white p-3.5 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-[19px] font-bold">{goal.title}可能延期 {verified.candidate.delayDays} 天</h2>
          <span className="shrink-0 rounded-full bg-[#E6F2F2] px-2 py-1 text-[11px] font-semibold text-[#0F6B6D]">NOVA 洞察</span>
        </div>
        <p className="text-sm leading-relaxed text-[#5A616B]">{verified.evidence.title}；{verified.evidence.transactions.length} 笔核验流水累计 {money(evidenceTotal)}，影响了原有储蓄节奏。</p>
        <p className={`rounded-lg p-2.5 text-xs font-semibold ${verified.protection.satisfied ? 'bg-[#EBF7F2] text-[#276B4E]' : 'bg-rose-50 text-rose-700'}`}>
          保护资金 {money(verified.protection.requiredCents)} · 可用 {money(verified.protection.availableCents)} · {verified.protection.satisfied ? '安全隔离' : '当前不足'}
        </p>
      </section>}
      {verified && <section className="space-y-2 rounded-xl border border-[#E5E8EB] bg-white p-3.5 shadow-sm">
        <h3 className="text-sm font-bold">为什么会受影响</h3>
        <p className="text-xs text-[#5A616B]">数据截至 {verified.evidence.dataAsOf} · 风险识别于 {verified.evidence.detectedAt} · 置信度 {verified.evidence.confidence}</p>
        <p className="text-xs text-[#5A616B]">原计划 {verified.comparison.before.targetDate}，保持当前月投入后预计 {verified.comparison.after.projectedDate ?? '仍需补充数据'} 完成，延期 {verified.candidate.delayDays} 天。</p>
        <p className="text-[11px] text-[#5A616B]">证据、金额与日期均来自同一服务端预览；选择方案后仍需最终确认。</p>
      </section>}
      <section aria-label="调整方案" className="space-y-2.5">
        <h3 className="text-sm font-bold">比较两个不动保护资金的方案</h3>
        {loading && <p role="status" className="rounded-xl bg-white p-4 text-sm">正在核验方案…</p>}
        {previews && (Object.keys(optionTitle) as RiskRepairStrategy[]).map(strategy =>
          <PlanCandidateCard key={strategy} candidate={previews[strategy].candidate}
            title={optionTitle[strategy]} selected={selected === strategy} busy={busy}
            onSelect={() => { setSelected(strategy); setAccepted(false); }} />)}
      </section>
      {chosen && <section className="space-y-2 rounded-xl border border-[#D8E7E7] bg-white p-3.5">
        <h3 className="text-sm font-bold">确认调整内容</h3>
        <PlanDifferenceTable rows={[
          ['每月投入', money(chosen.comparison.before.monthlyContributionCents), money(chosen.comparison.after.monthlyContributionCents)],
          ['目标日期', chosen.comparison.before.targetDate, chosen.comparison.after.targetDate],
          ['预计完成', chosen.comparison.before.projectedDate ?? '待核对', chosen.comparison.after.projectedDate ?? '待核对'],
          ['保护资金', money(chosen.protection.requiredCents), chosen.protection.satisfied ? '保持隔离' : '不足'],
        ]} />
        <TargetDateConfirmation candidate={chosen.candidate} accepted={accepted} onChange={setAccepted} />
      </section>}
      {error && <div className="space-y-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
        <p role="alert">{error}</p>
        {!loading && <button type="button" onClick={() => setRefreshKey(value => value + 1)}
          className="min-h-11 rounded-lg border border-rose-200 bg-white px-3 font-semibold text-rose-700">重新加载方案</button>}
      </div>}
      <button type="button" disabled={busy || !chosen?.candidate.selectable
        || Boolean(chosen?.candidate.requiresTargetDateChange && !accepted)} onClick={() => void apply()}
        className="min-h-11 w-full rounded-xl bg-[#0F6B6D] px-4 text-sm font-semibold text-white disabled:bg-[#D0D5DD]">
        {busy ? '正在确认…' : '确认调整计划'}
      </button>
      <p className="text-center text-[11px] text-[#5A616B]">仅模拟数据，不会自动扣款</p>
      <button type="button" onClick={onManualAdjust} className="min-h-11 w-full rounded-xl border border-[#B9D9D8] text-sm text-[#0F6B6D]">手动调整目标参数</button>
      <div className="flex justify-center gap-5">
        <button type="button" onClick={onLater} className="min-h-11 text-sm text-[#5A616B]">稍后处理</button>
        <button type="button" onClick={onDismiss} className="min-h-11 text-sm text-[#5A616B]">忽略本次提示</button>
      </div>
    </div>
  </div>;
}
