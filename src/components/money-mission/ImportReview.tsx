import type { ImportIssue, StatementImportBatch } from '../../../shared/money-mission';
import { useState } from 'react';

function IssueEditor({ issue, busy, onResolve }: { issue: ImportIssue; busy: boolean; onResolve: (id: string, value: string) => void }) {
  const [value, setValue] = useState(issue.correctedValue ?? (issue.field === 'category' ? '购物' : issue.originalValue));
  const label = ({ date: '正确交易日期', amountCents: '正确金额（整数分）', category: '正确分类', title: '商户名称' } as Record<string, string>)[issue.field] ?? '核对值';
  return <article className="border-t border-[#E5E8EB] pt-2">
    <strong>{issue.severity === 'blocking' ? '必须修正' : '建议核对'} · {label}</strong>
    <p>原始值：{issue.originalValue}</p>
    <label className="block">{label}
      {issue.field === 'category' ? <select value={value} disabled={busy} onChange={event => setValue(event.target.value)}>
        {['餐饮', '住房', '交通', '购物', '订阅', '水电', '保险', '工资', '退款', '内部转账'].map(category => <option key={category}>{category}</option>)}
      </select> : <input type={issue.field === 'date' ? 'date' : issue.field === 'amountCents' ? 'number' : 'text'} value={value} disabled={busy} onChange={event => setValue(event.target.value)} />}
    </label>
    <button type="button" className="mission-secondary" disabled={busy || !value.trim()} onClick={() => onResolve(issue.id, value)}>确认修正</button>
  </article>;
}

export function ImportReview({
  batch,
  issues,
  busy,
  onResolve,
  onCommit,
  onRevoke
}: {
  batch: StatementImportBatch;
  issues: ImportIssue[];
  busy: boolean;
  onResolve: (issueId: string, value: string) => void;
  onCommit: () => void;
  onRevoke: () => void;
}) {
  const blocking = issues.filter(issue => !issue.resolved && issue.severity === 'blocking');
  const review = issues.filter(issue => !issue.resolved && issue.severity !== 'blocking');
  return (
    <section className="mission-card">
      <h2 className="font-bold">核对导入问题</h2>
      <p>批次 {batch.status === 'needs_review' ? '需要核对' : batch.status === 'ready' ? '可以提交' : batch.status} · {batch.recordCount} 条 · 重复 {batch.duplicateCount} 条。</p>
      {issues.length === 0 && <p>没有需要处理的问题，可以直接提交。</p>}
      {[...blocking, ...review].filter(issue => issue.severity !== 'info').map(issue => <IssueEditor key={issue.id} issue={issue} busy={busy} onResolve={onResolve} />)}
      {batch.status !== 'committed' && batch.status !== 'revoked' && <button type="button" className="mission-primary" disabled={busy || [...blocking, ...review].some(issue => issue.severity !== 'info') || batch.status !== 'ready'} onClick={onCommit}>提交并去重</button>}
      {batch.status === 'committed' ? <button type="button" className="mission-secondary" disabled={busy} onClick={onRevoke}>撤销这次导入</button> : null}
    </section>
  );
}
