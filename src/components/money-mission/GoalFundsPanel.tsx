import type { FinancialServicesView } from '../../../server/financial-services';
import { money } from '../../lib/format';

export function GoalFundsPanel({ view, goalId, onGoal, amount, onAmount, busy, onPreview }: {
  view: FinancialServicesView; goalId: string; onGoal: (id: string) => void;
  amount: string; onAmount: (amount: string) => void; busy: boolean; onPreview: () => void;
}) {
  const goal = view.goals.find(item => item.id === goalId);
  const account = view.accounts.find(item => item.id === 'checking');
  return <>
    <section className="mission-card"><h2 className="font-bold">资金分配</h2>
      <label>选择目标<select aria-label="选择资金分配目标" className="mission-input" value={goalId} onChange={event => onGoal(event.target.value)}>{view.goals.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      {!view.goals.length && <p>暂无目标，请先创建目标计划。</p>}
    </section>
    {goal && <section className="mission-card" aria-label="目标资金明细">
      <h2 className="font-bold">{goal.title}</h2>
      <p className="text-xs text-[#5A616B]">目标现金与有效订单 · 可核对的资金去向</p>
      <p className="text-lg font-bold text-[#0F6B6D]">{money(goal.coveredCents)} <span className="text-xs font-normal text-[#5A616B]">/ 目标 {money(goal.targetCents)}</span></p>
      <p>{goal.funded?'Money Mission 已覆盖':'Money Mission 仍有缺口'}{!goal.funded&&` ${money(goal.targetCents-goal.coveredCents)}`}</p>
      <div className="h-2 overflow-hidden rounded-full bg-[#F0F2F5]"><div className="h-full rounded-full bg-[#0F6B6D]" style={{ width: `${Math.min(100, goal.coveredCents / Math.max(1, goal.targetCents) * 100)}%` }} /></div>
      <dl className="space-y-2 text-[13px]">
        <div className="flex justify-between"><dt>目标现金（含预留）</dt><dd>{money(goal.cashCents)}</dd></div>
        <div className="flex justify-between"><dt>其中：订单预留</dt><dd>{money(goal.heldCents)}</dd></div>
        <div className="flex justify-between"><dt>有效机票与住宿订单</dt><dd>{money(goal.bookedCents)}</dd></div>
        <div className="flex justify-between font-semibold text-[#0F6B6D]"><dt>当前可支付</dt><dd>{money(goal.spendableCents)}</dd></div>
      </dl>
      <p className="text-xs text-[#5A616B]">覆盖金额＝目标现金＋有效订单；预留已包含在现金中，不重复相加。</p>
      <div className="border-t pt-3 space-y-2 text-xs"><p><strong>Unknown · 结果待核对：</strong>保留预留，查询原操作；不计为有效订单，不重复支付。</p><p><strong>退款在途：</strong>独立记录缺口，到账前不计入可用现金。</p><p><strong>部分失败：</strong>保留成功订单，只修复失败部分。可前往旅行请求 → 我的订单查询与恢复。</p></div>
    </section>}
    <section className="mission-card"><h2 className="font-bold">调整资金分配</h2>
      <p>{account?.label ?? '工资卡'} · 未占用资金 {money(account?.availableCents ?? 0)}</p>
      <label>此目标在工资卡中保留的总额（元）<input className="mission-input" inputMode="decimal" value={amount} onChange={event => onAmount(event.target.value)} /></label>
      <p className="text-xs">这是目标资金归属设置，不会发起银行转账。填写的是调整后的总额。</p>
      <button className="mission-primary" disabled={busy || !goal || !amount.trim()} onClick={onPreview}>下一步，核对资金分配</button>
    </section>
  </>;
}
