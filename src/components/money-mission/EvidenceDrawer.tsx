import { useEffect, useRef } from 'react';
import type { MissionRow } from '../../../shared/mission';
import { money } from '../../lib/format';

export function EvidenceDrawer({
  open,
  month,
  filter,
  rows,
  onMonth,
  onFilter,
  onClose
}: {
  open: boolean;
  month: string;
  filter: string;
  rows: MissionRow[];
  onMonth: (value: string) => void;
  onFilter: (value: string) => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  const visible = rows.filter(row => row.date.startsWith(month) && (filter === '全部' || row.category === filter)).sort((a, b) => b.date.localeCompare(a.date));
  return (
    <section className="mission-card" role="dialog" aria-modal="true" aria-labelledby="mission-evidence-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="mission-evidence-title" className="font-bold">逐笔交易证据</h2>
        <button ref={closeRef} type="button" className="mission-link" onClick={onClose}>收起流水</button>
      </div>
      <div className="flex gap-2">
        <label className="flex-1">月份
          <select aria-label="账单月份" value={month} onChange={event => onMonth(event.target.value)} className="mission-input">
            {[5, 6, 7, 8, 9, 10].map(n => <option key={n} value={`2026-${String(n).padStart(2, '0')}`}>{n}月</option>)}
          </select>
        </label>
        <label className="flex-1">分类
          <select aria-label="流水分类" value={filter} onChange={event => onFilter(event.target.value)} className="mission-input">
            {['全部', '餐饮', '住房', '交通', '购物', '订阅', '退款', '内部转账', '工资'].map(item => <option key={item}>{item}</option>)}
          </select>
        </label>
      </div>
      {visible.length ? visible.map(row => (
        <div key={row.id} className="border-t border-[#E5E8EB] pt-2 text-[12px]">
          <div className="flex justify-between gap-2"><strong>{row.merchant}</strong><span className="shrink-0">{money(row.cents)}</span></div>
          <div className="text-[#697386]">{row.date} · {row.source} · {row.excluded ? '已排除：收入、退款配对或内部转账' : row.category}</div>
        </div>
      )) : <p>此分类暂无交易。</p>}
      <p>10月6日的 ¥90 美团订单已与10月7日退款配对，不计入消费；不会重复扣减。</p>
    </section>
  );
}
