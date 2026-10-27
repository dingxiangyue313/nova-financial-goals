import type { BillBrief as BillBriefModel } from '../../../shared/money-mission';
import { money } from '../../lib/format';
import { CATEGORY_LABELS } from '../../lib/mission-copy';
import { ClaimBadge } from './ClaimBadge';

export function BillBrief({
  brief,
  suppressed,
  minimumBalanceCents,
  onOpenEvidence,
  onOpenCategory
}: {
  brief: BillBriefModel;
  suppressed: boolean;
  minimumBalanceCents: number | null;
  onOpenEvidence: () => void;
  onOpenCategory: (category: string) => void;
}) {
  const month = Number(brief.periodEnd.slice(5, 7));
  const dining = brief.changes.find(change => change.category === 'dining_delivery');
  return (
    <section className="mission-card">
      <h2 className="text-[19px] font-bold">{month} 月账单</h2>
      <p>{month} 月已计入花费 {money(brief.totalExpenseCents)}。{dining ? `外卖和餐饮比5–7月平均每月多 ${money(dining.increaseCents)}。` : ''}{suppressed ? 'CloudBox Plus 自动续费已关闭。' : 'CloudBox Plus 将在11月5日按 ¥68 续费。'}</p>
      <p>{suppressed ? '自动续费已关闭。' : '11月5日预计续费 ¥68。'}{minimumBalanceCents != null ? `工资到账前最低可用余额预计为 ${money(minimumBalanceCents)}。` : ''}</p>
      <span className="text-[12px] text-[#5A616B]">依据截至 {brief.dataAsOf}。这是事实整理，不是保证。</span>
      <div className="flex flex-wrap gap-1">{brief.claims.map(claim => <ClaimBadge key={claim.id} kind={claim.claimType} />)}</div>
      {brief.limitations.map(item => <p key={item}><ClaimBadge kind="limitation" /> {item}</p>)}
      <button type="button" className="mission-link" onClick={onOpenEvidence}>核对10月6日美团订单与退款</button>
      <h3 className="font-bold">钱主要花在哪里</h3>
      {brief.categories.map(item => (
        <button key={item.category} type="button" className="w-full text-left py-1" onClick={() => onOpenCategory(item.category)}>
          <div className="flex justify-between text-[13px]"><span>{CATEGORY_LABELS[item.category] ?? item.category}</span><span>{money(item.amountCents)} ›</span></div>
          <div className="h-1.5 bg-[#EDF2F2] rounded-full mt-1"><div className="h-full bg-[#378C8D] rounded-full" style={{ width: `${brief.totalExpenseCents ? item.amountCents / brief.totalExpenseCents * 100 : 0}%` }} /></div>
        </button>
      ))}
      <button type="button" className="mission-link" onClick={onOpenEvidence}>查看逐笔证据与排除项</button>
    </section>
  );
}
