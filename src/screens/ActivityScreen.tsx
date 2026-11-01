import { useEffect, useState } from 'react';
import type { FinancialServicesView } from '../../server/financial-services';
import type { ServiceAction } from '../../shared/financial-services';
import { api } from '../api';
import { EvidenceLink } from '../components/money-mission/EvidenceLink';
import { activityCopy } from '../lib/activity-copy';

const status: Record<string, string> = {
  pending: '待结算', settled: '已到账', unknown: '结果待核对', failed: '未完成',
  succeeded: '已完成', under_review: '审核中', withdrawn: '已撤回', approved: '已通过',
  rejected: '未通过', open: '待收款', partial: '部分到账', collected: '已收齐',
  closed: '已关闭', confirmed: '已确认', refund_pending: '退款在途', refunded: '已退款',
  revoked: '已撤销', submitted: '已提交', active: '正常', locked: '临时锁定', lost: '已挂失',
};

const category: Record<ServiceAction['kind'], string> = {
  goal_contract: '目标资金', portfolio_repair: '目标资金', allocate: '目标资金',
  goal_notifications: '目标资金',
  transfer: '转账与AA', split: '转账与AA', pay_split_share: '转账与AA',
  reschedule_split: '转账与AA', close_split: '转账与AA',
  verify_recipient: '转账与AA', review_recipient: '转账与AA',
  risk_profile: '理财', investment_questionnaire: '理财', buy: '理财', redeem: '理财',
  card: '卡片', apply_card: '卡片', replace_card: '卡片',
  withdraw_card_application: '卡片', supplement_card_application: '卡片',
  subscription_card: '卡片',
  travel_request_decision: '旅行请求', mandate: '旅行请求', revoke_mandate: '旅行请求',
  book: '旅行请求', cancel_booking: '旅行请求',
};

function receiptCategory(kind: string): string {
  if (Object.hasOwn(category, kind)) return category[kind as ServiceAction['kind']];
  if (kind.includes('subscription') || kind.includes('bill') || kind === 'statement_import') return '账单与订阅';
  return '金融服务';
}

export function ActivityScreen({ twinVersion, onChanged }: { twinVersion: number; onChanged: () => void }) {
  const [view, setView] = useState<FinancialServicesView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    api<FinancialServicesView>('/api/services').then(value => {
      if (live) { setView(value); setError(''); }
    }).catch(() => { if (live) setError('暂时无法加载任务结果，请重试。'); });
    return () => { live = false; };
  }, [twinVersion, reload]);

  const reconcile = async (id: string) => {
    setBusy(true); setError('');
    try {
      await api('/api/services/reconcile', 'POST', { id });
      setReload(value => value + 1);
      onChanged();
    } catch { setError('暂时无法查询结果，请稍后重试。'); }
    finally { setBusy(false); }
  };

  return <div className="flex-1 flex flex-col pt-2 pb-safe px-4 overflow-y-auto no-scrollbar space-y-3">
    <div>
      <h2 className="text-[18px] font-bold text-[#1F2329]">收支动态与脉络</h2>
      <p className="text-[12px] text-[#646A73]">金融任务结果与凭证 · 仅模拟数据</p>
    </div>
    {error && <div role="alert" className="rounded-xl border bg-white p-3.5 text-[12px] text-[#646A73]">
      <p>{error}</p><button className="mt-2 text-[#0F6B6D] font-semibold" onClick={() => setReload(value => value + 1)}>重新加载</button>
    </div>}
    {!view && !error && <p role="status" className="text-[12px] text-[#646A73]">正在加载任务凭证…</p>}
    {view && view.receipts.length === 0 && <div className="bg-white border border-[#E5E8EB] rounded-xl p-3.5 shadow-sm text-[12px] text-[#646A73]">暂无金融任务结果与凭证。</div>}
    <div className="space-y-3">
      {view && [...view.receipts].reverse().map(receipt => {
        const pending = ['pending', 'unknown'].includes(receipt.status);
        const tagColor = receipt.status === 'failed'
          ? 'bg-red-50 text-red-600 border-red-200'
          : pending ? 'bg-amber-50 text-amber-800 border-amber-200'
          : 'bg-teal-50 text-teal-700 border-teal-200';
        return <article key={receipt.id} className="bg-white border border-[#E5E8EB] rounded-xl p-3.5 shadow-sm space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold ${tagColor}`}>{status[receipt.status] ?? '待核对'}</span>
          </div>
          <h3 className="text-[14px] font-bold text-[#1F2329]">{receiptCategory(receipt.kind)}</h3>
          <p className="text-[12px] text-[#646A73] leading-relaxed">{activityCopy(receipt.label)}</p>
          <div className="text-[12px] text-[#646A73] leading-relaxed"><EvidenceLink id={receipt.operationId} label="查看结果说明" /></div>
          {pending && <button disabled={busy} onClick={() => void reconcile(receipt.operationId)} className="w-full py-2 bg-[#E6F2F2] hover:bg-[#0F6B6D] hover:text-white text-[#0F6B6D] rounded-lg text-[12px] font-semibold transition-colors cursor-pointer disabled:opacity-40">查询此原操作</button>}
        </article>;
      })}
    </div>
  </div>;
}
