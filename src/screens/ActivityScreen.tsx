import { useEffect, useMemo, useState } from 'react';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type { Audit, Operation, Snapshot } from '../../shared/contracts';

interface ActivityScreenProps {
  snapshot: Snapshot;
  mutate: (url: string, method: string, body?: unknown) => Promise<Snapshot>;
  hasImpactPending: boolean;
  onNavigateToImpact: () => void;
  onNavigateToBanking: () => void;
}

type PasskeyStatus = { registered: boolean; rpId: string; userVerification: 'required' };
const steps = [
  ['request_received', '收到请求'], ['permission', '权限检查'], ['risk', '风险判断'],
  ['user_confirmation', '用户确认'], ['execute', '执行'], ['verify', '验证'],
  ['receipt', 'Receipt'], ['audit', '审计入链'],
] as const;
const money = (value?: number | null) => value == null ? '历史版本未记录' : `¥${(value / 100).toLocaleString('zh-CN')}`;
const statusLabel: Record<Operation['status'], string> = {
  executed: '已执行', ask: '待确认', manual_review: '待设备验证', blocked: '已拦截', unknown: '状态待核对',
};

async function requestJson<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data as T;
}

function OperationCard({ operation, events, snapshot, mutate, passkey, onPasskeyChanged }: {
  operation: Operation; events: Audit[]; snapshot: Snapshot;
  mutate: ActivityScreenProps['mutate']; passkey: PasskeyStatus | null; onPasskeyChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const eventFor = (action: string) => events.find(event => event.action === action);
  const run = async (task: () => Promise<unknown>) => {
    setBusy(true); setMessage('');
    try { await task(); }
    catch (error) { setMessage(error instanceof Error ? error.message : '操作失败'); }
    finally { setBusy(false); }
  };
  const authenticate = () => run(async () => {
    const payload = await requestJson<{ options: Parameters<typeof startAuthentication>[0]['optionsJSON']; challengeId: string }>(
      `/api/operations/${operation.operationId}/auth/options`, 'POST', {});
    const response = await startAuthentication({ optionsJSON: payload.options });
    await mutate(`/api/operations/${operation.operationId}/auth/verify`, 'POST', { challengeId: payload.challengeId, response });
    onPasskeyChanged();
  });
  const isMandateChanged = operation.reason.includes('MANDATE_CHANGED');
  const tag = operation.status === 'blocked' ? 'bg-red-50 text-red-700 border-red-200'
    : operation.status === 'manual_review' ? 'bg-amber-50 text-amber-800 border-amber-200'
    : 'bg-teal-50 text-teal-700 border-teal-200';
  return <article className="bg-white border border-[#E5E8EB] rounded-xl shadow-sm overflow-hidden">
    <button aria-expanded={open} onClick={() => setOpen(value => !value)} className="w-full p-3.5 text-left cursor-pointer">
      <div className="flex items-start justify-between gap-2">
        <div><p className="text-[11px] text-[#8F959E]">{operation.agentId || '外部 Agent'} · {operation.createdAt?.slice(0, 16).replace('T', ' ') || '历史请求'}</p>
          <h3 className="text-[14px] font-bold mt-1">{operation.category} · ¥{(operation.amountCents / 100).toLocaleString('zh-CN')}</h3></div>
        <span className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold ${tag}`}>{statusLabel[operation.status]}</span>
      </div>
      <p className="text-[12px] text-[#5A616B] mt-1 leading-relaxed">{isMandateChanged ? '授权范围已变化，旧请求已失效' : operation.reason}</p>
      <p className="text-[11px] text-[#0F6B6D] mt-2 font-semibold">{open ? '收起完整链路' : '查看完整链路与资金变化'} ↓</p>
    </button>
    {open && <div className="border-t border-[#E5E8EB] p-3.5 space-y-3">
      <ol className="space-y-2" aria-label="请求执行链路">
        {steps.map(([action, label], index) => {
          const event = eventFor(action);
          const notApplicable = operation.status === 'blocked' && index >= 3;
          const waiting = (operation.status === 'ask' || operation.status === 'manual_review') && index >= 3;
          return <li key={action} className="flex gap-2 text-[12px]">
            <span className={`mt-0.5 grid place-items-center h-5 w-5 rounded-full shrink-0 ${event ? 'bg-[#0F6B6D] text-white' : 'bg-[#EEF1F3] text-[#8F959E]'}`}>{index + 1}</span>
            <div><strong>{label}</strong><p className="text-[#5A616B]">{event?.detail || (notApplicable ? '请求已被阻止，此阶段不执行' : waiting ? '等待用户完成所需确认' : '历史版本未记录此阶段')}</p></div>
          </li>;
        })}
      </ol>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-lg bg-[#F5F7F8] p-2"><span className="text-[#69707A]">账户余额</span><p className="font-semibold">{money(operation.balanceBeforeCents)} → {money(operation.balanceAfterCents)}</p></div>
        <div className="rounded-lg bg-[#F5F7F8] p-2"><span className="text-[#69707A]">授权已用</span><p className="font-semibold">{money(operation.mandateSpentBeforeCents)} → {money(operation.mandateSpentAfterCents)}</p></div>
        <div className="rounded-lg bg-[#F5F7F8] p-2"><span className="text-[#69707A]">Twin Version</span><p className="font-semibold">v{operation.twinVersionBefore ?? '?'} → {operation.twinVersionAfter ? `v${operation.twinVersionAfter}` : '待更新'}</p></div>
        <div className="rounded-lg bg-[#F5F7F8] p-2"><span className="text-[#69707A]">审计 Hash 链</span><p className="font-semibold">{snapshot.auditChainValid ? '校验有效' : '校验异常'}</p></div>
      </div>
      <p className="text-[11px] text-[#69707A] break-all">Receipt：{operation.receipt?.operationId || '尚未签发'}</p>
      {operation.status === 'ask' && <button disabled={busy} onClick={() => run(() => mutate(`/api/operations/${operation.operationId}/quick-confirm`, 'POST', {}))}
        className="w-full py-2.5 rounded-lg bg-[#0F6B6D] text-white text-[12px] font-semibold disabled:opacity-40">确认本次模拟请求</button>}
      {operation.status === 'manual_review' && <button disabled={busy || !passkey?.registered} onClick={authenticate}
        className="w-full py-2.5 rounded-lg bg-[#0F6B6D] text-white text-[12px] font-semibold disabled:opacity-40">
        {passkey?.registered ? '使用设备验证并执行' : '请先在页面顶部启用设备验证'}</button>}
      {isMandateChanged && <button disabled={busy} onClick={() => run(() => mutate(`/api/operations/${operation.operationId}/retry`, 'POST', {}))}
        className="w-full py-2.5 rounded-lg border border-[#0F6B6D] text-[#0F6B6D] text-[12px] font-semibold">按当前授权重新发起</button>}
      {message && <p role="alert" className="rounded-lg bg-amber-50 p-2 text-[11px] text-amber-800">{message}</p>}
    </div>}
  </article>;
}

export function ActivityScreen({ snapshot, mutate, hasImpactPending, onNavigateToImpact, onNavigateToBanking }: ActivityScreenProps) {
  const [passkey, setPasskey] = useState<PasskeyStatus | null>(null);
  const [platformAvailable, setPlatformAvailable] = useState<boolean | null>(null);
  const [securityMessage, setSecurityMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const refreshStatus = () => requestJson<PasskeyStatus>('/api/security/passkey/status').then(setPasskey).catch(() => setPasskey(null));
  useEffect(() => {
    refreshStatus();
    const credential = window.PublicKeyCredential;
    setPlatformAvailable(Boolean(window.isSecureContext && credential));
    credential?.isUserVerifyingPlatformAuthenticatorAvailable?.().then(setPlatformAvailable).catch(() => setPlatformAvailable(false));
  }, []);
  const register = async () => {
    setBusy(true); setSecurityMessage('');
    try {
      if (!platformAvailable) throw new Error('当前浏览器或环境不支持安全的设备验证。localhost 可用，公网需 HTTPS。');
      const payload = await requestJson<{ options: Parameters<typeof startRegistration>[0]['optionsJSON']; challengeId: string }>('/api/security/passkey/register/options', 'POST', {});
      const response = await startRegistration({ optionsJSON: payload.options });
      const status = await requestJson<PasskeyStatus>('/api/security/passkey/register/verify', 'POST', { challengeId: payload.challengeId, response });
      setPasskey(status); setSecurityMessage('设备验证已启用。验证方式由系统决定，NOVA 不读取或保存生物信息。');
    } catch (error) { setSecurityMessage(error instanceof Error ? error.message : '设备验证启用失败'); }
    finally { setBusy(false); }
  };
  const agentOperations = useMemo(() => snapshot.operations.filter(operation =>
    Boolean(operation.agentId) || operation.tool === 'external_payment'), [snapshot.operations]);
  const agentOperationIds = useMemo(() => new Set(agentOperations.map(operation => operation.operationId)), [agentOperations]);
  const grouped = useMemo(() => new Map(agentOperations.map(operation => [operation.operationId,
    snapshot.audit.filter(event => event.operationId === operation.operationId)])), [agentOperations, snapshot.audit]);
  const ordinary = [...snapshot.audit].reverse().filter(event => !event.operationId || !agentOperationIds.has(event.operationId));
  return <div className="flex-1 pt-2 pb-safe px-4 overflow-y-auto no-scrollbar space-y-3">
    <div><h2 className="text-[18px] font-bold">收支动态与脉络</h2><p className="text-[12px] text-[#5A616B]">目标变化、Agent 请求与审计证据都在这里</p></div>
    <section className="rounded-xl border border-[#B9D8D8] bg-[#F1F8F8] p-3.5" aria-label="设备验证状态">
      <div className="flex items-start justify-between gap-3"><div><h3 className="text-[14px] font-bold">设备验证</h3>
        <p className="text-[12px] text-[#5A616B] mt-1">{passkey?.registered ? '已启用；人工复核会调用系统 Face ID、Touch ID、指纹、Windows Hello 或设备密码。' : '人工复核请求需要系统级 Passkey 验证。NOVA 不保存生物信息。'}</p></div>
        <span className={`text-[11px] shrink-0 px-2 py-1 rounded-full ${passkey?.registered ? 'bg-emerald-100 text-emerald-800' : 'bg-white text-[#69707A]'}`}>{passkey?.registered ? '已启用' : '未启用'}</span></div>
      {!passkey?.registered && <button disabled={busy || platformAvailable === false} onClick={register} className="mt-3 w-full py-2 rounded-lg bg-[#0F6B6D] text-white text-[12px] font-semibold disabled:opacity-40">启用此设备验证</button>}
      {platformAvailable === false && <p className="mt-2 text-[11px] text-amber-800">当前环境不支持平台验证；人工复核请求会保持未执行。</p>}
      {securityMessage && <p role="status" className="mt-2 text-[11px] text-[#5A616B]">{securityMessage}</p>}
    </section>
    <div className="flex items-center justify-between"><h3 className="text-[14px] font-bold">外部 Agent 请求</h3><button onClick={onNavigateToBanking} className="text-[12px] text-[#0F6B6D] font-semibold">打开演示请求控制台</button></div>
    {agentOperations.length === 0 && <div className="bg-white border rounded-xl p-4 text-sm text-[#5A616B]">还没有 Agent 请求。可前往演示请求控制台创建四种决策。</div>}
    {[...agentOperations].reverse().map(operation => <OperationCard key={operation.operationId} operation={operation}
      events={grouped.get(operation.operationId) || []} snapshot={snapshot} mutate={mutate} passkey={passkey} onPasskeyChanged={refreshStatus} />)}
    <h3 className="text-[14px] font-bold pt-1">其他动态</h3>
    {ordinary.length === 0 && <div className="bg-white border rounded-xl p-4 text-sm text-[#5A616B]">当前还没有其他记录。</div>}
    {ordinary.map(event => <div key={event.id} className="bg-white border border-[#E5E8EB] rounded-xl p-3.5 shadow-sm">
      <div className="flex justify-between"><span className="text-[11px] px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200">{event.outcome}</span><span className="text-[11px] text-[#8F959E]">{event.at.slice(0, 16).replace('T', ' ')}</span></div>
      <h4 className="text-[14px] font-bold mt-1">{event.action === 'mandate_changed' ? '授权范围已变化' : event.action}</h4><p className="text-[12px] text-[#5A616B]">{event.detail}</p>
      {hasImpactPending && event.action === 'simulate_expense' && <button onClick={onNavigateToImpact} className="mt-2 w-full py-2 bg-[#E6F2F2] text-[#0F6B6D] rounded-lg text-[12px] font-semibold">查看影响与解决方案</button>}
    </div>)}
  </div>;
}
