import { useEffect, useState } from 'react';
import type { AiSafetyOverview } from '../../shared/contracts';
import { api, ApiError } from '../api';
import { SafetyModeBanner } from '../components/ai-safety/SafetyModeBanner';
import { SafetyPassportCard } from '../components/ai-safety/SafetyPassportCard';
import { SafetyScorecard } from '../components/ai-safety/SafetyScorecard';

export function AISafetyScreen() {
  const [overview, setOverview] = useState<AiSafetyOverview | null>(null);
  const [state, setState] = useState<'loading' | 'error' | 'unavailable' | 'ready'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function refresh() {
    setState('loading');
    try { setOverview(await api<AiSafetyOverview>('/api/ai-safety')); setState('ready'); }
    catch (e) { setOverview(null); setState(e instanceof ApiError && [404, 503].includes(e.status) ? 'unavailable' : 'error'); }
  }
  useEffect(() => { void refresh(); }, []);
  async function toggle() {
    if (!overview || busy) return;
    setBusy(true); setError('');
    try {
      await api('/api/demo/ai-safety/safe-mode', 'POST', { enabled: overview.control.mode !== 'safe_mode', reasonCode: 'manual_demo' });
      await refresh();
    } catch { setError('安全模式修改未完成，请重新读取服务端状态后重试。'); await refresh(); }
    finally { setBusy(false); }
  }
  return <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm text-[#1F2329]" data-testid="ai-safety-screen" data-state={state === 'ready' ? overview?.control.mode : state}>
    <h1 className="text-lg font-bold">NOVA AI 安全</h1>
    <p>产品级安全控制，不代表机构整体合规</p>
    {state === 'loading' && <p role="status">正在读取安全状态…</p>}
    {(state === 'error' || state === 'unavailable') && <div role="alert"><p>○ {state === 'unavailable' ? '安全状态暂不可用' : '读取安全状态失败'}，尚未验证。</p><button className="mission-secondary" onClick={() => void refresh()}>重新读取</button></div>}
    {state === 'ready' && overview && <>
      <SafetyModeBanner control={overview.control} />
      {overview.demoControlsEnabled && <button type="button" role="switch" aria-checked={overview.control.mode === 'safe_mode'} disabled={busy} onClick={() => void toggle()} className="mission-secondary">Safe Mode 演示开关</button>}
      {error && <p role="alert">{error}</p>}
      <SafetyScorecard evaluation={overview.evaluation} />
      <h2 className="font-bold">能力安全护照 · {overview.passports.length} 项</h2>
      <p>已启用 {overview.passports.filter(p => p.enabled).length} 项 · 未启用 {overview.passports.filter(p => !p.enabled).length} 项</p>
      {overview.passports.map(p => <SafetyPassportCard key={p.skillId} passport={p} />)}
    </>}
  </div>;
}
