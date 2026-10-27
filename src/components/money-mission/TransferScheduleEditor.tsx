import { money } from '../../lib/format';
import { SCHEDULE_STATUS_LABELS } from '../../lib/mission-copy';

type ScheduleView = { amountCents: number; status: string; endDate: string };

export function TransferScheduleEditor({
  schedule,
  checkingCents,
  amount,
  frequency,
  busy,
  canPreview,
  onAmount,
  onFrequency,
  onPreview,
  onPrepare
}: {
  schedule: ScheduleView | null;
  checkingCents: number;
  amount: string;
  frequency: 'once' | 'monthly';
  busy: boolean;
  canPreview: boolean;
  onAmount: (value: string) => void;
  onFrequency: (value: 'once' | 'monthly') => void;
  onPreview: () => void;
  onPrepare: (kind: 'pause_schedule' | 'resume_schedule' | 'cancel_schedule') => void;
}) {
  if (schedule && ['active', 'paused', 'completed', 'cancelled'].includes(schedule.status)) {
    return (
      <section className="mission-card">
        <h2 className="font-bold">旅行储蓄计划</h2>
        <p>每期 {money(schedule.amountCents)} · {SCHEDULE_STATUS_LABELS[schedule.status] ?? schedule.status}</p>
        <p>工资实际到账后次日09:00转入。27日未到账则跳过，不自动补扣。达到目标或 {schedule.endDate} 停止。</p>
        {['active', 'paused'].includes(schedule.status) && (
          <div className="flex gap-2">
            <button type="button" className="mission-secondary flex-1" disabled={busy} onClick={() => onPrepare(schedule.status === 'active' ? 'pause_schedule' : 'resume_schedule')}>{schedule.status === 'active' ? '暂停计划' : '恢复计划'}</button>
            <button type="button" className="mission-secondary flex-1" disabled={busy} onClick={() => onPrepare('cancel_schedule')}>取消计划</button>
          </div>
        )}
      </section>
    );
  }
  return (
    <section className="mission-card">
      <h2 className="font-bold">安排旅行金转入</h2>
      <label>转入金额（元）
        <input className="mission-input" type="number" min="1" max="6000" step="1" value={amount} onChange={event => onAmount(event.target.value)} />
      </label>
      <label>频率
        <select className="mission-input" value={frequency} onChange={event => onFrequency(event.target.value as 'once' | 'monthly')}>
          <option value="monthly">每月 · 工资到账后</option>
          <option value="once">一次性 · 确认后立即转入</option>
        </select>
      </label>
      <p>从：工资卡（{money(checkingCents)}）<br />到：旅行金账户 · 手续费 ¥0</p>
      <p>26 日只是预计执行日。确认页会写明：实际由工资识别触发，缺失则跳过。</p>
      <button type="button" className="mission-primary" disabled={busy || !canPreview || !Number.isFinite(Number(amount)) || Number(amount) <= 0} onClick={onPreview}>预览转账安排</button>
    </section>
  );
}
