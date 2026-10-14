import { useState } from 'react';
import type { Snapshot } from '../../shared/contracts';
import { GenerativeCard } from '../components/GenerativeCard';

interface Props {
  snapshot: Snapshot;
  mutate: (url: string, method: string, body?: unknown) => Promise<Snapshot>;
}
const styles = 'w-full rounded-xl bg-white border border-[#E5E8EB] p-3.5 shadow-sm';
const button = 'rounded-lg px-3 py-2 bg-[#0F6B6D] text-white text-[12px] font-semibold hover:bg-[#084C4E] disabled:opacity-40';
export function BankingDemoScreen({ snapshot, mutate }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const run = async (url: string, body: unknown) => {
    setBusy(true); setMessage('');
    try { await mutate(url, 'POST', body); }
    catch (error) { setMessage(error instanceof Error ? error.message : '请求失败'); }
    finally { setBusy(false); }
  };
  const copyMcpToken = async () => {
    try {
      const response = await fetch('/api/mcp/token', { credentials: 'same-origin' });
      if (!response.ok) throw new Error('MCP 令牌暂不可用');
      const { token } = await response.json();
      await navigator.clipboard.writeText(token);
      setMessage('本会话的 MCP 令牌已复制。只交给你信任的演示 Agent；授权仍可随时撤销。');
    } catch { setMessage('复制失败。请在 HTTPS 或 localhost 环境重试。'); }
  };
  const mandate = snapshot.mandate;
  return <div className="flex flex-col gap-3 p-4 text-[#1F2329]">
    <div className={styles}>
      <h2 className="font-bold text-[15px]">模拟 Banking-as-Tools</h2>
      <p className="text-[12px] text-[#5A616B] mt-1">所有金额与执行都只在此体验者的模拟会话中变化。外部请求必须先通过授权与规则检查。</p>
    </div>
    <div className={styles}>
      <h3 className="font-bold text-[13px] mb-1">限定授权</h3>
      <p className="text-[12px] text-[#5A616B]">{mandate ? `交通类 · 单笔上限 ¥${mandate.maxPerOperationCents / 100} · 总额度 ¥${mandate.totalLimitCents / 100} · 截止 ${mandate.expiresAt}` : '当前没有授权。激活目标计划后，才可创建限定授权。'}</p>
      <button className={`${button} mt-3`} disabled={busy || snapshot.goal.status !== 'active'} onClick={() => run('/api/mandates', { confirmed: true, category: 'transport', maxPerOperationCents: 50000, totalLimitCents: 120000, expiresAt: '2026-12-31' })}>确认创建交通类模拟授权</button>
      {mandate?.active && <button className="ml-2 rounded-lg px-3 py-2 border border-[#D0D5DD] text-[#5A616B] text-[12px]" disabled={busy} onClick={() => run('/api/mandates/revoke', {})}>撤销授权</button>}
    </div>
    <div className={styles}>
      <h3 className="font-bold text-[13px] mb-1">外部 Agent 请求</h3>
      <p className="text-[12px] text-[#5A616B] mb-3">用同一授权分别演示 Execute、Ask、Block。每次请求都生成独立凭证，可按请求号查询。</p>
      <div className="grid grid-cols-2 gap-2">
        {(['transport', 'shopping', 'manual_review', 'over_limit'] as const).map((scenario, index) => <button key={scenario} className={button} disabled={busy || !mandate} onClick={() => run('/api/demo/agent-request', { scenario })}>{['交通 Execute', '购物 Ask', '高额 Manual Review', '超限 Block'][index]}</button>)}
      </div>
      <div className="grid grid-cols-2 gap-2 mt-2">
        <button className={button} disabled={busy || !mandate} onClick={() => run('/api/demo/agent-request', { scenario: 'invalid_identity' })}>身份不符</button>
        <button className={button} disabled={busy || !mandate} onClick={() => run('/api/demo/agent-request', { scenario: 'timeout' })}>模拟超时</button>
      </div>
    </div>
    {message && <div className="rounded-lg bg-amber-50 p-2 text-[12px] text-amber-800">{message}</div>}
    <div className={styles}>
      <h3 className="font-bold text-[13px] mb-2">执行凭证与审计</h3>
      {snapshot.operations.length === 0 && <p className="text-[12px] text-[#5A616B]">尚无请求</p>}
      {[...snapshot.operations].reverse().map(op => <div key={op.operationId} className="border-t border-[#E5E8EB] py-2 text-[12px]">
        <div className="flex justify-between"><strong>{op.category} · ¥{op.amountCents / 100}</strong><span className="text-[#0F6B6D] font-bold">{op.status.toUpperCase()}</span></div>
        <p className="text-[#5A616B]">{op.reason}</p>
        <p className="text-[#8F959E] break-all">凭证 {op.operationId}</p>
        {(op.status === 'ask' || op.status === 'manual_review') && <button className={`${button} mt-2`} disabled={busy} onClick={() => run(`/api/operations/${op.operationId}/approve`, {})}>核对并确认本次模拟请求</button>}
        {op.status === 'unknown' && <button className={`${button} mt-2`} disabled={busy} onClick={() => run(`/api/operations/${op.operationId}/reconcile`, {})}>查询原请求并恢复</button>}
      </div>)}
      <p className="text-[11px] text-[#5A616B] mt-2">Twin v{snapshot.twinVersion} · 审计事件 {snapshot.audit.length} 条 · Hash 链{snapshot.auditChainValid ? '有效' : '异常'} · 凭证 {snapshot.receipts.length} 条</p>
      <div className="mt-3 flex gap-2">
        <a className={button} href="/api/audit/export?format=json" download>导出 JSON</a>
        <a className={button} href="/api/audit/export?format=csv" download>导出 CSV</a>
      </div>
    </div>
    <div className={`${styles} flex flex-col gap-2`}>
      <h3 className="font-bold text-[13px]">受治理的生成式界面</h3>
      <p className="text-[12px] text-[#5A616B]">模型只能重排这些白名单组件。未知类型会降级为不可操作的说明卡。</p>
      {snapshot.cards.slice(-2).map(card => <GenerativeCard key={card.id} value={card} />)}
    </div>
    <div className={styles}>
      <h3 className="font-bold text-[13px]">外部 MCP 接入</h3>
      <p className="text-[12px] text-[#5A616B] my-2">使用同域名的 <code>/mcp</code>，请求头为 Bearer 令牌。令牌只关联当前模拟会话。</p>
      <button className={button} onClick={copyMcpToken}>复制当前会话 MCP 令牌</button>
    </div>
  </div>;
}
