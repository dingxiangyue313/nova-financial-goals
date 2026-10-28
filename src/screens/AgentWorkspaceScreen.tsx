import { FormEvent, useEffect, useRef, useState } from 'react';
import { AgentRunStatusResponseSchema, type AgentRun, type AgentComponent, type AgentMessage,
  type AgentThread, type AgentTurnWithRun, type GoalAssumptions, type RiskPreferences, type Snapshot } from '../../shared/contracts';
import { api } from '../api';
import type { ScreenId } from '../types';
import { AgentComponentRenderer } from '../components/AgentComponentRenderer';
import { NovaMark } from '../components/NovaMark';

const suggestions = ['我想年底去日本旅行，预算 ¥8,000', '这笔 ¥900 支出会影响目标吗？', '允许旅行 Agent 在 ¥500 内订票'];
const currentPreferences = (components: AgentComponent[], preferences: RiskPreferences) => components.map(component =>
  component.type === 'notification_preference_card' ? { ...component, preferences } : component);

export function AgentWorkspaceScreen({ snapshot, compact, starter, onSnapshot, onNavigate, onConnectData, onFinancialTask }: {
  snapshot: Snapshot; compact: boolean; starter?: string; onSnapshot: (snapshot: Snapshot) => void;
  onNavigate: (screen: ScreenId) => void; onConnectData: (threadId: string) => void;
  onFinancialTask?:(message:string)=>void;
}) {
  const [threads, setThreads] = useState<AgentThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [draft, setDraft] = useState(starter || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(compact);
  const [canvasComponents, setCanvasComponents] = useState<AgentComponent[]>([]);
  const [run, setRun] = useState<AgentRun | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  async function refreshThreads(preferred?: string | null) {
    const result = await api<{ threads: AgentThread[] }>('/api/agent/threads?includeArchived=true');
    setThreads(result.threads);
    const defaultThread = result.threads.find(item => item.status === 'active' && item.unread && item.kind === 'risk')
      || result.threads.find(item => item.status === 'active' && !item.unread && item.kind !== 'risk')
      || result.threads.find(item => item.status === 'active' && item.kind !== 'risk')
      || result.threads.find(item => item.status === 'active' && !item.unread)
      || null;
    const next = preferred === null ? (defaultThread?.id || result.threads[0]?.id || null)
      : preferred || activeThreadId || defaultThread?.id || null;
    if (next) { setActiveThreadId(next); await loadMessages(next); await loadRun(next); }
  }
  async function loadMessages(threadId: string) {
    const result = await api<{ messages: AgentMessage[]; monitor: { enabled: boolean } }>(
      `/api/agent/threads/${threadId}/messages`);
    const hydrated = result.messages.map(message => ({ ...message,
      components: currentPreferences(message.components, snapshot.riskPreferences).map(component =>
        component.type === 'monitoring_opt_in' ? { ...component, enabled: result.monitor.enabled } : component) }));
    setMessages(hydrated); setActiveThreadId(threadId);
    setCanvasComponents(hydrated.slice().reverse().find(message => message.role === 'assistant'
      && message.components.length > 0)?.components || []);
    setThreads(current => current.map(thread => thread.id === threadId ? { ...thread, unread: false } : thread));
  }
  async function loadRun(threadId: string, refreshOnFinish = false) {
    const value = AgentRunStatusResponseSchema.parse(await api(`/api/agent/threads/${threadId}/run`));
    if (threadId !== activeThreadId && activeThreadId !== null && refreshOnFinish) return;
    setRun(value.run);
    if (refreshOnFinish && value.run?.status !== 'running') await loadMessages(threadId);
  }
  useEffect(() => { void api('/api/risk/summaries/ensure', 'POST').then(() => refreshThreads()).then(() => setError(null))
    .catch(value => setError(value.message)); }, []);
  useEffect(() => {
    const timer = window.setInterval(() => { void api<{ threads: AgentThread[] }>(
      '/api/agent/threads?includeArchived=true').then(value => setThreads(value.threads)).catch(() => undefined); }, 15_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!activeThreadId || run?.status !== 'running') return;
    const timer = window.setInterval(() => { void loadRun(activeThreadId, true).catch(value =>
      setError(value instanceof Error ? value.message : '读取调查状态失败')); }, 1500);
    return () => window.clearInterval(timer);
  }, [activeThreadId, run?.runId, run?.status]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  async function send(message: string) {
    if (!message.trim() || busy) return;
    if(onFinancialTask&&/给.+转\s*\d|我要申购|我要赎回|挂失.*卡|调额|管理订阅|取消订阅|查看账单|获取.*报价/.test(message)){onFinancialTask(message.trim());return;}
    setBusy(true); setError(null); setDraft('');
    try {
      const writableThreadId = activeThread && activeThread.status === 'active' && !activeThread.readOnly ? activeThread.id : null;
      const turn = await api<AgentTurnWithRun>('/api/agent/turn', 'POST', { threadId: writableThreadId, message: message.trim() });
      setRun(turn.run);
      setCanvasComponents(turn.canvasComponents.length ? turn.canvasComponents : turn.components);
      await refreshThreads(turn.thread.id);
    } catch (value) {
      if (value instanceof Error && value.message === 'THREAD_ARCHIVED') {
        const turn = await api<AgentTurnWithRun>('/api/agent/turn', 'POST', { threadId: null, message: message.trim() });
        setRun(turn.run);
        await refreshThreads(turn.thread.id);
      } else { setDraft(message); setError(value instanceof Error ? value.message : '发送失败'); }
    }
    finally { setBusy(false); }
  }
  async function submit(event: FormEvent) { event.preventDefault(); await send(draft); }
  async function action(actionId: string, selection: string[] = []) {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const result = await api<{ snapshot: Snapshot; message: AgentMessage; replayed: boolean;
        nextStep: 'connect_data' | null }>('/api/agent/action', 'POST', { actionId, decision: 'confirm', selection });
      onSnapshot(result.snapshot);
      if (result.nextStep === 'connect_data') { onNavigate('data_connections'); return; }
      if (activeThreadId) await loadMessages(activeThreadId);
      await refreshThreads(activeThreadId || undefined);
    } catch (value) { setError(value instanceof Error ? value.message : '操作失败'); }
    finally { setBusy(false); }
  }
  async function cancelAction(actionId: string) {
    if (busy) return;
    setBusy(true);
    try {
      await api('/api/agent/action', 'POST', { actionId, decision: 'cancel' });
      if (activeThreadId) await loadMessages(activeThreadId);
    } catch (value) { setError(value instanceof Error ? value.message : '取消失败'); }
    finally { setBusy(false); }
  }
  async function selectCandidate(resultId: string, threadId?: string) {
    const target = threadId ?? activeThreadId;
    if (!target || busy) return;
    setBusy(true); setError(null);
    try {
      await api('/api/agent/candidate/select', 'POST', { threadId: target, resultId });
      await refreshThreads(target);
    } catch (value) { setError(value instanceof Error ? value.message : '候选已失效，请重新试算'); }
    finally { setBusy(false); }
  }
  async function monitoring(threadId: string, enabled: boolean) {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await api('/api/agent/monitoring', 'POST', { threadId, enabled });
      await refreshThreads(threadId);
    } catch (value) { setError(value instanceof Error ? value.message : '监测设置失败'); }
    finally { setBusy(false); }
  }
  async function followup(threadId: string) {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await api('/api/agent/followup', 'POST', { threadId, kind: 'bonus_review' });
      await refreshThreads(threadId);
    } catch (value) { setError(value instanceof Error ? value.message : '跟进安排失败'); }
    finally { setBusy(false); }
  }
  async function stopRun() {
    if (!activeThreadId || !run || run.status !== 'running') return;
    try {
      const value = AgentRunStatusResponseSchema.parse(await api(
        `/api/agent/threads/${activeThreadId}/run/cancel`, 'POST', { runId: run.runId }));
      setRun(value.run);
    } catch (value) { setError(value instanceof Error ? value.message : '停止调查失败'); }
  }
  async function preview(assumptions: GoalAssumptions, twinVersion: number) {
    if (!activeThreadId || busy) return;
    setBusy(true); setError(null);
    try {
      const result = await api<{ components: AgentComponent[] }>('/api/agent/preview', 'POST', {
        threadId: activeThreadId, twinVersion, assumptions,
      });
      setCanvasComponents(result.components);
      setMessages(current => {
        const index = current.findLastIndex(message => message.role === 'assistant'
          && message.components.some(component => component.type === 'assumption_editor' || component.type === 'what_if_simulator'));
        return index < 0 ? current : current.map((message, itemIndex) => itemIndex === index
          ? { ...message, components: result.components } : message);
      });
    } catch (value) { setError(value instanceof Error ? value.message : '试算失败'); }
    finally { setBusy(false); }
  }
  async function updateRiskPreferences(changes: Partial<RiskPreferences>) {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await api('/api/risk/preferences', 'PATCH', changes);
      const latest = await api<Snapshot>('/api/session');
      onSnapshot(latest);
      setCanvasComponents(current => currentPreferences(current, latest.riskPreferences));
      setMessages(current => current.map(message => ({ ...message,
        components: currentPreferences(message.components, latest.riskPreferences) })));
    } catch (value) { setError(value instanceof Error ? value.message : '设置保存失败'); }
    finally { setBusy(false); }
  }
  async function createThread() {
    const result = await api<{ thread: AgentThread }>('/api/agent/threads', 'POST', { title: '新的目标任务' });
    setMessages([]); setRun(null); setActiveThreadId(result.thread.id); await refreshThreads(result.thread.id);
  }
  async function updateThread(update: { title?: string; status?: 'active' | 'archived' }) {
    if (!activeThreadId) return;
    await api(`/api/agent/threads/${activeThreadId}`, 'PATCH', update);
    await refreshThreads(activeThreadId);
  }
  async function renameThread() {
    const active = threads.find(item => item.id === activeThreadId);
    if (!active) return;
    const title = window.prompt('重命名会话', active.title)?.trim();
    if (title) await updateThread({ title });
  }
  async function removeThread() {
    if (!activeThreadId) return;
    await api(`/api/agent/threads/${activeThreadId}`, 'DELETE');
    setActiveThreadId(null); setMessages([]); setRun(null); await refreshThreads(null);
  }
  const activeThread = threads.find(item => item.id === activeThreadId);

  const conversation = <section className="flex min-h-0 flex-1 flex-col bg-[#F5F7F8]">
    <header className="border-b border-[#E5E8EB] bg-white px-4 py-3">
      <div className="flex items-center justify-between"><div><h1 className="text-[16px] font-bold">NOVA 目标工作台</h1><p className="text-[10px] text-[#5A616B]">对话生成界面 · 操作前始终确认</p></div><button onClick={() => onNavigate('home')} aria-label="返回首页" className="rounded-lg border border-[#E5E8EB] px-2 py-1 text-[11px] text-[#5A616B]">返回首页</button></div>
      <div className="mt-2 flex gap-2"><button type="button" onClick={() => setHistoryOpen(value => !value)} className="rounded-full border border-[#D8E7E7] px-3 py-1.5 text-[11px] font-semibold text-[#0F6B6D]">{historyOpen ? '收起会话' : `会话历史 ${threads.length}`}</button>
        <button onClick={createThread} className="shrink-0 rounded-full bg-[#0F6B6D] px-3 py-1.5 text-[11px] font-semibold text-white">＋ 新会话</button>
        <button type="button" onClick={()=>onNavigate('financial_services')} className="shrink-0 rounded-full border border-[#D8E7E7] px-3 py-1.5 text-[11px] font-semibold text-[#0F6B6D]">转账、理财与旅行任务</button>
      </div>
      {historyOpen && <div className="mt-2 flex gap-2 overflow-x-auto no-scrollbar">{threads.map(thread => <button key={thread.id} data-unread={thread.unread ? 'true' : 'false'} onClick={() => void loadMessages(thread.id)} className={`shrink-0 rounded-full border px-3 py-1.5 text-[11px] ${thread.id === activeThreadId ? 'border-[#0F6B6D] bg-[#E6F2F2] text-[#0F6B6D]' : 'border-[#E5E8EB] bg-white text-[#5A616B]'}`}><span className={thread.unread ? 'font-bold' : ''}>{thread.unread ? '● ' : ''}{thread.kind === 'summary' ? '摘要 · ' : ''}{thread.status === 'archived' ? '历史 · ' : ''}{thread.title}</span></button>)}</div>}
      {activeThread && <div className="mt-2 flex items-center gap-2 text-[10px] text-[#5A616B]"><button onClick={renameThread}>重命名</button><button disabled={activeThread.readOnly} onClick={() => void updateThread({ status: activeThread.status === 'active' ? 'archived' : 'active' })}>{activeThread.status === 'active' ? '归档' : '恢复'}</button><button onClick={removeThread} className="text-rose-600">删除</button>{activeThread.readOnly && <span className="ml-auto rounded-full bg-[#F0F2F5] px-2 py-1">旧演示 · 只读</span>}</div>}
    </header>
    <div className="flex-1 overflow-y-auto px-3 py-4 no-scrollbar">
      {run && <div className="mx-auto mb-3 max-w-xl rounded-2xl border border-[#D8E7E7] bg-white p-3 text-[11px] text-[#5A616B]" aria-live="polite">
        <div className="flex items-center justify-between gap-2"><b className="text-[#1F2329]">{run.status === 'running' ? '正在调查模拟数据' : run.status === 'completed' ? '调查已完成' : run.status === 'fallback' ? '规则试算已完成' : run.status === 'awaiting_user' ? '等待补充信息' : '调查已停止'}</b>{run.status === 'running' && <button type="button" onClick={() => void stopRun()} className="rounded-lg border border-[#D0D5DD] px-2 py-1 text-[#5A616B]">停止调查</button>}</div>
        <p className="mt-1">{run.status === 'running' ? '正在核对目标金额、可用现金和完成日期…' : run.status === 'completed' || run.status === 'fallback' ? '已完成本次核对，请查看下方方案；选择后仍需确认。' : run.status === 'awaiting_user' ? '补充下方信息后可以继续试算。' : '本次调查已结束，尚未应用方案。'}</p>
        <ol className="mt-2 space-y-1">{run.steps.map((step, index) =>
          <li key={`${step.at}-${index}`} className="rounded-lg bg-[#F5F7F8] px-2 py-1.5">{step.summary.replace('financial_overview：ok','已核对账户与目标').replace('data_sufficiency：ok','已核对数据覆盖').replace('search_goal_options：ok','已完成目标方案试算').replace('search_goal_options：no_result','当前条件下需要调整方案')}</li>)}</ol>
      </div>}
      {!messages.length && <div className="mx-auto max-w-md pt-6 text-center"><div className="mx-auto flex h-16 items-center justify-center"><NovaMark size={64} /></div><h2 className="mt-4 text-[16px] font-bold">你想完成什么财务目标？</h2><p className="mt-1 text-[12px] text-[#5A616B]">NOVA 会把理解结果变成可以核对和确认的界面。</p></div>}
      <div className="mx-auto max-w-xl space-y-4">{messages.map(message => <div key={message.id} className={message.role === 'user' ? 'ml-10' : 'mr-5'}>
        <div className={`rounded-2xl px-3 py-2 text-[12px] leading-relaxed ${message.role === 'user' ? 'rounded-br-md bg-[#0F6B6D] text-white' : 'rounded-bl-md border border-[#E5E8EB] bg-white text-[#1F2329]'}`}>{message.content}</div>
        {message.components.length > 0 && <div className={`mt-2 space-y-2 ${compact ? '' : 'lg:hidden'}`}>{message.components.map(component => <AgentComponentRenderer key={component.id} value={component} onAction={action} onCancel={cancelAction} onSelectCandidate={selectCandidate} onConnectData={onConnectData} onMonitoring={monitoring} onFollowup={followup} onNavigate={onNavigate} onPreview={preview} onUpdateRiskPreferences={updateRiskPreferences} busy={busy} />)}</div>}
      </div>)}{busy && <div className="mr-20 rounded-2xl rounded-bl-md border border-[#E5E8EB] bg-white px-3 py-2 text-[12px] text-[#5A616B]">NOVA 正在理解任务并组合安全界面…</div>}<div ref={bottom} /></div>
    </div>
    <footer className="border-t border-[#E5E8EB] bg-white p-3">
      {!messages.length && <div className="mb-2 flex gap-2 overflow-x-auto no-scrollbar">{suggestions.map(item => <button key={item} onClick={() => void send(item)} className="shrink-0 rounded-xl border border-[#D8E7E7] bg-[#F2FAFA] px-3 py-2 text-left text-[11px] text-[#0F6B6D]">{item}</button>)}</div>}
      {error && <div className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{error}</div>}
      <form onSubmit={submit} className="flex items-end gap-2"><textarea value={draft} onChange={event => setDraft(event.target.value)} placeholder={activeThread?.readOnly || activeThread?.status === 'archived' ? '历史会话仅供查看；发送会新建会话' : '描述目标、风险或授权范围…'} rows={1} className="min-h-11 flex-1 resize-none rounded-xl border border-[#D0D5DD] bg-[#F8FAFB] px-3 py-3 text-[12px] outline-none focus:border-[#0F6B6D]"/><button type="submit" aria-label="发送" disabled={busy || !draft.trim()} className="grid h-11 w-11 place-items-center rounded-xl bg-[#0F6B6D] text-white disabled:opacity-40"><span className="material-symbols-outlined text-[18px]">arrow_upward</span></button></form>
    </footer>
  </section>;

  if (compact) return conversation;
  return <div className="grid min-h-0 flex-1 grid-cols-1 bg-white lg:grid-cols-[minmax(300px,32%)_minmax(0,68%)]">
    {conversation}
    <aside data-testid="governed-canvas" className="hidden min-h-0 overflow-y-auto border-l border-[#E5E8EB] bg-[#F5F7F8] p-5 no-scrollbar lg:block">
      <div className="mx-auto max-w-3xl"><div className="mb-4 flex items-start justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#0F6B6D]">Governed Canvas</p><h2 className="mt-1 text-xl font-bold">当前任务画布</h2><p className="mt-1 text-xs text-[#5A616B]">所有金额和状态来自确定性 Financial Twin；操作确认后才写入。</p></div><div className="rounded-xl bg-[#EBF7F2] px-3 py-2 text-right text-[10px] text-[#276B4E]"><b className="block">应急金严格隔离</b>¥{(snapshot.finance.emergencyCents / 100).toLocaleString()}</div></div>
      {canvasComponents.length ? <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">{canvasComponents.map(component => <AgentComponentRenderer key={component.id} value={component} onAction={action} onCancel={cancelAction} onSelectCandidate={selectCandidate} onConnectData={onConnectData} onMonitoring={monitoring} onFollowup={followup} onNavigate={onNavigate} onPreview={preview} onUpdateRiskPreferences={updateRiskPreferences} busy={busy} />)}</div> : <div className="rounded-2xl border border-dashed border-[#B8CDCD] bg-white p-10 text-center"><NovaMark size={64}/><h3 className="mt-4 font-bold">从左侧描述一个目标</h3><p className="mt-1 text-xs text-[#5A616B]">目标输入、假设、方案和确认步骤会在这里组合。</p></div>}</div>
    </aside>
  </div>;
}
