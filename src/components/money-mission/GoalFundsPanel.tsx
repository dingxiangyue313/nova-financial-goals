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
      <p className="text-lg font-bold">已分配 {money(goal.coveredCents)} <span className="text-xs font-normal text-[#5A616B]">/ 目标 {money(goal.targetCents)}</span></p>
      <div className="h-2 overflow-hidden rounded-full bg-[#F0F2F5]"><div className="h-full rounded-full bg-[#0F6B6D]" style={{ width: `${Math.min(100, goal.coveredCents / Math.max(1, goal.targetCents) * 100)}%` }} /></div>
      <dl className="space-y-2 text-[13px]">
        <div className="flex justify-between"><dt>分配资金</dt><dd>{money(goal.cashCents)}</dd></div>
        <div className="flex justify-between"><dt>订单预留</dt><dd>{money(goal.heldCents)}</dd></div>
        <div className="flex justify-between"><dt>已付订单</dt><dd>{money(goal.bookedCents)}</dd></div>
        <div className="flex justify-between font-semibold text-[#0F6B6D]"><dt>当前可支付</dt><dd>{money(goal.spendableCents)}</dd></div>
      </dl>
    </section>}
    <section className="mission-card"><h2 className="font-bold">调整资金分配</h2>
      <p>{account?.label ?? '工资卡'} · 未占用资金 {money(account?.availableCents ?? 0)}</p>
      <label>此目标在工资卡中保留的总额（元）<input className="mission-input" inputMode="decimal" value={amount} onChange={event => onAmount(event.target.value)} /></label>
      <p className="text-xs">这是目标资金归属设置，不会发起银行转账。填写的是调整后的总额。</p>
      <button className="mission-primary" disabled={busy || !goal || !amount.trim()} onClick={onPreview}>下一步，核对资金分配</button>
    </section>
  </>;
}
