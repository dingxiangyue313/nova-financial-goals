import type { TransferExecution } from '../../../shared/money-mission';
import { money } from '../../lib/format';
import { SCHEDULE_STATUS_LABELS } from '../../lib/mission-copy';

export function TransferScheduleStatus({
  schedule,
  executions,
  busy,
  onReconcile
}: {
  schedule: { id: string; status: string; nextEvaluationDate: string } | null;
  executions: TransferExecution[];
  busy: boolean;
  onReconcile: (id: string) => void;
}) {
  if (!schedule) return null;
  const related = executions.filter(item => item.scheduleId === schedule.id);
  if (!related.length) return null;
  return (
    <section className="mission-card">
      <h2 className="font-bold">转入执行记录</h2>
      <p>计划状态：{SCHEDULE_STATUS_LABELS[schedule.status] ?? schedule.status}。下次评估 {schedule.nextEvaluationDate}。</p>
      {related.map(item => (
        <article key={item.id} className="border-t border-[#E5E8EB] pt-2">
          <strong>{item.periodKey} · {item.status === 'skipped_missing_trigger' ? '本期跳过' : item.status === 'succeeded' ? '已完成' : item.status === 'failed' ? '未完成' : item.status === 'unknown' ? '结果待核实' : '已安排'}</strong>
          <p>{item.reason} · {money(item.amountCents)}</p>
          {['failed', 'unknown'].includes(item.status) && (
            <button type="button" className="mission-secondary" disabled={busy} onClick={() => onReconcile(item.id)}>查询这次转入结果</button>
          )}
        </article>
      ))}
    </section>
  );
}
