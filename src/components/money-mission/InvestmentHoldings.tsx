import { useState } from 'react';
import type { FinancialServicesView } from '../../../server/financial-services';
import type { ServiceAction } from '../../../shared/financial-services';
import { decimalUnits } from '../../../shared/amount';
import { money } from '../../lib/format';

const shares = (value: string) => {
  const units = BigInt(value);
  return `${units / 1000000n}${units % 1000000n ? '.' + String(units % 1000000n).padStart(6, '0').replace(/0+$/, '') : ''}`;
};
const status = { pending: '待结算', settled: '已到账', failed: '未完成', unknown: '结果待核对' };

export function InvestmentHoldings({ view, busy, onPrepare, onQuery, onProducts }: {
  view: FinancialServicesView; busy: boolean; onPrepare: (action: ServiceAction) => void;
  onQuery: (id: string) => void; onProducts: () => void;
}) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  return <>
    <section className="mission-card"><h2 className="font-bold">我的持仓</h2>
      <p>持仓估值 <strong>{money(view.positions.reduce((total, position) => total + position.valueCents, 0))}</strong></p>
      {!view.positions.length && <><p>暂无已确认的持仓。</p><button className="mission-secondary" onClick={onProducts}>去选择产品</button></>}
      {view.positions.map(position => {
        const available = BigInt(position.quantityMicro) - BigInt(position.reservedMicro);
        let quantity = '0';
        try { quantity = decimalUnits(amounts[position.productId] ?? '', 6); } catch { /* Incomplete input remains editable. */ }
        return <article key={position.productId} className="border-t pt-3 space-y-2">
          <h3 className="font-bold">{view.products.find(product => product.id === position.productId)?.name ?? '理财持仓'}</h3>
          <p>估值 {money(position.valueCents)} · 已确认 {shares(position.quantityMicro)} 份</p>
          <p>可申请赎回 {shares(String(available))} 份 · 处理中 {shares(position.reservedMicro)} 份</p>
          <label className="block">赎回份额<input aria-label={`赎回${view.products.find(product => product.id === position.productId)?.name ?? '产品'}份额`} className="mission-input" inputMode="decimal" placeholder="请输入份额" value={amounts[position.productId] ?? ''} onChange={event => setAmounts(current => ({ ...current, [position.productId]: event.target.value }))} /></label>
          <button className="mission-secondary" disabled={busy || BigInt(quantity) <= 0n || BigInt(quantity) > available} onClick={() => onPrepare({ kind: 'redeem', productId: position.productId, accountId: 'checking', quantityMicro: quantity })}>下一步，核对赎回</button>
        </article>;
      })}
    </section>
    <section className="mission-card"><h2 className="font-bold">交易与结算</h2>
      {!view.investments.length && <p>暂无申购或赎回记录。</p>}
      {[...view.investments].reverse().map(order => <article className="border-t pt-3 space-y-2" key={order.id}>
        <h3 className="font-bold">{view.products.find(product => product.id === order.productId)?.name ?? '理财产品'} · {order.kind === 'buy' ? '申购' : '赎回'}</h3>
        <p>{status[order.status]} · {money(order.amountCents)} · 费用 {money(order.feeCents)}</p>
        {order.status === 'pending' && <p>预计 {order.settlesOn} 结算</p>}
        {['pending', 'unknown'].includes(order.status) && <button className="mission-secondary" disabled={busy} onClick={() => onQuery(order.id)}>查询处理进度</button>}
      </article>)}
    </section>
  </>;
}
