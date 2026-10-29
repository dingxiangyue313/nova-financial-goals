import {BillInvestigationPanel} from './BillInvestigationPanel';
import {SubscriptionCard} from './SubscriptionCard';
import {SubscriptionReminderInbox} from './SubscriptionReminderInbox';
import { useEffect, useRef, useState } from 'react';
import type { ProductMission } from '../../../server/product-mission';
import type { Snapshot, StatementImportBatch, ImportIssue, BillEvidenceDetail, BillBrief } from '../../../shared/contracts';
import { api } from '../../api';
import { money } from '../../lib/format';
import { amountCents } from '../../../shared/amount';
import { CashflowTimeline } from './CashflowTimeline';
import { BillBreakdown } from './BillBreakdown';

type Preview = { batch: StatementImportBatch; issues: ImportIssue[]; contentHash: string; twinVersion: number };
type Confirmation = { actionId: string; title: string; body: string };
const labels: Record<string, string> = { dining: '餐饮外卖', dining_delivery: '餐饮外卖', housing: '住房', transport: '交通', shopping: '购物', subscriptions: '订阅', utilities: '水电', insurance: '保险', income: '收入', unclassified: '待分类' };
const errors: Record<string, string> = { TWIN_VERSION_CHANGED: '数据已更新，请关闭并重新准备。', IMPORT_CONTENT_CHANGED: '核对内容已变化，请重新读取批次。', SCHEDULE_PLAN_CHANGED: '请先确认一个当前可执行的目标方案。', SCHEDULE_ALREADY_ACTIVE: '已有有效计划，请先暂停或取消。', IMPORT_UNRESOLVED: '还有必须核对的问题，请先修正。', SCHEDULE_FORECAST_STALE: '余额或预测已变化，请刷新后重新准备。' };

function Correction({ issue, disabled, onCorrect }: { issue: ImportIssue; disabled: boolean; onCorrect: (value: string | number | boolean) => void }) {
  const [value, setValue] = useState(String(issue.correctedValue ?? ''));
  return <article className="border-t pt-3"><p>{issue.kind === 'low_confidence' ? '识别结果需要你核对' : `需要修正：${issue.field}`} · 原值 {String(issue.originalValue)}</p>
    {issue.kind === 'low_confidence' ? <button className="mission-secondary" disabled={disabled} onClick={() => onCorrect(true)}>已核对这条记录</button> : <><label>正确的{issue.field === 'date' ? '日期' : issue.field === 'amountCents' ? '金额（整数分）' : '商户'}<input className="mission-input" value={value} type={issue.field === 'date' ? 'date' : issue.field === 'amountCents' ? 'number' : 'text'} onChange={e => setValue(e.target.value)} /></label><button className="mission-secondary" disabled={disabled || !value} onClick={() => onCorrect(issue.field === 'amountCents' ? Number(value) : value)}>确认修正</button></>}
  </article>;
}

