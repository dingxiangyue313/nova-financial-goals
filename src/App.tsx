import { useEffect, useRef, useState } from 'react';
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
import { AgentWorkspaceScreen } from './screens/AgentWorkspaceScreen';
import { DataConnectionScreen } from './screens/DataConnectionScreen';

export default function App() {
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
  const [connectionBusy, setConnectionBusy] = useState(false);
  const autoSyncing = useRef(false);
  useEffect(() => {
    api('/api/session').then(setSnapshot).catch(e => setLoadError(e.message));
  }, []);
  useEffect(() => {
    if (!snapshot) return;
    let current = true;
    api<{ cards: UiCard[]; provider: string }>('/api/ui/cards').then(result => {
      if (!current) return;
      const cards = result.cards.map(card => normalizeUiCard(card));
      setSnapshot(previous => previous ? { ...previous, cards } : previous);
    }).catch(() => {});
    return () => { current = false; };
  }, [snapshot?.goal.id, snapshot?.goal.savedCents, snapshot?.goal.selectedPlanId, snapshot?.pendingImpact?.id, snapshot?.operations.length]);
  const hasConnectedData = Boolean(snapshot?.dataConnections.some(item => item.status === 'connected'));
  useEffect(() => {
    if (!hasConnectedData) return;
    let active = true;
    const ensure = async () => {
      if (autoSyncing.current || document.visibilityState === 'hidden') return;
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
        // Automatic checks stay quiet; the connection screen shows persistent status.
      } finally { autoSyncing.current = false; }
    };
    void ensure();
    const timer = window.setInterval(() => void ensure(), 60_000);
    const onVisibility = () => { if (document.visibilityState === 'visible') void ensure(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, [hasConnectedData]);
  const goal = snapshot ? displayGoal(snapshot) : null;
  const scenario = snapshot ? displayImpact(snapshot) : null;
  const hasImpactPending = Boolean(snapshot?.pendingImpact);

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
      if (previousScreen !== 'profile') navigateTo('feasibility');
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
  const handleAdvanceDemo = async (date: '2026-09-22' | '2026-09-23') => {
    await mutate('/api/demo/clock', 'POST', { date });
    const outcome = await api<{ snapshot: Snapshot; result: DataSyncResult }>('/api/data-connections/sync/ensure', 'POST');
    setSnapshot(outcome.snapshot);
    if (outcome.result.batchKinds.includes('goal_risk')) {
      showToast('自动守护发现目标受到影响');
      navigateTo('workspace');
    } else showToast('自动同步完成；本次变化保持安静');
  };
  const handleConfirmPlan = async (planId: string) => {
    await mutate('/api/goals/activate', 'POST', { planId });
    showToast('计划已激活；不会自动扣款');
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

  if (!snapshot || !goal) return <div className="min-h-screen grid place-items-center bg-[#F5F7F8] text-[#0F6B6D]">{loadError ? `加载失败：${loadError}。请刷新页面重试。` : 'NOVA 正在读取演示数据…'}</div>;

  return (
    <div className="min-h-screen bg-[#E5E8EB] flex flex-col items-center justify-center p-0 md:py-6 text-[#1F2329] selection:bg-[#E6F2F2]">
      {/* Top Floating Switcher Pill (Quick Screen Access) */}
      <aside aria-label="屏幕快速切换与调试" className="w-full max-w-[500px] px-3 mb-2 flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
          <span className="font-semibold text-[#5A616B] shrink-0 text-[11px]">快速直达:</span>
          <button
            onClick={() => navigateTo('home')}
            className={`px-2.5 py-1 rounded-full shrink-0 transition-all cursor-pointer font-medium text-[11px] ${
              currentScreen === 'home'
                ? 'bg-[#0F6B6D] text-white shadow-xs'
                : 'bg-white/80 hover:bg-white text-[#1F2329] border border-[#D0D5DD]'
            }`}
          >
            1. 首页
          </button>
          <button
            onClick={() => navigateTo('create_goal')}
            className={`px-2.5 py-1 rounded-full shrink-0 transition-all cursor-pointer font-medium text-[11px] ${
              currentScreen === 'create_goal'
                ? 'bg-[#0F6B6D] text-white shadow-xs'
                : 'bg-white/80 hover:bg-white text-[#1F2329] border border-[#D0D5DD]'
            }`}
          >
            2. 创建目标
          </button>
          <button
            onClick={() => navigateTo('feasibility')}
            className={`px-2.5 py-1 rounded-full shrink-0 transition-all cursor-pointer font-medium text-[11px] ${
              currentScreen === 'feasibility'
                ? 'bg-[#0F6B6D] text-white shadow-xs'
                : 'bg-white/80 hover:bg-white text-[#1F2329] border border-[#D0D5DD]'
            }`}
          >
            4. 目标可行性
          </button>
          <button
            onClick={() => navigateTo('impact')}
            className={`px-2.5 py-1 rounded-full shrink-0 transition-all cursor-pointer font-medium text-[11px] ${
              currentScreen === 'impact'
                ? 'bg-[#0F6B6D] text-white shadow-xs'
                : 'bg-white/80 hover:bg-white text-[#1F2329] border border-[#D0D5DD]'
            }`}
          >
            3. 目标影响
          </button>
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-2">
          <button
            onClick={() => setDeviceFrame(!deviceFrame)}
            className="p-1 rounded-md bg-white border border-[#D0D5DD] text-[#5A616B] hover:text-[#1F2329] cursor-pointer"
            title={deviceFrame ? '切换为自适应全屏' : '切换为手机尺寸 390x844'}
          >
            <span className="material-symbols-outlined text-[16px]">
              {deviceFrame ? 'fullscreen' : 'smartphone'}
            </span>
          </button>
        </div>
      </aside>

      {/* Main Screen Container (390 x 844 iPhone Frame or Responsive View) */}
      <div
        className={`bg-[#F5F7F8] relative flex flex-col overflow-hidden transition-all duration-300 ${
          deviceFrame
            ? 'w-[390px] max-w-[390px] h-[844px] max-h-[844px] min-h-[844px] rounded-[38px] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.3)] border-[8px] border-[#1F2329]'
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
          onOpenSimulateModal={() => setShowSimulateModal(true)}
          onOpenProfile={() => navigateTo('profile')}
        />

        {/* Content Body */}
        <main className="flex-1 flex flex-col overflow-y-auto no-scrollbar relative w-full bg-[#F5F7F8]">
          {currentScreen === 'home' && (
            <HomeScreen
              goal={goal}
              snapshot={snapshot}
              hasImpactPending={hasImpactPending}
              onNavigateToFeasibility={() => navigateTo('feasibility')}
              onNavigateToImpact={() => navigateTo('impact')}
              onNavigateToCreate={() => { setWorkspaceStarter('我想创建一个新的财务目标'); navigateTo('workspace'); }}
            />
          )}

          {currentScreen === 'create_goal' && (
            <CreateGoalScreen
              goal={goal}
              onUpdateGoal={handleUpdateGoal}
              onAnalyzeGoal={handleAnalyzeGoal}
              isAnalyzing={isAnalyzingGoal}
              onNext={handleNext}
              onBack={handleBack}
            />
          )}

          {currentScreen === 'feasibility' && (
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
              onBack={handleBack}
            />
          )}

          {currentScreen === 'impact' && scenario && (
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
              goal={goal}
              onSelectGoal={() => navigateTo('home')}
              onNavigateToCreate={() => navigateTo('create_goal')}
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

          {currentScreen === 'workspace' && <AgentWorkspaceScreen snapshot={snapshot} compact={deviceFrame}
            starter={workspaceStarter} onSnapshot={setSnapshot} onNavigate={navigateTo} />}

          {currentScreen === 'profile' && (
            <ProfileScreen
              goal={goal}
              onNavigate={navigateTo}
              onResetData={handleResetData}
              onBankingDemo={() => navigateTo('banking_demo')}
              onDataConnections={() => navigateTo('data_connections')}
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
                {!hasConnectedData && <p className="rounded-lg bg-[#FFF7E6] p-2 text-[11px] text-[#8A5A00]">请先在创建目标流程或“我的 → 数据连接与自动守护”连接模拟来源。</p>}

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
