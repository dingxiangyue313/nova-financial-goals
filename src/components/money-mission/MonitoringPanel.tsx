import type { HandoffCasePack, MissionNotification, MissionRepairPreview } from '../../../shared/money-mission';
import { NOTIFICATION_LABELS } from '../../lib/mission-copy';
import { ClaimBadge } from './ClaimBadge';

export function MonitoringPanel({
  notifications,
  repairs,
  packs,
  busy,
  onHandoff
}: {
  notifications: MissionNotification[];
  repairs: MissionRepairPreview[];
  packs: HandoffCasePack[];
  busy: boolean;
  onHandoff: (problem: 'subscription_requires_merchant' | 'import_conflict' | 'transfer_failed' | 'unsupported') => void;
}) {
  return (
    <section className="mission-card">
      <h2 className="font-bold">监测、修复预览与人工交接</h2>
      <p>修复建议只是预览，确认前不会改写储蓄计划或重复扣款。</p>
      {notifications.length === 0 && <p>目前没有需要处理的重要变化。</p>}
      {notifications.map(item => (
        <article key={item.id} className="border-t border-[#E5E8EB] pt-2">
          <strong>{NOTIFICATION_LABELS[item.kind] ?? '需要关注的变化'}</strong>
          <p>{item.body}</p>
          <span className="text-[11px] text-[#697386]">{item.status === 'unread' ? '未处理' : item.status === 'resolved' ? '已处理' : '已记下'}</span>
        </article>
      ))}
      {repairs.map(item => (
        <article key={item.id} className="border-t border-[#E5E8EB] pt-2">
          <strong>{item.label}</strong>
          <p>{item.explanation}</p>
          <ClaimBadge kind="assumption" />
          <p>这条建议不会立即生效。</p>
        </article>
      ))}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="mission-secondary" disabled={busy} onClick={() => onHandoff('subscription_requires_merchant')}>生成商户交接说明</button>
        <button type="button" className="mission-secondary" disabled={busy} onClick={() => onHandoff('transfer_failed')}>生成转账问题说明</button>
      </div>
      {packs.map(pack => (
        <article key={pack.id} className="border-t border-[#E5E8EB] pt-2">
          <strong>人工交接说明 · {pack.goalTitle}</strong>
          <p>{pack.problem === 'subscription_requires_merchant' ? '需要在商户处完成取消' : pack.problem === 'transfer_failed' ? '模拟转入未完成' : pack.problem === 'import_conflict' ? '账单数据存在冲突' : '当前请求超出自动处理范围'}</p>
          <ul className="text-[12px] text-[#5A616B] list-disc pl-4">
            {pack.facts.map(fact => <li key={fact}>{fact}</li>)}
          </ul>
          <p>只包含已核对事实和待问问题，不含原始文件或完整账号。</p>
        </article>
      ))}
    </section>
  );
}
