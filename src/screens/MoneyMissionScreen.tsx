import { useEffect, useState } from 'react';
import type { Snapshot } from '../../shared/contracts';
import type { ImportIssue, MissionRepairPreview, MissionStage, StatementImportBatch } from '../../shared/money-mission';
import type { Mission } from '../../shared/mission';
import { api } from '../api';
import { money } from '../lib/format';
import { CATEGORY_LABELS, missionErrorMessage } from '../lib/mission-copy';
import { ActionApproval } from '../components/money-mission/ActionApproval';
import { ActionReceipt } from '../components/money-mission/ActionReceipt';
import { BalanceSnapshotForm } from '../components/money-mission/BalanceSnapshotForm';
import { BillBrief } from '../components/money-mission/BillBrief';
import { CashflowTimeline } from '../components/money-mission/CashflowTimeline';
import { DataQualityCard } from '../components/money-mission/DataQualityCard';
import { EvidenceDrawer } from '../components/money-mission/EvidenceDrawer';
import { ImportReview } from '../components/money-mission/ImportReview';
import { MissionState } from '../components/money-mission/MissionState';
import { MissionStepper } from '../components/money-mission/MissionStepper';
import { MonitoringPanel } from '../components/money-mission/MonitoringPanel';
import { PlanComparison } from '../components/money-mission/PlanComparison';
import { StatementImportPanel } from '../components/money-mission/StatementImportPanel';
import { SubscriptionDetail } from '../components/money-mission/SubscriptionDetail';
import { TransferScheduleEditor } from '../components/money-mission/TransferScheduleEditor';
import { TransferScheduleStatus } from '../components/money-mission/TransferScheduleStatus';

export { money };

type Props = { snapshot: Snapshot; onSnapshot: (s: Snapshot) => void; mode: 'bills' | 'savings'; onSavings: () => void };

