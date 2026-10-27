import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ScreenId, Goal } from './types';
import { api, cents, displayGoal, displayImpact } from './api';
import type { DataSourceKind, DataSyncResult, RiskPreferences, Snapshot, UiCard } from '../shared/contracts';
import { normalizeUiCard } from '../shared/generative';
import { TopBar } from './components/TopBar';
import { BottomNav } from './components/BottomNav';
import { HomeScreen } from './screens/HomeScreen';
import { CreateGoalScreen } from './screens/CreateGoalScreen';
import { FeasibilityScreen } from './screens/FeasibilityScreen';
import { GoalImpactScreen } from './screens/GoalImpactScreen';
import { GoalsListScreen } from './screens/GoalsListScreen';
import { ActivityScreen } from './screens/ActivityScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { BankingDemoScreen } from './screens/BankingDemoScreen';
const AgentWorkspaceScreen = lazy(() => import('./screens/AgentWorkspaceScreen').then(module => ({ default: module.AgentWorkspaceScreen })));
const MoneyMissionScreen = lazy(() => import('./screens/MoneyMissionScreen').then(module => ({ default: module.MoneyMissionScreen })));
const DemoControlScreen = lazy(() => import('./screens/DemoControlScreen').then(module => ({ default: module.DemoControlScreen })));
import { DataConnectionScreen } from './screens/DataConnectionScreen';
import { OfflineScreen } from './screens/OfflineScreen';
import { NovaMark } from './components/NovaMark';
import { clearOfflineSnapshot, createOfflineSnapshot, loadOfflineSnapshot, saveOfflineSnapshot, type OfflineSnapshot } from './offline';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PwaUpdateEvent extends Event { detail: { updateSW: (reloadPage?: boolean) => Promise<void> } }

