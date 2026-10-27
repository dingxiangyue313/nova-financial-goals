import type { Mission } from '../../../shared/mission';
import type { TransferExecution } from '../../../shared/money-mission';

const RECEIPT_STATUS = { succeeded: '已完成', failed: '未完成', unknown: '结果待核实', skipped: '本期跳过' } as const;
const EXECUTION_STATUS: Record<TransferExecution['status'], string> = {
  scheduled: '已安排',
  succeeded: '已完成',
  failed: '未完成',
  unknown: '结果待核实',
  skipped_missing_trigger: '本期跳过',
  reconciled: '已核对'
};

export function ActionReceipt({
  receipts,
  executions
}: {
  receipts: Mission['receipts'];
  executions: TransferExecution[];
}) {
  if (!receipts.length && !executions.length) return null;
  return (
    <section className="mission-card">
      <h2 className="font-bold">处理结果与凭证</h2>
      {[...receipts].reverse().map(receipt => (
        <article key={receipt.id} className="border-t border-[#E5E8EB] pt-2">
          <strong className="text-[13px]">{receipt.date} · {RECEIPT_STATUS[receipt.status]}</strong>
          <p>{receipt.detail}</p>
          <span className="text-[10px] text-[#697386] break-all">凭证 {receipt.id}</span>
        </article>
      ))}
      {executions.map(item => (
        <article key={item.id} className="border-t border-[#E5E8EB] pt-2">
          <strong className="text-[13px]">{item.periodKey} · {EXECUTION_STATUS[item.status]}</strong>
          <p>{item.reason}</p>
          <span className="text-[10px] text-[#697386] break-all">转账凭证 {item.id}{item.operationId ? ` · 操作 ${item.operationId}` : ''}</span>
        </article>
      ))}
    </section>
  );
}