export function MoneyMissionScreen({ snapshot, onSnapshot, mode, onSavings }: Props) {
  const model = snapshot.moneyMission;
  const mission = snapshot.mission;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [evidence, setEvidence] = useState(false);
  const [filter, setFilter] = useState('全部');
  const [month, setMonth] = useState(snapshot.clock.slice(0, 7));
  const [amount, setAmount] = useState(String((snapshot.mission?.schedule?.amountCents ?? model?.schedules.at(-1)?.amountCents ?? 100000) / 100));
  const [frequency, setFrequency] = useState<'once' | 'monthly'>('monthly');
  const [notice, setNotice] = useState('');
  const [planChoice, setPlanChoice] = useState('平衡');
  const [viewing, setViewing] = useState<MissionStage>(mode === 'savings' ? 'planning' : (model?.stage ?? 'bills'));
  const [uploadEnabled, setUploadEnabled] = useState(false);
  const [preview, setPreview] = useState<{ batch: StatementImportBatch; issues: ImportIssue[] } | null>(null);
  const [repairs, setRepairs] = useState<MissionRepairPreview[]>(model?.repairPreviews ?? []);

  useEffect(() => {
    setEvidence(false);
    setViewing(mode === 'savings' ? 'planning' : (model?.stage && ['planning', 'transfer', 'monitoring'].includes(model.stage) ? 'bills' : (model?.stage ?? 'bills')));
  }, [mode]);

  useEffect(() => {
    let active = true;
    api<{ uploadEnabled: boolean }>('/api/statement-import/templates').then(result => { if (active) setUploadEnabled(result.uploadEnabled); }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (viewing !== 'monitoring') return;
    let active = true;
    api<{ repairs: MissionRepairPreview[] }>('/api/money-mission/repairs').then(result => { if (active) setRepairs(result.repairs); }).catch(() => {});
    return () => { active = false; };
  }, [viewing, snapshot.twinVersion]);

  const run = async (path: string, body: Record<string, unknown> = {}) => {
    setBusy(true); setError('');
    try {
      const next = await api<Snapshot>(`/api/mission/${path}`, 'POST', body);
      onSnapshot(next);
    } catch (reason) {
      setError(missionErrorMessage(reason));
    } finally { setBusy(false); }
  };

  const selectStage = (stage: MissionStage) => {
    if (stage === 'planning' || stage === 'transfer') onSavings();
    setViewing(stage);
  };

  const importSample = async (sampleId: 'all' | 'bank' | 'wechat' | 'alipay') => {
    setBusy(true); setError('');
    try {
      const result = await api<{ snapshot: Snapshot; batch: StatementImportBatch; issues: ImportIssue[] }>('/api/statement-imports/sample', 'POST', { sampleId });
      onSnapshot(result.snapshot);
      setPreview({ batch: result.batch, issues: result.issues });
      setNotice(result.issues.length ? '合成账单已解析，请先核对问题再提交。' : '合成账单已核对，可以提交。重复记录会去重，余额保持不变。');
      setViewing('data');
    } catch (reason) { setError(missionErrorMessage(reason)); }
    finally { setBusy(false); }
  };

  const uploadStatement = async (file: File) => {
    if (!uploadEnabled) return;
    setBusy(true); setError('');
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('DATA_FILE_TOO_LARGE');
      const form = new FormData(); form.append('file', file); form.append('templateId', 'nova-synthetic-v1');
      const result = await api<{ snapshot: Snapshot; batch: StatementImportBatch; issues: ImportIssue[] }>('/api/statement-imports/upload', 'POST', form);
      onSnapshot(result.snapshot); setPreview({ batch: result.batch, issues: result.issues });
      setNotice('文件已解析，请核对字段、重复记录与问题后确认导入。'); setViewing('data');
    } catch (reason) { setError(missionErrorMessage(reason)); }
    finally { setBusy(false); }
  };

  const resolveIssue = async (issueId: string, value: string) => {
    if (!preview) return;
    setBusy(true); setError('');
    try {
      const result = await api<{ snapshot: Snapshot; batch: StatementImportBatch; issues: ImportIssue[] }>(`/api/statement-imports/${preview.batch.id}/issues/${issueId}`, 'PATCH', { value });
      onSnapshot(result.snapshot);
      setPreview({ batch: result.batch, issues: result.issues });
    } catch (reason) { setError(missionErrorMessage(reason)); }
    finally { setBusy(false); }
  };

  const commitImport = async (operation: 'commit' | 'revoke') => {
    if (!preview) return;
    setBusy(true); setError('');
    try {
      const next = await api<Snapshot>(`/api/statement-imports/${preview.batch.id}/${operation}`, 'POST', {
        expectedTwinVersion: snapshot.twinVersion,
        expectedBatchRevision: preview.batch.revision ?? 0,
        confirmed: true
      });
      onSnapshot(next);
      setPreview(operation === 'commit' ? { batch: { ...preview.batch, status: 'committed' }, issues: preview.issues } : null);
      setNotice(operation === 'commit' ? '合成账单已提交：重复记录已去重，余额保持不变。' : '这次导入已撤销。');
    } catch (reason) { setError(missionErrorMessage(reason)); }
    finally { setBusy(false); }
  };

  const confirmBalance = async (balanceCents: number, asOf: string) => {
    setBusy(true); setError('');
    try {
      const prepared = await api<{ actionId: string }>('/api/account-snapshots/prepare', 'POST', {
        accountId: 'checking', balanceCents, currency: 'CNY', asOf
      });
      const result = await api<{ snapshot: Snapshot }>('/api/agent/action', 'POST', { actionId: prepared.actionId, decision: 'confirm' });
      onSnapshot(result.snapshot);
      setNotice('已确认工资卡余额快照。历史账单和目标存款未改变。');
    } catch (reason) { setError(missionErrorMessage(reason)); }
    finally { setBusy(false); }
  };

  const createHandoff = async (problem: 'subscription_requires_merchant' | 'import_conflict' | 'transfer_failed' | 'unsupported') => {
    setBusy(true); setError('');
    try {
      await api('/api/money-mission/handoff', 'POST', { problem });
      const next = await api<Snapshot>('/api/session');
      onSnapshot(next);
      setNotice('已生成给人工座席的说明，不含原始文件或完整账号。');
    } catch (reason) { setError(missionErrorMessage(reason)); }
    finally { setBusy(false); }
  };

  const reconcileExecution = async (id: string) => {
    setBusy(true); setError('');
    try {
      const result = await api<{ snapshot: Snapshot }>(`/api/money-mission/transfer-executions/${id}/reconcile`, 'POST', {});
      onSnapshot(result.snapshot);
    } catch (reason) { setError(missionErrorMessage(reason)); }
    finally { setBusy(false); }
  };

  if (!mission) {
    return (
      <div className="mission-page">
        <MissionState status="empty" title="还没有旅行任务" detail="先载入合成旅行任务，查看账单、订阅和储蓄计划。" actionLabel="载入旅行任务" onAction={() => void run('load')} />
      </div>
    );
  }

  const brief = model?.billBrief ?? null;
  const forecast = model?.forecast ?? null;
  const suppressed = Boolean(model?.subscriptionActions.some(action => action.nextChargeSuppressed) || mission.subscription.nextChargeSuppressed);
  const modelSchedule = model?.schedules.filter(item => ['active', 'paused', 'completed', 'cancelled'].includes(item.status)).at(-1);
  const activeSchedule = modelSchedule
    ? { id: modelSchedule.id, amountCents: modelSchedule.amountCents, status: modelSchedule.status, endDate: modelSchedule.endDate, nextEvaluationDate: modelSchedule.nextEvaluationDate }
    : mission.schedule
      ? { id: mission.schedule.id, amountCents: mission.schedule.amountCents, status: mission.schedule.status, endDate: mission.schedule.endDate, nextEvaluationDate: snapshot.clock }
      : null;
  const completed = model?.completedStages ?? [];
  const showBillsFlow = mode === 'bills' && !['planning', 'transfer', 'monitoring'].includes(viewing);
  const showSavingsFlow = mode === 'savings' || viewing === 'planning' || viewing === 'transfer';
  const prepare = (kind: NonNullable<Mission['pending']>['kind']) => void run('prepare', { kind, amountCents: Math.round(Number(amount) * 100), frequency });

  return (
    <div className="mission-page">
      <div className="mission-shell">
        <MissionStepper current={viewing} completed={completed} onSelect={selectStage} />
        <div className="mission-main">
          <header className="mission-card">
            <h2 className="text-[19px] font-bold">日本旅行 Money Mission</h2>
            <p className="text-[12px] leading-5 text-[#5A616B]">模拟数据 · 财务数字截至 {snapshot.clock}。账单只用来核对过去花了什么，不会改写工资卡、旅行金或应急金余额。</p>
            {model?.nextCta && <p className="text-[12px] text-[#0F6B6D] font-semibold">下一步：{model.nextCta.label}</p>}
          </header>
          {notice && <p role="status" className="rounded-xl bg-[#E6F2F2] p-3 text-sm">{notice}</p>}
          {error && <div role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{error}<button type="button" className="block mt-2 underline" onClick={() => setError('')}>知道了</button></div>}

          {viewing === 'goal' && (
            <section className="mission-card">
              <h2 className="font-bold">先确认日本旅行目标</h2>
              <p>目标 {money(snapshot.goal.targetCents)}，希望在 {snapshot.goal.targetDate} 前完成。已存 {money(snapshot.goal.savedCents)}，应急金保持独立。</p>
              <button type="button" className="mission-primary" onClick={() => setViewing('data')}>开始核对账单数据</button>
            </section>
          )}
          {(viewing === 'data' || preview) && (
            <>
              <StatementImportPanel uploadEnabled={uploadEnabled} busy={busy} onImportSample={sampleId => void importSample(sampleId)} onUpload={file => void uploadStatement(file)} />
              {preview && <ImportReview batch={preview.batch} issues={preview.issues} busy={busy} onResolve={(id, value) => void resolveIssue(id, value)} onCommit={() => void commitImport('commit')} onRevoke={() => void commitImport('revoke')} />}
              <BalanceSnapshotForm clock={snapshot.clock} currentCents={snapshot.finance.checkingCents} busy={busy} onSubmit={(cents, asOf) => void confirmBalance(cents, asOf)} />
              {model?.batches.filter(batch => batch.status === 'committed').map((batch, index) => <button key={batch.id} type="button" className="mission-secondary" onClick={() => setPreview({ batch, issues: model.issues.filter(issue => issue.batchId === batch.id) })}>查看已导入批次 {index + 1} · {batch.recordCount} 条 · {batch.coverageStart} 至 {batch.coverageEnd}</button>)}
            </>
          )}

          {showBillsFlow && brief && (
            <BillBrief
              brief={brief}
              suppressed={suppressed}
              minimumBalanceCents={forecast?.minimumBalanceCents ?? null}
              onOpenEvidence={() => { setFilter('全部'); setEvidence(true); }}
              onOpenCategory={category => { setFilter(CATEGORY_LABELS[category] ?? category); setEvidence(true); }}
            />
          )}
          {showBillsFlow && !brief && (
            <MissionState status="empty" title="还没有账单摘要" detail="提交合成样例后，这里会显示月度花费、变化和订阅候选。" actionLabel="导入合成样例" onAction={() => { setViewing('data'); void importSample('all'); }} />
          )}
          {showBillsFlow && (
            <SubscriptionDetail
              mission={mission}
              candidate={brief?.subscriptionCandidates.find(item => item.title === 'CloudBox Plus')}
              actions={model?.subscriptionActions ?? []}
              busy={busy}
              onPrepareCancel={() => prepare('cancel_subscription')}
              onPreference={preference => void run('preference', { preference })}
              onReconcile={() => void run('reconcile')}
            />
          )}

          {showSavingsFlow && (
            <>
              <PlanComparison
                plans={model?.plans ?? []}
                savedCents={snapshot.goal.savedCents}
                targetCents={snapshot.goal.targetCents}
                selectedLabel={planChoice}
                onSelect={plan => { setPlanChoice(plan.label); setAmount(String(plan.monthlyCents / 100)); setFrequency(plan.upfrontCents > 0 ? 'once' : 'monthly'); }}
              />
              <TransferScheduleEditor
                schedule={activeSchedule && ['active', 'paused'].includes(activeSchedule.status) ? activeSchedule : null}
                checkingCents={snapshot.finance.checkingCents}
                amount={amount}
                frequency={frequency}
                busy={busy}
                canPreview={forecast?.precision === 'exact'}
                onAmount={setAmount}
                onFrequency={setFrequency}
                onPreview={() => prepare('create_schedule')}
                onPrepare={prepare}
              />
              <TransferScheduleStatus schedule={activeSchedule} executions={model?.executions ?? []} busy={busy} onReconcile={id => void reconcileExecution(id)} />
              {modelSchedule?.frequency === 'one_time' && modelSchedule.status === 'completed' && frequency === 'once' && <button type="button" className="mission-secondary" onClick={() => { setFrequency('monthly'); setNotice('一次性转入已完成。请单独预览并确认后续月度安排。'); }}>继续安排每月储蓄</button>}
            </>
          )}

          <EvidenceDrawer open={evidence} month={month} filter={filter} rows={mission.rows} onMonth={setMonth} onFilter={setFilter} onClose={() => setEvidence(false)} />
          {mode === 'bills' && (
            <>
              <DataQualityCard batches={model?.batches ?? []} dataAsOf={model?.dataAsOf ?? snapshot.finance.updatedAt} recordCount={mission.rows.length} excludedCount={mission.rows.filter(row => row.excluded).length} />
              <button type="button" className="mission-secondary" onClick={() => setViewing('data')}>导入合成样例账单</button>
            </>
          )}
          <CashflowTimeline forecast={forecast} onSavings={mode === 'bills' ? onSavings : undefined} />
          {(viewing === 'monitoring' || (model?.notifications.length ?? 0) > 0 || (model?.repairPreviews?.length ?? 0) > 0) && (
            <MonitoringPanel
              notifications={model?.notifications ?? []}
              repairs={repairs}
              packs={model?.handoffCasePacks ?? []}
              busy={busy}
              onHandoff={problem => void createHandoff(problem)}
            />
          )}
          <ActionReceipt receipts={mission.receipts} executions={model?.executions ?? []} />
        </div>
      </div>
      {mission.pending && (
        <ActionApproval
          pending={mission.pending}
          lowCents={forecast?.minimumBalanceCents ?? null}
          busy={busy}
          error={error}
          onConfirm={() => void run('confirm', { requestId: mission.pending!.id, confirmed: true })}
          onDismiss={() => void run('dismiss')}
        />
      )}
    </div>
  );
}
