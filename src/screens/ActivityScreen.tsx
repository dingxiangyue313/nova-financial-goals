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
const activityLabel: Record<string, string> = {
  cancel_subscription: '订阅处理结果已核对', create_schedule: '旅行储蓄安排已确认', scheduled_transfer: '储蓄执行结果已核对', reconcile_subscription: '商户状态已核实', pause_schedule: '储蓄计划已暂停', resume_schedule: '储蓄计划已恢复', cancel_schedule: '储蓄计划已取消', mission_loaded: '旅行任务已准备', statement_import: '账单已导入', subscription_preference: '订阅偏好已保存',
  create_goal: '创建了新目标', update_goal: '更新了目标假设', select_goal_plan: '选择了推进方案',
  primary_goal_changed: '切换了首页主目标', demo_loaded: '载入了演示场景', data_sync: '模拟流水已更新',
  simulate_expense: '发现一笔目标相关支出', impact_decision: '调整了目标计划', create_mandate: '创建了旅行助手授权',
  mandate_changed: '授权范围已变化', demo_clock: '演示时间已推进', demo_reset: '演示数据已重置',
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
  mutate: ActivityScreenProps['mutate']; passkey: PasskeyStatus | null; onPasskeyChanged: () => void | Promise<PasskeyStatus | null>;
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
    if (!passkey?.registered) {
      const registered = await onPasskeyChanged();
      if (!registered?.registered) throw new Error('需要先完成设备验证注册');
    }
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
  const categoryLabel = operation.category === 'transport' ? '交通费' : operation.category === 'shopping' ? '购物' : '模拟支付';
  const agentLabel = operation.agentId === 'travel-agent-demo' ? '旅行助手' : operation.agentId || '外部助手';
  return <article className="bg-white border border-[#E5E8EB] rounded-xl shadow-sm overflow-hidden">
    <button aria-expanded={open} onClick={() => setOpen(value => !value)} className="w-full p-3.5 text-left cursor-pointer">
      <div className="flex items-start justify-between gap-2">
        <div><p className="text-[11px] text-[#8F959E]">{agentLabel} · {operation.createdAt?.slice(0, 16).replace('T', ' ') || '历史请求'}</p>
          <h3 className="text-[14px] font-bold mt-1">{agentLabel}请求支付{categoryLabel} ¥{(operation.amountCents / 100).toLocaleString('zh-CN')}</h3></div>
        <span className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold ${tag}`}>{statusLabel[operation.status]}</span>
      </div>
      <p className="text-[12px] text-[#5A616B] mt-1 leading-relaxed">{isMandateChanged ? '授权范围已变化，旧请求已失效' : operation.reason}</p>
      <p className="text-[11px] text-[#0F6B6D] mt-2 font-semibold">{open ? '收起安全详情' : '查看安全详情'} ↓</p>
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
      {operation.status === 'manual_review' && <button disabled={busy} onClick={authenticate}
        className="w-full py-2.5 rounded-lg bg-[#0F6B6D] text-white text-[12px] font-semibold disabled:opacity-40">
        {passkey?.registered ? '验证并继续' : '启用设备验证并继续'}</button>}
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
  const register = async (): Promise<PasskeyStatus | null> => {
    setBusy(true); setSecurityMessage('');
    try {
      if (!platformAvailable) throw new Error('当前浏览器或环境不支持安全的设备验证。localhost 可用，公网需 HTTPS。');
      const payload = await requestJson<{ options: Parameters<typeof startRegistration>[0]['optionsJSON']; challengeId: string }>('/api/security/passkey/register/options', 'POST', {});
      const response = await startRegistration({ optionsJSON: payload.options });
      const status = await requestJson<PasskeyStatus>('/api/security/passkey/register/verify', 'POST', { challengeId: payload.challengeId, response });
      setPasskey(status); setSecurityMessage('设备验证已启用。验证方式由系统决定，NOVA 不读取或保存生物信息。'); return status;
    } catch (error) { setSecurityMessage(error instanceof Error ? error.message : '设备验证启用失败'); return null; }
    finally { setBusy(false); }
  };
  const agentOperations = useMemo(() => snapshot.operations.filter(operation =>
    Boolean(operation.agentId) || operation.tool === 'external_payment'), [snapshot.operations]);
  const agentOperationIds = useMemo(() => new Set(agentOperations.map(operation => operation.operationId)), [agentOperations]);
  const grouped = useMemo(() => new Map(agentOperations.map(operation => [operation.operationId,
    snapshot.audit.filter(event => event.operationId === operation.operationId)])), [agentOperations, snapshot.audit]);
  const ordinary = [...snapshot.audit].reverse().filter(event => !event.operationId || !agentOperationIds.has(event.operationId));
  const needsAttention = [...agentOperations].reverse().filter(operation => operation.status === 'ask' || operation.status === 'manual_review' || operation.status === 'unknown');
  const completed = [...agentOperations].reverse().filter(operation => operation.status === 'executed' || operation.status === 'blocked');
  return <div className="flex-1 pt-2 pb-safe px-4 overflow-y-auto no-scrollbar space-y-3">
    <div><h2 className="text-[18px] font-bold">动态</h2><p className="text-[12px] text-[#5A616B]">先处理需要确认的事项，再查看目标变化</p></div>
    {platformAvailable === false && needsAttention.some(item => item.status === 'manual_review') && <p className="rounded-xl bg-amber-50 p-3 text-[11px] text-amber-800">当前环境不能调用系统设备验证；该请求会保持未执行。公网手机端需使用 HTTPS。</p>}
    {securityMessage && <p role="status" className="rounded-xl bg-[#F1F8F8] p-3 text-[11px] text-[#5A616B]">{securityMessage}</p>}
    <div className="flex items-center justify-between"><h3 className="text-[14px] font-bold">需要你处理</h3>{!snapshot.mission && <button onClick={onNavigateToBanking} className="text-[11px] font-semibold text-[#0F6B6D]">演示请求</button>}</div>
    {needsAttention.length === 0 && <div className="rounded-xl border bg-white p-4 text-[12px] text-[#5A616B]">目前没有待确认事项。</div>}
    {needsAttention.map(operation => <OperationCard key={operation.operationId} operation={operation} events={grouped.get(operation.operationId) || []} snapshot={snapshot} mutate={mutate} passkey={passkey} onPasskeyChanged={register}/>) }
    <h3 className="pt-1 text-[14px] font-bold">目标变化</h3>
    {ordinary.length === 0 && <div className="rounded-xl border bg-white p-4 text-[12px] text-[#5A616B]">目标正在按计划推进，没有需要说明的新变化。</div>}
    {ordinary.map(event => <div key={event.id} className="bg-white border border-[#E5E8EB] rounded-xl p-3.5 shadow-sm">
      <div className="flex justify-between"><span className="text-[11px] px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200">已记录</span><span className="text-[11px] text-[#8F959E]">{event.at.slice(0, 16).replace('T', ' ')}</span></div>
      <h4 className="text-[14px] font-bold mt-1">{activityLabel[event.action] || 'NOVA 已更新目标状态'}</h4><p className="text-[12px] text-[#5A616B]">{event.detail}</p>
      {hasImpactPending && event.action === 'simulate_expense' && <button onClick={onNavigateToImpact} className="mt-2 w-full py-2 bg-[#E6F2F2] text-[#0F6B6D] rounded-lg text-[12px] font-semibold">查看影响与解决方案</button>}
    </div>)}
    {(snapshot.moneyMission?.schedules.length || snapshot.mission?.receipts.length) ? <h3 className="pt-1 text-[14px] font-bold">Money Mission 结果</h3> : null}
    {snapshot.mission?.receipts.map(r => <div key={r.id} className="mission-card"><strong className="text-sm">{r.date} · {({ succeeded: '已完成', failed: '未完成', unknown: '结果待核实', skipped: '本期跳过' })[r.status]}</strong><p>{r.detail}</p><span className="text-[10px] text-[#697386] break-all">凭证 {r.id}</span></div>)}
    {snapshot.moneyMission?.executions.map(item => <div key={item.id} className="mission-card"><strong className="text-sm">{item.periodKey} · {item.status === 'succeeded' ? '已完成' : item.status === 'failed' ? '未完成' : item.status === 'unknown' ? '结果待核实' : item.status === 'skipped_missing_trigger' ? '本期跳过' : '已安排'}</strong><p>{item.reason}</p><span className="text-[10px] text-[#697386] break-all">转账凭证 {item.id}</span></div>)}
    <h3 className="pt-1 text-[14px] font-bold">最近完成</h3>
    {completed.length === 0 && <div className="rounded-xl border bg-white p-4 text-[12px] text-[#5A616B]">还没有已完成或已拦截的请求。</div>}
    {completed.map(operation => <OperationCard key={operation.operationId} operation={operation} events={grouped.get(operation.operationId) || []} snapshot={snapshot} mutate={mutate} passkey={passkey} onPasskeyChanged={register}/>) }
  </div>;
}