export function ProductMissionPanel({ stage, onSnapshot, onChanged,allowSchedule=true }: { stage: string; onSnapshot?: (snapshot: Snapshot) => void; onChanged: () => void;allowSchedule?:boolean }) {
  const [view, setView] = useState<ProductMission | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null), [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [evidence, setEvidence] = useState<BillEvidenceDetail | null>(null), [showRows, setShowRows] = useState(false);
  const [selectedCategory,setSelectedCategory]=useState<string|null>(null);
  const [report,setReport]=useState<BillBrief|null>(null),[revokeBatch,setRevokeBatch]=useState<string|null>(null);
  const [reportNotice,setReportNotice]=useState('');
  const [month, setMonth] = useState('2026-10'), [balance, setBalance] = useState('7240'), [uploadEnabled, setUploadEnabled] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null), lastFocus = useRef<HTMLElement | null>(null);
  const refresh = async () => { const result = await api<ProductMission>('/api/product/mission'); setView(result); onSnapshot?.(result.snapshot); if(report&&report.twinVersion!==result.snapshot.twinVersion){setReport(null);setReportNotice('数据已更新，旧报告已失效。当前显示最新月份；可重新选择原期间生成报告。');setShowRows(false);setEvidence(null);} };
  useEffect(() => { let live = true; api<ProductMission>('/api/product/mission').then(result => { if (live) { setView(result); setMonth(result.snapshot.clock.slice(0, 7)); } }).catch(e => live && setError(e.message)); api<{uploadEnabled:boolean}>('/api/capabilities').then(v => live && setUploadEnabled(v.uploadEnabled)).catch(() => {}); return () => { live = false; }; }, []);
  useEffect(() => { setShowRows(false); setEvidence(null); }, [stage]);
  useEffect(() => {
    if (!confirmation) return;
    lastFocus.current = document.activeElement as HTMLElement; dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', key); return () => { document.removeEventListener('keydown', key); lastFocus.current?.focus(); };
  }, [confirmation]);
  const run = async <T,>(fn: () => Promise<T>) => {
    setBusy(true); setError('');
    try { const result = await fn(); await refresh(); onChanged(); return result; }
    catch (reason) { const message = reason instanceof Error ? reason.message : '请求未完成'; setError(errors[message] ?? `操作未完成：${message}`); }
    finally { setBusy(false); }
  };
  const prepare = (kind: string, id?: string, extra: Record<string, unknown> = {}) => run(async () => {
    const result = await api<{confirmation:Confirmation|null}>('/api/product/prepare', 'POST', { kind, id, ...extra }); setShowRows(false); setEvidence(null); setConfirmation(result.confirmation);
  });
  const importSample = () => run(async () => { const result = await api<Preview>('/api/statement-imports/sample', 'POST', {}); setPreview(result); });
  const confirm = (decision: 'confirm' | 'cancel') => run(async () => { const next = await api<Snapshot>('/api/product/confirm', 'POST', { actionId: confirmation!.actionId, decision }); onSnapshot?.(next); setConfirmation(null); });
  const currentSchedule = view?.snapshot.transferSchedules.filter(s => ['active','paused'].includes(s.status)).at(-1);
  const brief=report??view?.brief;
  if (!view || !brief) return <p role="status">{error || '正在核对财务数据…'}</p>;
  return <div className="space-y-4 min-w-0 text-[13px] leading-relaxed">
    {error && <p role="alert" className="rounded-xl bg-amber-50 text-amber-900 p-3">{error}</p>}
    {reportNotice&&<p role="status" className="mission-card">{reportNotice}<button className="mission-link block" onClick={()=>setReportNotice('')}>知道了</button></p>}
    {view.migrationNotice&&<p role="status" className="mission-card">历史版本的数据已保留，余额、目标和原始凭证保持原值。旧版转账授权已归档停止执行，请核对当前余额并重新确认安排。</p>}
    <p className="text-xs text-[#5A616B]">模拟数据 · 数据截至 {view.snapshot.clock}。历史账单不会覆盖账户余额。</p>
    {stage === 'goal' && <div className="mission-card"><h3 className="font-bold">确认旅行目标</h3><p>{view.snapshot.goal.title} · {money(view.snapshot.goal.targetCents)} · {view.snapshot.goal.targetDate} 前；已存 {money(view.snapshot.goal.savedCents)}，应急金独立。</p></div>}
    {stage === 'data' && <>
      <div className="mission-card"><h3 className="font-bold">选择账单数据</h3><button className="mission-secondary" disabled={busy} onClick={()=>void run(()=>api('/api/product/subscription-samples','POST',{expectedTwinVersion:view.snapshot.twinVersion}))}>载入12个订阅样例（不改余额）</button><p>导入合成样例，核对后提交。工资和余额以独立银行快照为准。</p><button className="mission-primary" disabled={busy} onClick={importSample}>导入 NOVA 合成样例</button>
        <p className="text-xs">以下是不同合成画像的完整年度/YTD历史，导入后会合并分析，原基准数字会变化；账户余额保持不变。</p>
        {([['travel','旅行画像 · 2400条'],['flex','不规则消费 · 1800条'],['longterm','长期目标 · 1800条']] as const).map(([profile,label])=><button key={profile} className="mission-secondary" disabled={busy} onClick={()=>void run(async()=>setPreview(await api<Preview>('/api/product/synthetic-preview','POST',{profile})))}>{label}</button>)}
        {uploadEnabled ? <label>上传模拟账单（最大5MB）<input type="file" disabled={busy} accept=".csv,.xlsx,.pdf,.png,.jpg" onChange={e => { const file = e.target.files?.[0]; if (file) void run(async () => { const form = new FormData(); form.append('file', file); form.append('templateId', `bank-${file.name.endsWith('.csv') ? 'csv' : file.name.endsWith('.xlsx') ? 'xlsx' : file.name.endsWith('.pdf') ? 'pdf' : 'image'}-v1`); setPreview(await api<Preview>('/api/statement-imports/upload', 'POST', form)); }); e.target.value = ''; }} /></label> : <p>当前不接受个人 CSV / XLSX / PDF / 图片上传；仅开放合成样例。</p>}
      </div>
      {preview && <div className="mission-card"><h3 className="font-bold">核对导入问题</h3><p>{preview.batch.recordCount} 条 · 排除 {preview.batch.excludedCount} 条 · {preview.batch.coverageStart} 至 {preview.batch.coverageEnd}</p>
        {preview.issues.filter(i => i.severity !== 'info' && i.correctedValue === null).map(issue => <Correction key={issue.id} issue={issue} disabled={busy} onCorrect={value => void run(async () => { setPreview(await api<Preview>(`/api/statement-imports/${preview.batch.id}/issues/${issue.id}`, 'PATCH', { correctedValue: value })); })} />)}
        <button className="mission-primary" disabled={busy || preview.batch.status !== 'ready'} onClick={() => void run(async () => { await api(`/api/statement-imports/${preview.batch.id}/commit`, 'POST', { expectedTwinVersion: preview.twinVersion, expectedContentHash: preview.contentHash }); setPreview(null); })}>提交并去重</button>
      </div>}
      <div className="mission-card"><h3 className="font-bold">独立确认工资卡余额</h3><label>截至 {view.snapshot.clock} 的余额（元）<input className="mission-input" type="text" inputMode="decimal" value={balance} onChange={e => setBalance(e.target.value)} /></label><button className="mission-secondary" disabled={busy || !balance.trim()} onClick={() => {try{void prepare('balance',undefined,{balanceCents:amountCents(balance),asOf:view.snapshot.clock});}catch(e){setError(e instanceof Error?e.message:'金额格式不正确');}}}>准备确认余额</button></div>
      {view.batches.filter(b => b.status === 'committed').map(batch => <div key={batch.id} className="mission-card"><p>{batch.coverageStart}—{batch.coverageEnd} · {batch.importedCount} 条已导入历史证据</p><button className="mission-secondary" disabled={busy} onClick={() => { setRevokeBatch(batch.id); }}>撤销这次导入</button></div>)}
    </>}
    {(stage === 'bill' || stage === 'subscription') && <>
<details><summary className="mission-link min-h-11 py-3">切换账单月份或年度</summary><form className="mission-card" onSubmit={e=>{e.preventDefault();void run(async()=>{const end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10);setReport(await api<BillBrief>('/api/product/bill','POST',{periodStart:month+'-01',periodEnd:end>view.snapshot.clock?view.snapshot.clock:end}));});}}><label>账单月份<input className="mission-input" type="month" max={view.snapshot.clock.slice(0,7)} value={month} onChange={e=>setMonth(e.target.value)} /></label><button className="mission-secondary" disabled={busy}>查看月账单</button><button className="mission-secondary" type="button" disabled={busy} onClick={()=>void run(async()=>setReport(await api<BillBrief>('/api/product/bill','POST',{periodStart:month.slice(0,4)+'-01-01',periodEnd:month.slice(0,4)===view.snapshot.clock.slice(0,4)?view.snapshot.clock:month.slice(0,4)+'-12-31'})))}>查看年度 / 年内账单</button>{report&&<p>{report.periodStart} 至 {report.periodEnd} · 数据缺口和排除项仍保留证据</p>}</form></details>
      <section className="mission-card"><h2 className="text-lg font-bold">{brief.periodStart.slice(0,7)===brief.periodEnd.slice(0,7)?Number(brief.periodStart.slice(5,7))+'月账单':brief.periodStart.slice(0,4)+'年度 / 年内账单'}</h2><p className="mt-3">截至 {brief.dataAsOf} 已计入消费 {money(brief.totalExpenseCents)}。</p>{brief.changes.filter(c=>c.increaseCents!==0).map(c=><p key={c.category}>{labels[c.category]??c.category}较可比完整历史月均{c.increaseCents>0?'增加':'减少'} {money(Math.abs(c.increaseCents))}；本期尚未结束，不能视作最终月度涨幅。</p>)}<p className="text-xs text-[#5A616B] mt-2">结论依据已提供的模拟流水，不代表全部账户消费；退款和内部转账按证据排除。</p></section>
      <BillInvestigationPanel brief={brief} onChanged={refresh} onEvidence={id=>void run(async()=>setEvidence(await api<BillEvidenceDetail>('/api/money-mission/evidence/'+id)))}/>
      <BillBreakdown brief={brief} onCategory={category=>{setSelectedCategory(category);setShowRows(true);}} onEvidence={()=>{setSelectedCategory(null);setShowRows(!showRows);}} />
      {view.subscriptions.map(item=><SubscriptionCard key={item.id} item={item} actions={view.snapshot.subscriptionActions} rows={view.rows} busy={busy}
        onPrepare={()=>void prepare('subscription',item.id)} onDecision={action=>void run(()=>api(`/api/subscriptions/${item.id}/prepare`,'POST',{action}))}
        onQuery={id=>void run(()=>api(`/api/subscriptions/actions/${id}/status`,'POST',{}))} />)}
      <SubscriptionReminderInbox twinVersion={view.snapshot.twinVersion}/>
      {view.subscriptionDisputes.length>0&&<section className="mission-card"><h3 className="font-bold">停扣后仍有新扣费，需要核对</h3><p>这不是退款成功。请核对原交易与商户取消凭证；账户余额不会自动增加。</p>{view.subscriptionDisputes.map(dispute=><button key={dispute.id} className="mission-link block" onClick={()=>void run(async()=>setEvidence(await api<BillEvidenceDetail>(`/api/money-mission/evidence/${dispute.evidenceId}`)))}>{dispute.title} · {dispute.date} · {money(dispute.amountCents)} · 查看扣费证据</button>)}</section>}
      <div className="mission-card"><p>按已知账单和工资假设，最低可用余额 {view.forecast.minimumBalanceCents === null ? '待确认' : money(view.forecast.minimumBalanceCents)}。</p><p className="text-xs">未来工资不是保证，取消结果必须由商户验证。</p></div>
    </>}
    {showRows && <div className="mission-card"><h3 className="font-bold">逐笔交易证据{selectedCategory?` · ${labels[selectedCategory]??selectedCategory}`:""}</h3><button className="mission-link" onClick={()=>{setSelectedCategory(null);setShowRows(false);}}>收起流水</button><p className="text-xs text-[#5A616B]">{brief.periodStart} 至 {brief.periodEnd}</p>{view.rows.filter(r => r.date>=brief.periodStart&&r.date<=brief.periodEnd&&(!selectedCategory||r.category===selectedCategory)).map(row => <button key={row.id} className="w-full text-left border-t py-3" onClick={() => void run(async () => setEvidence(await api<BillEvidenceDetail>(`/api/money-mission/evidence/evidence-${row.id}`)))}><strong>{row.title}</strong><span className="block">{row.date} · {money(row.amountCents)} · {row.excludedReason ? '已排除，保留证据' : labels[row.category] ?? row.category}</span></button>)}</div>}
    {evidence && <div className="mission-card" role="status"><strong>已核验来源</strong><p>{evidence.label} · {evidence.dataAsOf}</p><p>{evidence.transaction && `${evidence.transaction.date} · ${money(evidence.transaction.amountCents)} · ${labels[evidence.transaction.category] ?? evidence.transaction.category}`}</p>{evidence.transaction&&evidence.transaction.amountCents<0&&!evidence.transaction.excludedReason&&<form onSubmit={e=>{e.preventDefault();const category=String(new FormData(e.currentTarget).get('category'));void run(async()=>{await api('/api/product/evidence/'+evidence.transaction!.rowId+'/category','POST',{category,expectedTwinVersion:view.snapshot.twinVersion});setEvidence(null);setReport(null);});}}><label>修正消费分类<select className="mission-input" name="category" defaultValue={evidence.transaction.category}>{Object.entries({...labels,health:'健康',education:'教育',entertainment:'娱乐'}).filter(([id])=>id!=='income'&&id!=='dining_delivery').map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><button className="mission-secondary" disabled={busy}>确认分类并重算账单</button><p>只修正历史分类，保留原始值与审计；不会改写金额和银行余额。</p></form>}<button className="mission-link" onClick={() => setEvidence(null)}>收起来源</button></div>}
    {(stage === 'plan' || stage === 'transfer') && <>
      <div className="mission-card"><h3 className="font-bold">为{view.snapshot.goal.title}选择存钱节奏</h3>{view.plans.map(plan => <article key={plan.id} className="border-t py-3"><strong>{plan.label}</strong><p>{plan.upfrontCents > 0 && `先转 ${money(plan.upfrontCents)}，再`}每月 {money(plan.monthlyCents)} · {plan.occurrences}次 · 预计 {plan.projectedDate}</p>{plan.limitations.map(l => <p key={l} className="text-xs text-[#5A616B]">{l}</p>)}<button className="mission-secondary" disabled={busy || !plan.executable} onClick={() => void prepare('plan', plan.id)}>选择并核对{plan.label}</button></article>)}</div>
      {allowSchedule&&<div className="mission-card"><h3 className="font-bold">旅行储蓄计划</h3>{currentSchedule ? <><p>每期 {money(currentSchedule.amountCents)} · {currentSchedule.status === 'active' ? '进行中' : '已暂停'}</p><p>达到目标或 {currentSchedule.endDate} 停止；缺薪跳过且不补扣。</p><button className="mission-secondary" disabled={busy} onClick={() => void prepare(currentSchedule.status === 'active' ? 'pause' : 'resume', currentSchedule.id)}>{currentSchedule.status === 'active' ? '暂停计划' : '恢复计划'}</button><button className="mission-secondary" disabled={busy} onClick={() => void prepare('cancel', currentSchedule.id)}>取消计划</button></> : <><p>从工资卡到旅行金账户，手续费 ¥0。工资实际到账后次日09:00转入；创建月度计划时不会立即扣款。</p><button className="mission-primary" disabled={busy} onClick={() => void prepare('schedule')}>预览转账安排</button>{view.plans.some(p => p.upfrontCents > 0 && p.monthlyCents === view.snapshot.goal.monthlyContributionCents) && <button className="mission-secondary" disabled={busy} onClick={() => void prepare('schedule', undefined, { recurrence: 'one_time' })}>单独预览一次性投入</button>}</>}</div>}
    </>}
    {stage === 'monitoring' && <div className="mission-card"><h3 className="font-bold">监测与处理结果</h3><p>新流水、未到账工资和执行问题会改变任务状态；不会自动扩大授权或追补扣款。</p><button className="mission-secondary" onClick={() => { void run(() => api('/api/risk/preferences', 'PATCH', { weeklySummaryEnabled: !view.snapshot.riskPreferences.weeklySummaryEnabled })); }}>每周摘要：{view.snapshot.riskPreferences.weeklySummaryEnabled ? '已开启' : '已关闭'}</button></div>}
    {view.snapshot.transferExecutions.map(item => <div className="mission-card" key={item.id}><strong>{item.period} · {item.status === 'succeeded' || item.status === 'reconciled' ? '已核对' : item.status === 'skipped_missing_trigger' ? '本期跳过' : item.status === 'unknown' ? '结果待核对' : item.status === 'failed' ? '未完成' : '已安排'}</strong><p>{item.reason}</p><p className="text-xs break-all">凭证 {item.receiptOperationId ?? item.id}</p></div>)}
    {stage==='bill'&&<details className="mission-card"><summary className="font-bold cursor-pointer min-h-11 py-2">数据覆盖与账单导入</summary><p className="my-3">{view.batches.filter(b=>b.status==='committed').reduce((n,b)=>n+b.recordCount,0)} 条历史证据 · 截至 {view.snapshot.clock}</p><ProductMissionPanel stage="data" onSnapshot={onSnapshot} onChanged={()=>{void refresh().then(onChanged);}} /></details>}
    {['bill','subscription'].includes(stage)?<details><summary className="mission-link min-h-11 py-3">查看工资前余额与日期试算</summary><CashflowTimeline baseline={view.forecast} /></details>:['plan','transfer','monitoring'].includes(stage)&&<CashflowTimeline baseline={view.forecast} />}
    {view.brief.limitations.slice(0, 3).map((line,i) => <p className="text-xs text-[#5A616B]" key={i}>限制 · {line}</p>)}
    {revokeBatch&&<div className="mission-card" role="alert"><p>确认撤销这批历史证据？账户余额保持不变，账单与预测将重新计算。</p><button className="mission-secondary" disabled={busy} onClick={()=>setRevokeBatch(null)}>保留导入</button><button className="mission-primary" disabled={busy} onClick={()=>void run(async()=>{await api('/api/statement-imports/'+revokeBatch+'/revoke','POST',{expectedTwinVersion:view.snapshot.twinVersion});setRevokeBatch(null);setReport(null);})}>确认撤销证据</button></div>}
    {confirmation && <div className="fixed inset-0 z-[90] bg-black/40 flex items-center justify-center p-4"><div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="product-confirm-title" className="mission-card w-full max-w-[350px] max-h-[80vh] overflow-auto shadow-xl"><h2 id="product-confirm-title" className="text-lg font-bold">{confirmation.title}</h2><p>{confirmation.body}</p><p>所有操作仅使用模拟数据。本确认5分钟有效，数据变化需重新准备。</p>{error && <p role="alert">{error}</p>}<button className="mission-primary" disabled={busy} onClick={() => void confirm('confirm')}>确认并执行模拟操作</button><button className="mission-secondary" disabled={busy} onClick={() => void confirm('cancel')}>暂不操作</button></div></div>}
  </div>;
}
