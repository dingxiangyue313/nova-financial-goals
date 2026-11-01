import { useState } from 'react';
import { api } from '../../api';
import { activityCopy } from '../../lib/activity-copy';

type Detail = { summary: string; approvalRefs: string[] };

export function EvidenceLink({ id, label = '查看来源说明' }: { id: string; label?: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const toggle = async () => {
    if (detail) { setDetail(null); return; }
    setLoading(true); setError('');
    try { setDetail(await api<Detail>('/api/services/evidence/' + encodeURIComponent(id))); }
    catch { setError('暂时无法查看说明，请稍后重试。'); }
    finally { setLoading(false); }
  };
  return <div>
    <button className="mission-link min-h-11 text-left" aria-expanded={Boolean(detail)} disabled={loading} onClick={() => void toggle()}>
      {loading ? '正在加载…' : detail ? '收起说明' : label}
    </button>
    {error && <p role="alert">{error}</p>}
    {detail && <section aria-label="结果说明" className="rounded-xl bg-[#F4F7F7] p-3 space-y-2">
      <p className="text-[12px] leading-relaxed text-[#646A73]">{activityCopy(detail.summary)}</p>
      {[...new Set(detail.approvalRefs)].filter(ref => ref !== id).map(ref => <EvidenceLink id={ref} label="查看授权说明" key={ref} />)}
    </section>}
  </div>;
}
