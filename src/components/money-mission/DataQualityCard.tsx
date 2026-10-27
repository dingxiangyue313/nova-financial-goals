import type { StatementImportBatch } from '../../../shared/money-mission';

export function DataQualityCard({
  batches,
  dataAsOf,
  recordCount,
  excludedCount
}: {
  batches: StatementImportBatch[];
  dataAsOf: string;
  recordCount: number;
  excludedCount: number;
}) {
  const committed = batches.filter(batch => batch.status === 'committed');
  const coverageStart = committed.map(batch => batch.coverageStart).filter(Boolean).sort()[0];
  const coverageEnd = committed.map(batch => batch.coverageEnd).filter(Boolean).sort().at(-1);
  return (
    <section className="mission-card">
      <h2 className="font-bold">数据覆盖与时效</h2>
      <p>{coverageStart && coverageEnd ? `${coverageStart} — ${coverageEnd}` : '尚未提交账单批次'} · 三个模拟来源 · {recordCount} 条记录。</p>
      <p>{excludedCount} 条收入、退款配对或内部转账已排除消费统计。财务数字截至 {dataAsOf}，不是系统当前时间。</p>
      {committed.map(batch => <p key={batch.id}>{batch.templateId} · {batch.recordCount} 条 · {batch.committedAt ?? batch.createdAt}</p>)}
    </section>
  );
}
