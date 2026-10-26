import { useEffect, useState } from 'react';
import type { Snapshot } from '../../shared/contracts';
import type { Mission, MissionRow } from '../../shared/mission';
import { missionCompletionDate } from '../../shared/mission';
import { api } from '../api';

export const money = (cents: number) => `¥${(cents / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
export function billFacts(rows: MissionRow[], month = '2026-10') {
  const expense = rows.filter(r => r.date.startsWith(month) && r.cents < 0 && !r.excluded);
  const total = -expense.reduce((sum, r) => sum + r.cents, 0);
  const food = -expense.filter(r => r.category === '餐饮').reduce((sum, r) => sum + r.cents, 0);
  const baseline = -rows.filter(r => /^2026-0[567]/.test(r.date) && r.category === '餐饮' && !r.excluded).reduce((sum, r) => sum + r.cents, 0) / 3;
  return { total, food, increase: Math.round(food - baseline), expense };
}
type Forecast = { lowCents: number; lowDate: string; stressLowCents: number; assumption: string; events: { date: string; title: string; cents: number; balanceCents: number }[] };
type Props = { snapshot: Snapshot; onSnapshot: (s: Snapshot) => void; mode: 'bills' | 'savings'; onSavings: () => void };

export function MoneyMissionScreen({ snapshot, onSnapshot, mode, onSavings }: Props) {
  const m = snapshot.mission;
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [evidence, setEvidence] = useState(false); const [showImport, setShowImport] = useState(false);
  const [filter, setFilter] = useState('全部'); const [month, setMonth] = useState('2026-10');
  const [amount, setAmount] = useState(String((snapshot.mission?.schedule?.amountCents ?? 100000) / 100)); const [frequency, setFrequency] = useState<'once' | 'monthly'>('monthly');
  const [forecast, setForecast] = useState<Forecast | null>(null); const [showForecast, setShowForecast] = useState(false);
  const [notice, setNotice] = useState('');
  const [planChoice, setPlanChoice] = useState('平衡');
  const run = async (path: string, body = {}) => {
    setBusy(true); setError('');
    try { const next = await api<Snapshot>(`/api/mission/${path}`, 'POST', body); onSnapshot(next); if (path === 'import') setNotice('合成账单已核对：186条记录均已存在，未重复导入；余额保持不变。'); }
    catch (e) { setError(e instanceof Error ? e.message.replace('TWIN_VERSION_CHANGED', '数据已更新，请关闭确认并重新准备。').replace('APPROVAL_EXPIRED', '确认已过期，请重新准备。').replace('PLAN_ALREADY_EXISTS', '已有储蓄计划，请先暂停或取消。').replace('INSUFFICIENT_BALANCE', '可用余额不足，请降低金额。').replace('DATA_BALANCE_STALE', '余额数据已过期，请先更新账户。') : '操作未完成，请重试。'); }
    finally { setBusy(false); }
  };
  useEffect(() => {

  if (!m) return; let active = true; setForecast(null);
    api<Forecast>(`/api/mission/forecast?amount=${Math.round(Number(amount) * 100) || 0}`).then(f => { if (active) setForecast(f); }).catch(() => { if (active) setError('现金流暂时无法读取，请稍后重试。'); });
    return () => { active = false; };
  }, [snapshot.twinVersion, amount, m?.subscription.status]);
  useEffect(() => {
    if (!m?.pending) return;
    const previous = document.activeElement as HTMLElement | null;
    const handleKey = (event: KeyboardEvent) => {
      const dialog = document.querySelector('[aria-labelledby="mission-confirm-title"]');
      if (!dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      if (event.key === 'Tab' && controls.length) {
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); previous?.focus(); };
  }, [m?.pending?.id]);
  if (!m) return <div className="p-4"><p>先载入合成旅行任务，查看账单、订阅和储蓄计划。</p><button className="mission-primary mt-4" onClick={() => void run('load')}>载入旅行任务</button></div>;
  const facts = billFacts(m.rows, month);
  const sub = m.subscription; const pending = m.pending;
  const rows = m.rows.filter(r => r.date.startsWith(month) && (filter === '全部' || r.category === filter)).sort((a, b) => b.date.localeCompare(a.date));
  const prepare = (kind: NonNullable<Mission['pending']>['kind']) => void run('prepare', { kind, amountCents: Math.round(Number(amount) * 100), frequency });
  const preferenceLabels = { none: '', keep: '已保留订阅，继续计入预测支出。', remind: '已记录11月4日的应用内提醒；在账单页查看，不发送系统通知。', ignored: '已标记为非订阅；历史扣费仍保留，预测继续计入已知费用。' };
  return <div className="mission-page">
    <p className="text-[12px] leading-5 text-[#5A616B]">模拟数据 · 财务数字截至 {snapshot.clock}。账单只用来核对过去花了什么，不会改写工资卡、旅行金或应急金余额。</p>
    {notice && <p role="status" className="rounded-xl bg-[#E6F2F2] p-3 text-sm">{notice}</p>}
    {error && <div role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{error}<button className="block mt-2 underline" onClick={() => setError('')}>知道了</button></div>}
    {mode === 'bills' ? <>
      <section className="mission-card">
        <h2 className="text-[19px] font-bold">{Number(month.slice(5))} 月账单</h2>
        <p>{Number(month.slice(5))} 月已计入花费 {money(facts.total)}。{month === '2026-10' ? `外卖和餐饮比5–7月平均每月多 ${money(facts.increase)}。${sub.nextChargeSuppressed ? 'CloudBox Plus 自动续费已关闭。' : 'CloudBox Plus 将在11月5日按 ¥68 续费。'}` : '每一笔结论都可以查看原始交易。'}</p>
        <p>{sub.nextChargeSuppressed ? '自动续费已关闭。' : '11月5日预计续费 ¥68。'}{forecast ? `工资到账前最低可用余额预计为 ${money(forecast.lowCents)}。` : ''}</p>
        <span className="text-[12px] text-[#5A616B]">依据截至 {snapshot.clock}。这是事实整理，不是保证。</span>
        <button className="mission-link" onClick={() => { setFilter('全部'); setEvidence(true); }}>核对10月6日美团订单与退款</button>
      </section>
      <section className="mission-card">
        <h2 className="text-[16px] font-bold">{sub.nextChargeSuppressed ? '已关闭自动续费' : sub.preference === 'ignored' ? '已标记为非订阅' : '可能是订阅'}：CloudBox Plus</h2>
        <p>最近扣款 ¥68，下次预计 2026-11-05。当前付费期至 2026-11-04。比前几个月贵 ¥10。使用情况需要你自己确认。</p>
        <div className="text-[12px] leading-[22px] text-[#697386]">{m.rows.filter(r => r.merchant === 'CloudBox Plus' && r.date >= '2026-07-01').map(r => <div key={r.id}>{r.date} · {money(-r.cents)} · {r.source}</div>)}</div>
        {sub.status === 'unknown' ? <><p>取消结果待核实，尚未计入节省。</p><button className="mission-primary" disabled={busy} onClick={() => void run('reconcile')}>查询商户结果</button></> : sub.nextChargeSuppressed ? <p className="text-[#0F6B6D] font-semibold">已验证：11月5日起不再扣款 · 每月可少支出 ¥68。已支付费用不退还。</p> : <div className="grid grid-cols-2 gap-2 mt-1">
          <button className="mission-primary" disabled={busy} onClick={() => prepare('cancel_subscription')}>不再使用，准备取消</button>
          <button className="mission-secondary" disabled={busy} onClick={() => void run('preference', { preference: 'keep' })}>保留</button>
          <button className="mission-secondary" disabled={busy} onClick={() => void run('preference', { preference: 'remind' })}>续费前提醒</button>
          <button className="mission-secondary" disabled={busy} onClick={() => void run('preference', { preference: 'ignored' })}>这不是订阅</button>
        </div>}
        {sub.preference !== 'none' && <p role="status">{preferenceLabels[sub.preference]}</p>}
      </section>
      <section className="mission-card"><h2 className="font-bold">钱主要花在哪里</h2>{(['住房', '餐饮', '水电', '购物', '保险', '交通', '订阅'] as const).map(category => { const cents = -facts.expense.filter(r => r.category === category).reduce((a, r) => a + r.cents, 0); return <button key={category} className="w-full text-left py-1" onClick={() => { setFilter(category); setEvidence(true); }}><div className="flex justify-between text-[13px]"><span>{category}</span><span>{money(cents)} ›</span></div><div className="h-1.5 bg-[#EDF2F2] rounded-full mt-1"><div className="h-full bg-[#378C8D] rounded-full" style={{ width: `${facts.total ? cents / facts.total * 100 : 0}%` }} /></div></button>; })}<button className="mission-link" onClick={() => { setFilter('全部'); setEvidence(!evidence); }}>{evidence ? '收起流水' : '查看逐笔证据与排除项'}</button></section>
      {evidence && <section className="mission-card"><h2 className="font-bold">逐笔交易证据</h2><div className="flex gap-2"><label className="flex-1">月份<select aria-label="账单月份" value={month} onChange={e => setMonth(e.target.value)} className="mission-input">{[5, 6, 7, 8, 9, 10].map(n => <option key={n} value={`2026-${String(n).padStart(2, '0')}`}>{n}月</option>)}</select></label><label className="flex-1">分类<select aria-label="流水分类" value={filter} onChange={e => setFilter(e.target.value)} className="mission-input">{['全部', '餐饮', '住房', '交通', '购物', '订阅', '退款', '内部转账', '工资'].map(c => <option key={c}>{c}</option>)}</select></label></div>{rows.length ? rows.map(r => <div key={r.id} className="border-t border-[#E5E8EB] pt-2 text-[12px]"><div className="flex justify-between gap-2"><strong>{r.merchant}</strong><span className="shrink-0">{money(r.cents)}</span></div><div className="text-[#697386]">{r.date} · {r.source} · {r.excluded ? '已排除：收入、退款配对或内部转账' : r.category}</div></div>) : <p>此分类暂无交易。</p>}<p>10月6日的 ¥90 美团订单已与10月7日退款配对，不计入消费；不会重复扣减。</p></section>}
      <section className="mission-card"><h2 className="font-bold">数据覆盖与账单导入</h2><p>2026-05-01 — 2026-10-26 · 三个模拟来源 · {m.rows.length} 条记录。{m.rows.filter(r => r.excluded).length} 条收入、退款配对或内部转账已排除消费统计。</p><button className="mission-secondary" onClick={() => setShowImport(!showImport)}>导入合成样例账单</button>{showImport && <><p>比赛构建只接受内置合成 CSV。字段：日期、商户、整数分、分类与来源；不上传个人账单。现有样例再次导入会按交易ID去重，余额保持不变。</p><a className="mission-link" href="/api/mission/sample.csv" download>下载合成CSV（186条）</a><button className="mission-primary" disabled={busy} onClick={async () => { await run('import', { source: 'bundled_sample' }); setShowImport(false); }}>确认导入并去重</button></>}{m.batches.map(b => <p key={b.id} className="text-[12px]">{b.name} · {b.count} 条 · {b.at}</p>)}</section>
    </> : <>
      <section className="mission-card"><span className="text-xs text-[#0F6B6D]">日本旅行 · 2027年6月30日前</span><h2 className="text-[19px] font-bold">为旅行选一个舒服的节奏</h2><p>已存 {money(snapshot.goal.savedCents)} / {money(snapshot.goal.targetCents)}。应急金 ¥20,000 独立保护，三个方案都不动用。</p>{[{ name: '稳健', amount: 750, body: '每月¥750 · 8次 · 预计2027-06-26' }, { name: '平衡', amount: 1000, body: '每月¥1,000 · 6次 · 预计2027-04-26' }, { name: '加速', amount: 1200, body: '先转¥1,200，再每月¥1,200 · 4次 · 预计2027-02-26' }].map(p => <button key={p.name} aria-pressed={planChoice === p.name} className={`mission-secondary text-left ${planChoice === p.name ? '!border-[#0F6B6D] !bg-[#E6F2F2]' : ''}`} onClick={() => { setPlanChoice(p.name); setAmount(String(p.amount)); }}><strong>{p.name}{p.name === '平衡' ? ' · 推荐' : ''}</strong><span className="block text-xs mt-1">{p.name === '加速' ? '先单独转入¥1,200；随后' : ''}每月 {money(p.amount * 100)} · 预计 {missionCompletionDate(snapshot.clock, snapshot.goal.targetCents - snapshot.goal.savedCents, p.amount * 100, p.name === '加速' ? 120000 : 0)}</span></button>)}<p className="text-xs">日期假设工资按时到账。加速方案须先单独确认一次性转入，再创建月度计划。</p></section>
      <section className="mission-card"><h2 className="font-bold">{m.schedule ? '旅行储蓄计划' : '安排旅行金转入'}</h2>{m.schedule ? <><p>每期 {money(m.schedule.amountCents)} · {({ active: '进行中', paused: '已暂停', cancelled: '已取消', completed: '已完成' })[m.schedule.status]}</p><p>工资实际到账后次日09:00转入。27日未到账则跳过，不自动补扣。达到目标或 {m.schedule.endDate} 停止。</p>{['active', 'paused'].includes(m.schedule.status) && <div className="flex gap-2"><button className="mission-secondary flex-1" disabled={busy} onClick={() => prepare(m.schedule!.status === 'active' ? 'pause_schedule' : 'resume_schedule')}>{m.schedule.status === 'active' ? '暂停计划' : '恢复计划'}</button><button className="mission-secondary flex-1" disabled={busy} onClick={() => prepare('cancel_schedule')}>取消计划</button></div>}</> : <><label>转入金额（元）<input className="mission-input" type="number" min="1" max="6000" step="1" value={amount} onChange={e => setAmount(e.target.value)} /></label><label>频率<select className="mission-input" value={frequency} onChange={e => setFrequency(e.target.value as 'once' | 'monthly')}><option value="monthly">每月 · 工资到账后</option><option value="once">一次性 · 确认后立即转入</option></select></label><p>从：工资卡（{money(snapshot.finance.checkingCents)}）<br />到：旅行金账户 · 手续费 ¥0</p><button className="mission-primary" disabled={busy || !Number.isFinite(Number(amount)) || Number(amount) <= 0 || !forecast} onClick={() => prepare('create_schedule')}>预览转账安排</button></>}</section>
    </>}
    <section className="mission-card"><h2 className="font-bold">工资到账前，钱够用吗</h2>{forecast ? <><div className="flex justify-between"><div><span className="text-xs text-[#697386]">基准最低可用余额</span><strong className="block text-[24px] text-[#0F6B6D]">{money(forecast.lowCents)}</strong></div><div className="text-right text-xs text-[#697386]">{forecast.lowDate}<br />压力情景 {money(forecast.stressLowCents)}</div></div><p>{forecast.assumption}</p><button className="mission-link" onClick={() => setShowForecast(!showForecast)}>{showForecast ? '收起日期明细' : '查看日期级收支明细'}</button>{showForecast && forecast.events.map((e, i) => <div key={i} className="flex justify-between text-xs border-t border-[#E5E8EB] pt-2 gap-2"><div>{e.date}<br />{e.title}</div><div className="text-right shrink-0">{money(e.cents)}<br />余额 {money(e.balanceCents)}</div></div>)}</> : <p role="status">正在重算现金流…</p>}{mode === 'bills' && <button className="mission-primary" onClick={onSavings}>为日本旅行安排储蓄 →</button>}</section>
    {m.receipts.length > 0 && <section className="mission-card"><h2 className="font-bold">处理结果与凭证</h2>{[...m.receipts].reverse().map(r => <article key={r.id} className="border-t border-[#E5E8EB] pt-2"><strong className="text-[13px]">{r.date} · {({ succeeded: '已完成', failed: '未完成', unknown: '结果待核实', skipped: '本期跳过' })[r.status]}</strong><p>{r.detail}</p><span className="text-[10px] text-[#697386] break-all">凭证 {r.id}</span></article>)}</section>}
    {pending && <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-5" role="dialog" aria-modal="true" aria-labelledby="mission-confirm-title"><div className="mission-card w-full max-w-[350px] shadow-xl max-h-[85vh] overflow-y-auto"><h2 id="mission-confirm-title" className="font-bold text-lg">{pending.kind === 'cancel_subscription' ? '确认关闭自动续费' : pending.kind === 'create_schedule' ? '确认旅行金转入安排' : '确认调整储蓄计划'}</h2>{pending.kind === 'cancel_subscription' ? <><p>CloudBox Plus · ¥68/月<br />下一扣款日：2026-11-05<br />付费服务可用至：2026-11-04</p><p>确认后关闭后续自动续费，不退还已支付费用。只有商户验证成功后才计入每月 ¥68 节省。</p></> : <><p>工资卡 → 旅行金账户<br />每期 {money(pending.amountCents)} · {pending.frequency === 'once' ? '一次性，确认后立即执行' : '每月检测到工资实际到账后次日09:00'}<br />手续费 ¥0 · 应急金不动用</p><p>每月计划27日仍无工资到账则跳过、不补扣；达到目标或目标日期停止。创建月度计划时不会立即扣款。</p>{forecast && <p>预计最低可用余额 {money(forecast.lowCents)}，基于当前账单及工资按时到账假设。</p>}</>}<p className="text-xs">本确认5分钟内有效，数据变更后需重新准备。所有动作仅操作模拟账户。</p><button autoFocus className="mission-primary" disabled={busy} onClick={() => void run('confirm', { requestId: pending.id, confirmed: true })}>{busy ? '正在核对结果…' : '确认并执行模拟操作'}</button><button className="mission-secondary" disabled={busy} onClick={() => void run('dismiss')}>暂不操作</button>{error && <p role="alert" className="text-amber-800">{error}</p>}</div></div>}
  </div>;
}
