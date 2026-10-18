import type { OfflineSnapshot } from '../offline';
import { NovaMark } from '../components/NovaMark';

const yuan = (cents: number) => `¥${(cents / 100).toLocaleString('zh-CN')}`;
const statusLabel: Record<string, string> = {
  insufficient_data: '数据不足', on_track: '按计划推进', at_risk: '可能延期', infeasible: '需要调整',
};
const connectionStatusLabel: Record<string, string> = {
  connected: '上次同步成功', error: '上次同步异常', revoked: '已停止同步',
};

export function OfflineScreen({ snapshot, onReconnect }: { snapshot: OfflineSnapshot; onReconnect: () => void }) {
  const progress = snapshot.goal.targetCents > 0
    ? Math.min(100, snapshot.goal.savedCents / snapshot.goal.targetCents * 100).toFixed(1) : '0.0';
  return (
    <main className="min-h-screen bg-[#F5F7F8] px-5 py-8 text-[#1F2329]">
      <div className="mx-auto max-w-md space-y-4">
        <header className="flex items-center gap-3">
          <NovaMark size={48} />
          <div>
            <p className="text-xs font-semibold text-[#0F6B6D]">NOVA · 只读状态</p>
            <h1 className="text-2xl font-bold">离线查看</h1>
          </div>
        </header>
        <section className="rounded-2xl border border-[#F2D5A7] bg-[#FFF9ED] p-4 text-sm text-[#76551D]">
          <p className="font-bold">同步与操作已暂停</p>
          <p className="mt-1 leading-relaxed">这里仅显示最近一次保存在本机的模拟目标摘要。重新联网前，NOVA 不会同步流水、修改目标或执行任何操作。</p>
        </section>
        <section className="rounded-2xl border border-[#E5E8EB] bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div><p className="text-xs text-[#5A616B]">当前目标</p><h2 className="mt-1 text-xl font-bold">{snapshot.goal.title}</h2></div>
            <span className="rounded-full bg-[#E6F2F2] px-2 py-1 text-xs font-semibold text-[#0F6B6D]">模拟数据</span>
          </div>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-[#E5E8EB]"><div className="h-full rounded-full bg-[#0F6B6D]" style={{ width: `${progress}%` }} /></div>
          <div className="mt-2 flex justify-between text-sm"><span>已存 {yuan(snapshot.goal.savedCents)}</span><span>{progress}% / {yuan(snapshot.goal.targetCents)}</span></div>
          <dl className="mt-5 space-y-3 border-t border-[#E5E8EB] pt-4 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-[#5A616B]">最近判断</dt><dd className="font-semibold">{statusLabel[snapshot.assessment.status] || snapshot.assessment.status}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-[#5A616B]">目标日期</dt><dd>{snapshot.goal.targetDate}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-[#5A616B]">建议月存</dt><dd>{yuan(snapshot.assessment.requiredMonthlyCents)}</dd></div>
          </dl>
        </section>
        <section className="rounded-xl border border-[#E5E8EB] bg-white p-4 text-xs text-[#5A616B]">
          <p>本机摘要保存于 {new Date(snapshot.savedAt).toLocaleString('zh-CN')}</p>
          <p className="mt-2 font-semibold text-[#1F2329]">数据新鲜度</p>
          {snapshot.connections.length ? <ul className="mt-1 space-y-2">
            {snapshot.connections.map(item => <li key={item.source} className="rounded-lg bg-[#F5F7F8] p-2">
              <p className="font-semibold text-[#1F2329]">{item.label}（模拟） · {connectionStatusLabel[item.status] || item.status}</p>
              <p>{item.lastSyncedAt ? `最后成功：${new Date(item.lastSyncedAt).toLocaleString('zh-CN')}` : '尚无成功同步记录'}</p>
              <p>{item.coverageEnd ? `流水覆盖至：${item.coverageEnd}` : '覆盖范围未确定'}</p>
            </li>)}
          </ul> : <p className="mt-1">数据来源：尚未连接（模拟）</p>}
        </section>
        <button type="button" onClick={onReconnect} className="min-h-11 w-full rounded-xl bg-[#0F6B6D] px-4 font-semibold text-white">重新连接</button>
      </div>
    </main>
  );
}
