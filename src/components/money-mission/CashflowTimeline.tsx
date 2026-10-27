import { useState } from 'react';
import type { DatedCashflowForecast } from '../../../shared/money-mission';
import { money } from '../../lib/format';
import { ClaimBadge } from './ClaimBadge';

export function CashflowTimeline({
  forecast,
  onSavings
}: {
  forecast: DatedCashflowForecast | null;
  onSavings?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="mission-card">
      <h2 className="font-bold">工资到账前，钱够用吗</h2>
      {forecast ? (
        <>
          <div className="flex justify-between">
            <div>
              <span className="text-xs text-[#697386]">基准最低可用余额</span>
              <strong className="block text-[24px] text-[#0F6B6D]">{forecast.minimumBalanceCents == null ? '数据不足' : money(forecast.minimumBalanceCents)}</strong>
            </div>
            <div className="text-right text-xs text-[#697386]">{forecast.minimumBalanceDate}<br />{forecast.precision === 'exact' ? '精确到日' : forecast.precision === 'range' ? '区间估计' : '余额不足，无法给出确定低谷'}</div>
          </div>
          {forecast.assumptions.map(item => <p key={item}><ClaimBadge kind="assumption" /> {item}</p>)}
          {forecast.limitations.map(item => <p key={item}><ClaimBadge kind="limitation" /> {item}</p>)}
          <p>26 日只是预计执行日。实际转入以工资识别为准，缺失则跳过、不补扣。这是预测，不是保证。</p>
          <button type="button" className="mission-link" onClick={() => setOpen(!open)}>{open ? '收起日期明细' : '查看日期级收支明细'}</button>
          {open && forecast.events.map(event => (
            <div key={event.id} className="flex justify-between text-xs border-t border-[#E5E8EB] pt-2 gap-2">
              <div>{event.date}<br />{event.label} · <ClaimBadge kind={event.claimType} /></div>
              <div className="text-right shrink-0">{money(event.amountCents)}<br />余额 {money(event.balanceCents)}</div>
            </div>
          ))}
        </>
      ) : <p role="status">正在重算现金流…</p>}
      {onSavings && <button type="button" className="mission-primary" onClick={onSavings}>为日本旅行安排储蓄 →</button>}
    </section>
  );
}