export default function App() {
  const [demoControlsEnabled, setDemoControlsEnabled] = useState(false);
  useEffect(() => { void api<{ demoControls: boolean }>('/api/capabilities')
    .then(result => setDemoControlsEnabled(result.demoControls)).catch(() => {}); }, []);
  const demoControl = demoControlsEnabled && window.location.pathname === '/demo-control';
  const [currentScreen, setCurrentScreen] = useState<ScreenId>('home');
  const [previousScreen, setPreviousScreen] = useState<ScreenId>('home');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [deviceFrame, setDeviceFrame] = useState<boolean>(true);
  const [showSimulateModal, setShowSimulateModal] = useState<boolean>(false);
  const [isAnalyzingGoal, setIsAnalyzingGoal] = useState<boolean>(false);
  const [draftChanges, setDraftChanges] = useState<Partial<Goal>>({});
  const [workspaceStarter, setWorkspaceStarter] = useState('');
  const [pendingConnectionThreadId, setPendingConnectionThreadId] = useState<string | null>(null);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [isOffline, setIsOffline] = useState(() => !navigator.onLine);
  const [offlineSnapshot, setOfflineSnapshot] = useState<OfflineSnapshot | null>(null);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(() => window.matchMedia('(display-mode: standalone)').matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
  const [showInstallHint, setShowInstallHint] = useState(false);
  const [pwaUpdate, setPwaUpdate] = useState<((reloadPage?: boolean) => Promise<void>) | null>(null);
  const [welcomeVisible, setWelcomeVisible] = useState(true);
  const [welcomeLeaving, setWelcomeLeaving] = useState(false);
  const initiallyRouted = useRef(false);
  const autoSyncing = useRef(false);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        let live = await api<Snapshot>('/api/session');
        if (!live.mission && live.goals.length === 0 && window.location.pathname !== '/demo-control') live = await api<Snapshot>('/api/mission/start', 'POST');
        if (active) { setSnapshot(live); setLoadError(null); }
      } catch (error) {
        const cached = await loadOfflineSnapshot();
        if (!active) return;
        setIsOffline(true);
        if (cached) setOfflineSnapshot(cached);
        setLoadError(error instanceof Error ? error.message : '无法读取数据');
      }
    };
    void load();
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(() => {
      if (reduced) setWelcomeVisible(false);
      else {
        setWelcomeLeaving(true);
        window.setTimeout(() => setWelcomeVisible(false), 250);
      }
    }, reduced ? 300 : 800);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!snapshot || initiallyRouted.current) return;
    initiallyRouted.current = true;
    setCurrentScreen(snapshot.goals.length ? 'home' : 'workspace');
  }, [snapshot]);
  useEffect(() => {
    if (!snapshot || snapshot.goals.length === 0) return;
    const safe = createOfflineSnapshot(snapshot);
    setOfflineSnapshot(safe);
    void saveOfflineSnapshot(safe);
  }, [snapshot]);
  useEffect(() => {
    const onOffline = () => {
      setIsOffline(true);
      if (snapshot?.goals.length) setOfflineSnapshot(createOfflineSnapshot(snapshot));
    };
    const onOnline = async () => {
      try {
        const live = await api<Snapshot>('/api/session');
        setSnapshot(live);
        setIsOffline(false);
        setLoadError(null);
      } catch (error) {
        setIsOffline(true);
        const cached = await loadOfflineSnapshot();
        if (cached) setOfflineSnapshot(cached);
        setLoadError(error instanceof Error ? error.message : '重新连接失败');
      }
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => { window.removeEventListener('offline', onOffline); window.removeEventListener('online', onOnline); };
  }, [snapshot]);
  useEffect(() => {
    const captureInstall = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent); };
    const installed = () => { setIsInstalled(true); setInstallPrompt(null); };
    const update = (event: Event) => setPwaUpdate(() => (event as PwaUpdateEvent).detail.updateSW);
    window.addEventListener('beforeinstallprompt', captureInstall);
    window.addEventListener('appinstalled', installed);
    window.addEventListener('nova-pwa-update', update);
    return () => {
      window.removeEventListener('beforeinstallprompt', captureInstall);
      window.removeEventListener('appinstalled', installed);
      window.removeEventListener('nova-pwa-update', update);
    };
  }, []);
  useEffect(() => {
    if (!snapshot || isOffline) return;
    let current = true;
    api<{ cards: UiCard[]; provider: string }>('/api/ui/cards').then(result => {
      if (!current) return;
      const cards = result.cards.map(card => normalizeUiCard(card));
      setSnapshot(previous => previous ? { ...previous, cards } : previous);
    }).catch(() => {});
    return () => { current = false; };
  }, [isOffline, snapshot?.goal.id, snapshot?.goal.savedCents, snapshot?.goal.selectedPlanId, snapshot?.pendingImpact?.id, snapshot?.operations.length]);
  const hasConnectedData = Boolean(snapshot?.dataConnections.some(item => item.status === 'connected'));
  useEffect(() => {
    if (!hasConnectedData || isOffline || snapshot?.mission) return;
    let active = true;
    const ensure = async () => {
      if (autoSyncing.current || document.visibilityState === 'hidden' || !navigator.onLine) return;
      autoSyncing.current = true;
      try {
        const outcome = await api<{ snapshot: Snapshot; result: DataSyncResult }>('/api/data-connections/sync/ensure', 'POST');
        if (!active) return;
        setSnapshot(outcome.snapshot);
        if (outcome.result.batchKinds.includes('goal_risk')) {
          setToastMessage('新流水已影响目标，NOVA 已生成风险解释');
          setTimeout(() => setToastMessage(null), 2800);
        }
      } catch {
        // A failed service check switches to the last safe read-only snapshot.
        if (active) setIsOffline(true);
      } finally { autoSyncing.current = false; }
    };
    void ensure();
    const timer = window.setInterval(() => void ensure(), 60_000);
    const onVisibility = () => { if (document.visibilityState === 'visible') void ensure(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, [hasConnectedData, isOffline, snapshot?.mission?.version]);
  const goal = snapshot?.primaryGoal ? displayGoal(snapshot) : null;
  const activeImpact = snapshot?.pendingImpact?.goalId == null || snapshot.pendingImpact.goalId === snapshot.primaryGoalId
    ? snapshot?.pendingImpact ?? null : null;
  const scenario = snapshot && activeImpact ? displayImpact({ ...snapshot, pendingImpact: activeImpact }) : null;
  const hasImpactPending = Boolean(activeImpact);

  const mutate = async (url: string, method: string, body?: unknown) => {
    try {
      const versionedBody = body && typeof body === 'object' && !Array.isArray(body)
        ? { ...(body as Record<string, unknown>), expectedTwinVersion: snapshot?.twinVersion } : body;
      const next = await api<Snapshot>(url, method, versionedBody);
      setSnapshot(next);
      return next;
    } catch (error) {
      showToast(error instanceof Error ? error.message : '操作失败');
      throw error;
    }
  };
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 2800);
  };

  const navigateTo = (screen: ScreenId) => {
    setPreviousScreen(currentScreen);
    setCurrentScreen(screen);
  };

  const handleBack = () => {
    if (currentScreen === 'feasibility') {
      if (previousScreen === 'create_goal') {
        setCurrentScreen('create_goal');
      } else {
        setCurrentScreen('home');
      }
    } else if (currentScreen === 'create_goal') {
      setCurrentScreen('home');
    } else if (currentScreen === 'data_connections') {
      setCurrentScreen(previousScreen === 'profile' ? 'profile' : 'create_goal');
    } else if (currentScreen === 'impact') {
      setCurrentScreen('home');
    } else if (currentScreen === 'workspace' || currentScreen === 'goals_list' || currentScreen === 'activity' || currentScreen === 'profile' || currentScreen === 'banking_demo') {
      setCurrentScreen('home');
    } else {
      setCurrentScreen('home');
    }
  };

  const handleUpdateGoal = (updated: Partial<Goal>) => {
    setDraftChanges(previous => ({ ...previous, ...updated }));
    showToast('已更新目标草案');
  };

  const handleAnalyzeGoal = async (text: string): Promise<Partial<Goal>> => {
    setIsAnalyzingGoal(true);
    try {
      const parsed = await api<{goal: Record<string, unknown>; provider: string; notice?: string}>('/api/goal/interpret', 'POST', { text });
      const changes: Partial<Goal> = { quote: text };
      if (typeof parsed.goal.title === 'string') changes.title = parsed.goal.title;
      if (typeof parsed.goal.targetAmount === 'number') changes.targetAmount = parsed.goal.targetAmount;
      if (typeof parsed.goal.targetDate === 'string') changes.targetDate = parsed.goal.targetDate;
      if (typeof parsed.goal.emergencyFundProtected === 'number') changes.emergencyFundProtected = parsed.goal.emergencyFundProtected;
      if (typeof parsed.goal.flexibilityWeeks === 'number') changes.flexibilityWeeks = parsed.goal.flexibilityWeeks;
      handleUpdateGoal(changes);
      showToast(parsed.provider === 'deepseek' ? 'DeepSeek 已解析，请核对草案' : '已用确定性模式解析，请核对草案');
      return changes;
    } finally { setIsAnalyzingGoal(false); }
  };

  const handleNext = async (updated: Partial<Goal>) => {
    if (!goal) return;
    const combined = { ...goal, ...draftChanges, ...updated };
    const next = await mutate('/api/goals', 'POST', {
      title: combined.title, targetCents: cents(combined.targetAmount), targetDate: combined.targetDate,
      protectedCents: cents(combined.emergencyFundProtected), quote: combined.quote || '',
      flexibilityWeeks: combined.flexibilityWeeks,
    });
    setDraftChanges({});
    navigateTo(next.dataConnections.some(item => item.status === 'connected') ? 'feasibility' : 'data_connections');
  };
  const handleConnectData = async (sources: DataSourceKind[]) => {
    setConnectionBusy(true);
    try {
      const outcome = await api<{ snapshot: Snapshot; result: DataSyncResult }>('/api/data-connections/connect', 'POST', { sources });
      setSnapshot(outcome.snapshot);
      showToast(`已读取近 90 天模拟流水（${outcome.result.importedCount} 笔）`);
      if (pendingConnectionThreadId) {
        const threadId = pendingConnectionThreadId;
        setPendingConnectionThreadId(null);
        try { await api('/api/agent/turn', 'POST', { threadId, message: '模拟数据已连接，请继续核算刚才的目标' }); }
        catch (error) { showToast(error instanceof Error ? error.message : '连接成功，请在工作台回复“继续核算”'); }
        setCurrentScreen('workspace');
      } else if (previousScreen === 'workspace') navigateTo('workspace');
      else if (previousScreen !== 'profile') navigateTo('feasibility');
    } catch (error) { showToast(error instanceof Error ? error.message : '连接失败'); }
    finally { setConnectionBusy(false); }
  };
  const handleRevokeData = async (source: DataSourceKind) => {
    setConnectionBusy(true);
    try {
      const outcome = await api<{ snapshot: Snapshot }>(`/api/data-connections/${source}/revoke`, 'POST');
      setSnapshot(outcome.snapshot);
      showToast('已停止后续同步；历史判断依据仍保留');
    } catch (error) { showToast(error instanceof Error ? error.message : '撤销失败'); }
    finally { setConnectionBusy(false); }
  };
  const handleRetryData = async (source: DataSourceKind) => {
    setConnectionBusy(true);
    try {
      const outcome = await api<{ snapshot: Snapshot; result: DataSyncResult }>(`/api/data-connections/${source}/retry`, 'POST');
      setSnapshot(outcome.snapshot);
      showToast(outcome.result.batchKinds.includes('goal_risk') ? '连接已恢复，NOVA 已补齐目标影响判断' : '连接已恢复，数据已更新');
    } catch (error) { showToast(error instanceof Error ? error.message : '重新连接失败'); }
    finally { setConnectionBusy(false); }
  };
  const handleDemoConnection = async (action: 'fail' | 'recover') => {
    const outcome = await api<{ snapshot: Snapshot; result?: DataSyncResult }>(`/api/demo/data-connections/wechat_pay/${action}`, 'POST');
    setSnapshot(outcome.snapshot);
    showToast(action === 'fail' ? '微信支付暂时无法更新，其他来源继续守护' : '微信支付连接已恢复');
  };
  const handleAdvanceDemo = async (date: '2026-09-22' | '2026-09-23') => {
    await mutate('/api/demo/clock', 'POST', { date });
    const outcome = await api<{ snapshot: Snapshot; result: DataSyncResult }>('/api/data-connections/sync/ensure', 'POST');
    setSnapshot(outcome.snapshot);
    if (outcome.result.batchKinds.includes('goal_risk')) {
      showToast('自动守护发现目标受到影响');
      navigateTo('workspace');
    } else showToast('自动同步完成；本次变化保持安静');
  };
  const handleUnexpectedExpenseDemo = async () => {
    try {
      const next = await mutate('/api/demo/expense', 'POST', { amountCents: 90000, title: '意外支出' });
      setShowSimulateModal(false);
      if (next.pendingImpact) {
        setCurrentScreen('impact');
        showToast('发现意外支出对目标的影响');
      } else showToast('已记录模拟支出；当前未达到提醒条件');
    } catch (error) { showToast(error instanceof Error ? error.message : '模拟支出失败'); }
  };
  const handleConfirmPlan = async (planId: string) => {
    await mutate('/api/goals/activate', 'POST', { planId });
    showToast('计划已激活；不会自动扣款');
    if (!isInstalled && localStorage.getItem('nova-install-hint-shown') !== '1') {
      localStorage.setItem('nova-install-hint-shown', '1');
      setShowInstallHint(true);
    }
    navigateTo('home');
  };
  const handleRiskPreferences = async (changes: Partial<RiskPreferences>) => {
    try {
      await api('/api/risk/preferences', 'PATCH', changes);
      const next = await api<Snapshot>('/api/session');
      setSnapshot(next);
      showToast('智能守护设置已更新');
    } catch (error) { showToast(error instanceof Error ? error.message : '设置更新失败'); throw error; }
  };
  const handleApplyOption = async (option: 'A' | 'B') => {
    await mutate('/api/impact/decision', 'POST', { decision: option });
    showToast(`已应用方案 ${option}`);
    navigateTo('home');
  };
  const handleLater = async () => {
    await mutate('/api/impact/decision', 'POST', { decision: 'later' });
    showToast('已标记稍后处理'); navigateTo('home');
  };
  const handleDismiss = async () => {
    await mutate('/api/impact/decision', 'POST', { decision: 'dismiss' });
    showToast('已忽略本次提示'); navigateTo('home');
  };
  const handleResetData = async () => {
    await mutate('/api/demo/reset', 'POST');
    showToast('已重置演示数据');
    navigateTo('workspace');
  };
  const handleLoadJapanDemo = async () => {
    const next = await mutate('/api/demo/load-japan', 'POST');
    setShowSimulateModal(false);
    setCurrentScreen('home');
    showToast(`${next.primaryGoal?.title ?? '日本旅行'}演示已载入`);
  };
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const installState = isInstalled ? 'installed' as const : installPrompt ? 'available' as const
    : isIos ? 'ios' as const : 'unavailable' as const;
  const handleInstall = async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') setIsInstalled(true);
      setInstallPrompt(null);
      return;
    }
    showToast(isIos ? '在 Safari 点“分享”，然后选择“添加到主屏幕”' : '请使用浏览器菜单中的“安装应用”或“添加到主屏幕”');
  };
  const handleClearOffline = async () => {
    await clearOfflineSnapshot();
    setOfflineSnapshot(null);
    showToast('本机离线数据已清除');
  };
  // Get screen titles for TopBar
  const getScreenTitle = () => {
    switch (currentScreen) {
      case 'create_goal':
        return '创建目标';
      case 'feasibility':
        return '目标可行性';
      case 'data_connections':
        return '数据连接';
      case 'bills':
        return '账单与消费';
      case 'savings':
        return '旅行储蓄计划';
      case 'impact':
        return '目标影响';
      case 'goals_list':
        return '我的目标';
      case 'activity':
        return '动态脉络';
      case 'profile':
        return '个人设置';
      case 'banking_demo':
        return '授权与执行记录';
      case 'workspace':
        return 'NOVA 工作台';
      default:
        return '';
    }
  };

  const isHomeScreen = currentScreen === 'home';
  const showBottomNav =
    currentScreen === 'home' ||
    currentScreen === 'workspace' ||
    currentScreen === 'goals_list' ||
    currentScreen === 'activity' ||
    currentScreen === 'profile';

  if (isOffline && offlineSnapshot) return <OfflineScreen snapshot={offlineSnapshot} onReconnect={() => window.location.reload()} />;
  if (!snapshot) return <div className="min-h-screen grid place-items-center bg-[#F5F7F8] px-6 text-center text-[#0F6B6D]">{loadError ? `加载失败：${loadError}。${isOffline ? '当前没有可用的离线摘要。' : '请刷新页面重试。'}` : 'NOVA 正在读取数据…'}</div>;
  if (welcomeVisible) return <div data-testid="nova-welcome" className={`fixed inset-0 z-[100] grid place-items-center bg-white transition-opacity duration-250 ${welcomeLeaving ? 'opacity-0' : 'opacity-100'}`}><div className="flex flex-col items-center px-8 text-center"><NovaMark size={72}/><p className="mt-7 text-[18px] font-bold tracking-tight text-[#1F2329]">不记账，也有数</p></div></div>;

  return (
    <div className="min-h-screen bg-[#E5E8EB] flex flex-col items-center justify-center p-0 md:py-6 text-[#1F2329] selection:bg-[#E6F2F2]">
      {/* Top Floating Switcher Pill (Quick Screen Access) */}
      {demoControl && (
        <Suspense fallback={<p>正在加载演示控制台…</p>}>
        <DemoControlScreen
          currentScreen={currentScreen}
          deviceFrame={deviceFrame}
          onNavigate={navigateTo}
          onToggleFrame={() => setDeviceFrame(!deviceFrame)}
          onSnapshot={setSnapshot}
          onToast={showToast}
        />
        </Suspense>
      )}
      {/* Main Screen Container (390 x 844 iPhone Frame or Responsive View) */}
      <div
        className={`bg-[#F5F7F8] relative flex flex-col overflow-hidden transition-all duration-300 ${
          deviceFrame
            ? 'w-[390px] max-w-[calc(100vw-16px)] h-[844px] max-h-[844px] min-h-[844px] rounded-[38px] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.3)] border-[8px] border-[#1F2329]'
            : currentScreen === 'workspace'
              ? 'w-full max-w-[1120px] min-h-screen md:min-h-[760px] md:max-h-[90vh] md:rounded-2xl md:shadow-xl md:border border-[#E5E8EB]'
              : 'w-full max-w-[420px] min-h-screen md:min-h-[844px] md:max-h-[90vh] md:rounded-2xl md:shadow-xl md:border border-[#E5E8EB]'
        }`}
      >
        {/* Top Header */}
        <TopBar
          isHome={isHomeScreen}
          title={getScreenTitle()}
          onBack={handleBack}
          onOpenSimulateModal={demoControl ? () => setShowSimulateModal(true) : undefined}
          onOpenProfile={() => navigateTo('profile')}
        />

        {/* Content Body */}
        <main className="flex-1 flex flex-col overflow-y-auto no-scrollbar relative w-full bg-[#F5F7F8]">
          {!goal && ['home', 'create_goal', 'feasibility', 'profile'].includes(currentScreen) && (
            <section className="m-4 rounded-2xl border border-[#D8E7E7] bg-white p-5 shadow-sm">
              <h1 className="text-[17px] font-bold text-[#1F2329]">还没有财务目标</h1>
              <p className="mt-2 text-[13px] leading-relaxed text-[#5A616B]">创建目标后，这里会显示首页进度、可行性分析和智能守护提醒。你也可以载入日本旅行模拟数据，查看完整的原版页面。</p>
              <button onClick={() => navigateTo('workspace')} className="mt-4 w-full rounded-xl bg-[#0F6B6D] px-4 py-3 text-[13px] font-semibold text-white">和 NOVA 创建目标</button>
              <button onClick={() => setShowSimulateModal(true)} className="mt-2 w-full rounded-xl border border-[#B9D9D8] px-4 py-3 text-[13px] font-semibold text-[#0F6B6D]">查看日本旅行演示</button>
            </section>
          )}
          {currentScreen === 'home' && goal && (
            <HomeScreen
              goal={goal}
              snapshot={snapshot}
              hasImpactPending={hasImpactPending}
              onNavigateToBills={() => navigateTo('bills')}
              onNavigateToFeasibility={() => navigateTo(snapshot.mission ? 'savings' : 'feasibility')}
              onNavigateToImpact={() => navigateTo('impact')}
              onNavigateToCreate={() => { setWorkspaceStarter('我想创建一个新的财务目标'); navigateTo('workspace'); }}
            />
          )}

          {(currentScreen === 'bills' || currentScreen === 'savings') && <Suspense fallback={<p className="p-4 text-sm">正在读取旅行任务…</p>}><MoneyMissionScreen snapshot={snapshot} onSnapshot={setSnapshot} mode={currentScreen === 'bills' ? 'bills' : 'savings'} onSavings={() => navigateTo('savings')} /></Suspense>}
          {currentScreen === 'create_goal' && goal && (
            <CreateGoalScreen
              goal={goal}
              onUpdateGoal={handleUpdateGoal}
              onAnalyzeGoal={handleAnalyzeGoal}
              isAnalyzing={isAnalyzingGoal}
              onNext={handleNext}
              onBack={handleBack}
            />
          )}

          {currentScreen === 'feasibility' && goal && (
            <FeasibilityScreen
              goal={goal}
              assessment={snapshot.assessment}
              selectedPlanId={snapshot.goal.selectedPlanId}
              riskPreferences={snapshot.riskPreferences}
              onUpdateRiskPreferences={handleRiskPreferences}
              onConfirmPlan={handleConfirmPlan}
              onBack={handleBack}
            />
          )}

          {currentScreen === 'data_connections' && (
            <DataConnectionScreen
              connections={snapshot.dataConnections}
              onboarding={previousScreen !== 'profile'}
              busy={connectionBusy}
              onConnect={handleConnectData}
              onRevoke={handleRevokeData}
              onRetry={handleRetryData}
              onBack={handleBack}
            />
          )}

          {currentScreen === 'impact' && goal && scenario && (
            <GoalImpactScreen
              goal={goal}
              scenario={scenario}
              onApplyOption={handleApplyOption}
              onLater={handleLater}
              onDismiss={handleDismiss}
              onBack={handleBack}
            />
          )}

          {currentScreen === 'impact' && !scenario && <div className="m-4 bg-white rounded-xl p-5 text-sm text-[#5A616B]">目前没有显著支出影响。连接数据并激活计划后，NOVA 会随新流水自动判断。</div>}

          {currentScreen === 'goals_list' && (
            <GoalsListScreen
              goals={snapshot.goals}
              primaryGoalId={snapshot.primaryGoalId}
              emergencyCents={snapshot.finance.emergencyCents}
              onSelectGoal={async id => { const next = await mutate(`/api/goals/${id}/set-primary`, 'POST'); setSnapshot(next); navigateTo('home'); }}
              onNavigateToCreate={() => { setWorkspaceStarter('我想创建一个新的财务目标'); navigateTo('workspace'); }}
              onNavigateToImpact={() => navigateTo('impact')}
              hasImpactPending={hasImpactPending}
            />
          )}

          {currentScreen === 'activity' && (
            <ActivityScreen snapshot={snapshot} mutate={mutate} hasImpactPending={hasImpactPending}
              onNavigateToImpact={() => navigateTo('impact')} onNavigateToBanking={() => navigateTo('banking_demo')} />
          )}

          {currentScreen === 'banking_demo' && <BankingDemoScreen snapshot={snapshot} mutate={mutate}
            onNavigateActivity={() => navigateTo('activity')} />}

          {currentScreen === 'workspace' && <Suspense fallback={<p className="p-4 text-sm text-[#5A616B]">正在打开 NOVA 工作台…</p>}><AgentWorkspaceScreen snapshot={snapshot} compact={deviceFrame}
            starter={workspaceStarter} onSnapshot={setSnapshot} onNavigate={navigateTo}
            onConnectData={threadId => { setPendingConnectionThreadId(threadId); navigateTo('data_connections'); }} /></Suspense>}

          {currentScreen === 'profile' && goal && (
            <ProfileScreen
              goal={goal}
              onNavigate={navigateTo}
              onResetData={handleResetData}
              onBankingDemo={() => navigateTo('banking_demo')}
              onDataConnections={() => navigateTo('data_connections')}
              installState={installState}
              onInstall={() => void handleInstall()}
              onClearOffline={() => void handleClearOffline()}
            />
          )}
        </main>

        {/* Bottom Nav on Home / Tabs */}
        {showBottomNav && (
          <BottomNav currentScreen={currentScreen} onNavigate={navigateTo} />
        )}

        {/* Toast Notification */}
        {toastMessage && (
          <div className="absolute top-16 left-4 right-4 z-50 bg-[#1F2329]/95 text-white text-[13px] px-3.5 py-2.5 rounded-xl shadow-lg backdrop-blur-sm flex items-center justify-between animate-fadeIn">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px] text-[#0F6B6D]">
                info
              </span>
              <span>{toastMessage}</span>
            </div>
            <button
              onClick={() => setToastMessage(null)}
              className="text-white/70 hover:text-white"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
        )}

        {showInstallHint && currentScreen === 'home' && (
          <div className="absolute bottom-20 left-4 right-4 z-40 rounded-2xl border border-[#B9D9D8] bg-white p-4 shadow-xl">
            <p className="text-[13px] font-bold text-[#1F2329]">把 NOVA 放到主屏幕</p>
            <p className="mt-1 text-[11px] text-[#5A616B]">随时查看目标守护状态；离线时只展示最近一次摘要。</p>
            <div className="mt-3 flex gap-2">
              <button onClick={() => { void handleInstall(); setShowInstallHint(false); }} className="flex-1 rounded-lg bg-[#0F6B6D] px-3 py-2 text-[12px] font-semibold text-white">{installState === 'available' ? '安装' : '查看方法'}</button>
              <button onClick={() => setShowInstallHint(false)} className="rounded-lg border border-[#E5E8EB] px-3 py-2 text-[12px] text-[#5A616B]">以后再说</button>
            </div>
          </div>
        )}

        {pwaUpdate && (
          <div className="absolute top-16 left-4 right-4 z-50 rounded-xl bg-[#1F2329] p-3 text-white shadow-xl">
            <p className="text-[12px] font-semibold">NOVA 有新版本可用</p>
            <button onClick={() => void pwaUpdate(true)} className="mt-2 rounded-lg bg-white px-3 py-1.5 text-[11px] font-bold text-[#0F6B6D]">更新并重新打开</button>
          </div>
        )}

        {/* Modal: 模拟数据控制器 */}
        {showSimulateModal && (
          <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-end justify-center p-3">
            <div className="w-full bg-white rounded-2xl p-4 space-y-3 shadow-2xl animate-slideUp">
              <div className="flex items-center justify-between pb-2 border-b border-[#E5E8EB]">
                <div className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[18px] text-[#0F6B6D]">
                    science
                  </span>
                  <span className="font-bold text-[14px] text-[#1F2329]">模拟时间与自动同步</span>
                </div>
                <button
                  onClick={() => setShowSimulateModal(false)}
                  className="text-[#5A616B] hover:text-[#1F2329]"
                >
                  <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
              </div>

              <p className="text-[12px] text-[#5A616B]">推进演示日期后，已连接的数据来源会自动出现对应流水；用户无需记账或手动同步。</p>

              <div className="space-y-2">
                <button
                  onClick={() => void handleLoadJapanDemo()}
                  className="w-full rounded-xl bg-[#0F6B6D] px-3 py-2.5 text-left text-[13px] font-semibold text-white"
                >一键载入日本旅行演示</button>
                <button
                  onClick={() => { void handleAdvanceDemo('2026-09-22'); setShowSimulateModal(false); }}
                  disabled={!hasConnectedData}
                  className="w-full py-2.5 px-3 rounded-xl bg-[#F2FAFA] hover:bg-[#D8E7E7] text-[#0F6B6D] font-semibold text-[13px] text-left flex items-center justify-between transition-colors cursor-pointer disabled:opacity-40"
                >
                  <div className="flex items-center gap-2"><span className="material-symbols-outlined text-[18px]">event_note</span><span>推进到 9月22日 · 普通趋势</span></div>
                  <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                </button>
                <button
                  onClick={() => { void handleAdvanceDemo('2026-09-23'); setShowSimulateModal(false); }}
                  disabled={!hasConnectedData}
                  className="w-full py-2.5 px-3 rounded-xl bg-[#FFF7E6] hover:bg-[#F5A623] hover:text-white text-[#8A5A00] font-semibold text-[13px] text-left flex items-center justify-between transition-colors cursor-pointer disabled:opacity-40"
                >
                  <div className="flex items-center gap-2"><span className="material-symbols-outlined text-[18px]">insights</span><span>推进到 9月23日 · 目标风险</span></div>
                  <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                </button>
                <button
                  onClick={() => { void handleUnexpectedExpenseDemo(); }}
                  disabled={!goal || snapshot.goal.status !== 'active'}
                  className="w-full py-2.5 px-3 rounded-xl bg-[#FFF7E6] text-[#8A5A00] font-semibold text-[13px] text-left flex items-center gap-2 disabled:opacity-40"
                >
                  <span className="material-symbols-outlined text-[18px]">receipt_long</span>
                  模拟一笔 ¥900 意外支出并查看提醒
                </button>
                {!hasConnectedData && <p className="rounded-lg bg-[#FFF7E6] p-2 text-[11px] text-[#8A5A00]">请先在创建目标流程或“我的 → 数据连接与自动守护”连接模拟来源。</p>}

                {snapshot.dataConnections.some(item => item.source === 'wechat_pay' && item.status === 'connected') && (
                  <button
                    onClick={() => { void handleDemoConnection('fail'); setShowSimulateModal(false); }}
                    className="w-full py-2.5 px-3 rounded-xl border border-[#F2D5A7] bg-[#FFF9ED] text-[#76551D] font-semibold text-[13px] text-left flex items-center justify-between"
                  >
                    <span className="flex items-center gap-2"><span className="material-symbols-outlined text-[18px]">cloud_off</span>模拟微信支付连接失败</span>
                    <span className="text-[10px] font-normal">其他来源继续</span>
                  </button>
                )}
                {snapshot.dataConnections.some(item => item.source === 'wechat_pay' && item.status === 'error') && (
                  <button
                    onClick={() => { void handleDemoConnection('recover'); setShowSimulateModal(false); }}
                    className="w-full py-2.5 px-3 rounded-xl border border-[#B9D9D8] bg-[#F2FAFA] text-[#0F6B6D] font-semibold text-[13px] text-left flex items-center justify-between"
                  >
                    <span className="flex items-center gap-2"><span className="material-symbols-outlined text-[18px]">cloud_done</span>恢复微信支付连接</span>
                    <span className="material-symbols-outlined text-[16px]">refresh</span>
                  </button>
                )}

                <button
                  onClick={() => {
                    void handleResetData();
                    setShowSimulateModal(false);
                  }}
                  className="w-full py-2 px-3 rounded-xl border border-[#E5E8EB] hover:bg-[#F5F7F8] text-[#5A616B] text-[12px] font-medium text-center transition-colors cursor-pointer"
                >
                  恢复初始 9月21日 基准状态
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
