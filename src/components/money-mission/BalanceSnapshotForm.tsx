import { useState } from 'react';
import { money } from '../../lib/format';

export function BalanceSnapshotForm({
  clock,
  currentCents,
  busy,
  onSubmit
}: {
  clock: string;
  currentCents: number;
  busy: boolean;
  onSubmit: (balanceCents: number, asOf: string) => void;
}) {
  const [yuan, setYuan] = useState(String(currentCents / 100));
  const [asOf, setAsOf] = useState(clock);
  const cents = Math.round(Number(yuan) * 100);
  return (
    <section className="mission-card">
      <h2 className="font-bold">确认工资卡余额</h2>
      <p>账单只解释已经发生的支出。当前可用余额需要单独确认，不会从流水自动加减。</p>
      <p>服务端记录的最近余额 {money(currentCents)}，截至 {clock}。</p>
      <label>确认金额（元）
        <input className="mission-input" type="number" min="0" step="1" value={yuan} onChange={event => setYuan(event.target.value)} />
      </label>
      <label>余额日期
        <input className="mission-input" type="date" value={asOf} max={clock} onChange={event => setAsOf(event.target.value)} />
      </label>
      <button type="button" className="mission-primary" disabled={busy || !Number.isFinite(cents) || cents < 0} onClick={() => onSubmit(cents, asOf)}>准备确认余额快照</button>
    </section>
  );
}
