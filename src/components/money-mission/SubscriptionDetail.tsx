import type { Mission } from '../../../shared/mission';
import type { BillBrief, SubscriptionAction } from '../../../shared/money-mission';
import { money } from '../../lib/format';
import { ClaimBadge } from './ClaimBadge';

const PREFERENCE_LABELS = {
  none: '',
  keep: '已保留订阅，继续计入预测支出。',
  remind: '已记录11月4日的应用内提醒；在账单页查看，不发送系统通知。',
  ignored: '已标记为非订阅；历史扣费仍保留，预测继续计入已知费用。'
};

export function SubscriptionDetail({
  mission,
  candidate,
  actions,
  busy,
  onPrepareCancel,
  onPreference,
  onReconcile
}: {
  mission: Mission;
  candidate?: BillBrief['subscriptionCandidates'][number];
  actions: SubscriptionAction[];
  busy: boolean;
  onPrepareCancel: () => void;
  onPreference: (preference: 'keep' | 'remind' | 'ignored') => void;
  onReconcile: () => void;
}) {
  const sub = mission.subscription;
  const lastCancel = actions.filter(action => action.subscriptionId === 'cloudbox' && action.action === 'cancel').at(-1);
  const heading = sub.nextChargeSuppressed ? '已关闭自动续费' : sub.preference === 'ignored' ? '已标记为非订阅' : '可能是订阅';
  return (
    <section className="mission-card">
      <h2 className="text-[16px] font-bold">{heading}：CloudBox Plus</h2>
      <p>最近扣款 ¥68，下次预计 {candidate?.nextChargeDate ?? '2026-11-05'}。当前付费期至 2026-11-04。比前几个月贵 ¥10。使用情况需要你自己确认。</p>
      <ClaimBadge kind="assumption" />
      <div className="text-[12px] leading-[22px] text-[#697386]">
        {mission.rows.filter(row => row.merchant === 'CloudBox Plus' && row.date >= '2026-07-01').map(row => (
          <div key={row.id}>{row.date} · {money(-row.cents)} · {row.source}</div>
        ))}
      </div>
      {sub.status === 'unknown' || lastCancel?.status === 'unknown' ? (
        <>
          <p>取消结果待核实，尚未计入节省。</p>
          <button type="button" className="mission-primary" disabled={busy} onClick={onReconcile}>查询商户结果</button>
        </>
      ) : lastCancel?.status === 'requires_merchant' || lastCancel?.status === 'failed' ? (
        <>
          <p>需要你在商户处完成取消，或商户暂时失败。NOVA 不会重复提交，也不会提前计入节省。</p>
          <button type="button" className="mission-primary" disabled={busy} onClick={onPrepareCancel}>不再使用，准备取消</button>
          <button type="button" className="mission-secondary" disabled={busy} onClick={() => onPreference('keep')}>保留 CloudBox Plus</button>
        </>
      ) : sub.nextChargeSuppressed ? (
        <p className="text-[#0F6B6D] font-semibold">已验证：11月5日起不再扣款 · 每月可少支出 ¥68。已支付费用不退还。</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 mt-1">
          <button type="button" className="mission-primary" disabled={busy} onClick={onPrepareCancel}>不再使用，准备取消</button>
          <button type="button" className="mission-secondary" disabled={busy} onClick={() => onPreference('keep')}>保留</button>
          <button type="button" className="mission-secondary" disabled={busy} onClick={() => onPreference('remind')}>续费前提醒</button>
          <button type="button" className="mission-secondary" disabled={busy} onClick={() => onPreference('ignored')}>这不是订阅</button>
        </div>
      )}
      {sub.preference !== 'none' && <p role="status">{PREFERENCE_LABELS[sub.preference]}</p>}
    </section>
  );
}
