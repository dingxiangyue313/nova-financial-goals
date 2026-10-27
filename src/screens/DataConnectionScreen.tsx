import { useEffect, useState } from 'react';
import type { DataConnection, DataSourceKind } from '../../shared/contracts';

const sources: Array<{ source: DataSourceKind; label: string; icon: string; detail: string }> = [
  { source: 'bank', label: '银行卡', icon: 'account_balance', detail: '余额、工资与固定账单' },
  { source: 'wechat_pay', label: '微信支付', icon: 'chat', detail: '近 90 天模拟消费流水' },
  { source: 'alipay', label: '支付宝', icon: 'payments', detail: '近 90 天模拟消费流水' },
];

interface Props {
  connections: DataConnection[];
  onboarding: boolean;
  busy: boolean;
  onConnect: (sources: DataSourceKind[]) => Promise<void>;
  onRevoke: (source: DataSourceKind) => Promise<void>;
  onRetry: (source: DataSourceKind) => Promise<void>;
  onBack: () => void;
}

function dateLabel(value: string | null) {
  if (!value) return '尚未同步';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export function DataConnectionScreen({ connections, onboarding, busy, onConnect, onRevoke, onRetry }: Props) {
  const active = connections.filter(item => item.status === 'connected').map(item => item.source);
  const [selected, setSelected] = useState<DataSourceKind[]>(active.length ? active : sources.map(item => item.source));
  useEffect(() => {
    if (active.length) setSelected(active);
  // Connection status is the only external state that should reset the selection.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connections.map(item => `${item.source}:${item.status}`).join('|')]);

  const toggle = (source: DataSourceKind) => setSelected(current => current.includes(source)
    ? current.filter(item => item !== source) : [...current, source]);

  return (
    <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-3 space-y-3.5">
      <section className="space-y-1">
        <div className="inline-flex items-center gap-1 rounded-full bg-[#E6F2F2] px-2 py-1 text-[11px] font-semibold text-[#0F6B6D]">
          <span className="material-symbols-outlined text-[14px]">science</span>
          全部为模拟数据
        </div>
        <h2 className="text-[21px] font-bold text-[#1F2329]">连接模拟数据</h2>
        <p className="text-[13px] leading-relaxed text-[#5A616B]">
          NOVA 读取余额与近 90 天流水，判断目标能否按时实现，并只在目标或安全资金真正受影响时提醒你。
        </p>
      </section>

      <section className="rounded-xl border border-[#D8E4E4] bg-[#F2FAFA] p-3 text-[12px] leading-relaxed text-[#3F5556]">
        <div className="mb-1 flex items-center gap-1.5 font-bold text-[#0F6B6D]">
          <span className="material-symbols-outlined text-[17px]">visibility</span>
          只读范围
        </div>
        <p>读取余额、时间、金额、商户摘要和模拟分类；不读取联系人、聊天或位置。</p>
        <p className="mt-1 font-semibold">连接不会授权扣款、转账或创建外部 Agent 授权。</p>
      </section>

      <fieldset className="space-y-2.5">
        <legend className="mb-2 text-[13px] font-bold text-[#1F2329]">选择数据来源</legend>
        {sources.map(source => {
          const connection = connections.find(item => item.source === source.source);
          const checked = selected.includes(source.source);
          return (
            <section key={source.source} aria-label={`${source.label}数据来源`} className={`rounded-xl border bg-white p-3 shadow-sm ${checked ? 'border-[#0F6B6D]' : 'border-[#E5E8EB]'}`}>
              <div className="flex items-start gap-2.5">
                <input aria-label={`${source.label}模拟数据`} type="checkbox" checked={checked}
                  onChange={() => toggle(source.source)} className="mt-1 h-4 w-4 accent-[#0F6B6D]" />
                <span className="material-symbols-outlined mt-0.5 text-[20px] text-[#0F6B6D]">{source.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[14px] font-bold text-[#1F2329]">{source.label}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${connection?.status === 'connected'
                      ? 'bg-[#EBF7F2] text-[#276B4E]' : connection?.status === 'revoked'
                        ? 'bg-[#F0F2F5] text-[#5A616B]' : 'bg-[#FFF7E6] text-[#8A5A00]'}`}>
                      {connection?.status === 'connected' ? '已连接' : connection?.status === 'revoked' ? '已停止'
                        : connection?.status === 'error' ? '连接异常' : '待连接'}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-[#5A616B]">{source.detail}</p>
                  {connection?.coverageStart && (
                    <p className="mt-1 text-[10px] text-[#8F959E]">
                      覆盖 {connection.coverageStart} 至 {connection.coverageEnd} · 更新于 {dateLabel(connection.lastSyncedAt)}
                    </p>
                  )}
                  {connection?.status === 'error' && (
                    <div className="mt-2 rounded-lg bg-[#FFF7E6] p-2 text-[11px] leading-relaxed text-[#8A5A00]">
                      <p>{connection.errorMessage || '模拟数据来源暂时无法连接，请稍后重试。'}</p>
                      <p className="mt-0.5 text-[#6F737A]">最后成功更新：{dateLabel(connection.lastSyncedAt)}</p>
                    </div>
                  )}
                </div>
              </div>
              {!onboarding && connection?.status === 'connected' && (
                <button type="button" disabled={busy} onClick={() => void onRevoke(source.source)}
                  className="mt-2 ml-7 text-[11px] font-semibold text-[#A44040] hover:underline disabled:opacity-50">
                  停止后续同步
                </button>
              )}
              {connection?.status === 'error' && (
                <button type="button" disabled={busy} onClick={() => void onRetry(source.source)}
                  className="mt-2 ml-7 rounded-lg bg-[#0F6B6D] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50">
                  重新连接
                </button>
              )}
            </section>
          );
        })}
      </fieldset>

      <button type="button" disabled={busy || selected.length === 0} onClick={() => void onConnect(selected)}
        className="min-h-11 w-full rounded-xl bg-[#0F6B6D] px-4 py-2.5 text-[14px] font-semibold text-white shadow-sm hover:bg-[#084C4E] disabled:cursor-not-allowed disabled:opacity-50">
        {busy ? '正在读取模拟流水…' : onboarding ? '连接并开始智能守护' : '应用连接设置'}
      </button>
      <p className="pb-3 text-center text-[11px] leading-relaxed text-[#8F959E]">
        撤销后会停止未来同步；已用于目标判断和审计的历史依据会保留。账单核对请走日本旅行 Money Mission 的合成样例导入，不在这里选择个人文件。
      </p>
    </div>
  );
}
