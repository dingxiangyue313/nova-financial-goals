import { useState } from 'react';
import { ScreenId, Goal, ImpactScenario } from './types';
import { initialGoal, defaultImpactScenario } from './data/mockData';
import { TopBar } from './components/TopBar';
import { BottomNav } from './components/BottomNav';
import { HomeScreen } from './screens/HomeScreen';
import { CreateGoalScreen } from './screens/CreateGoalScreen';
import { FeasibilityScreen } from './screens/FeasibilityScreen';
import { GoalImpactScreen } from './screens/GoalImpactScreen';
import { GoalsListScreen } from './screens/GoalsListScreen';
import { ActivityScreen } from './screens/ActivityScreen';
import { ProfileScreen } from './screens/ProfileScreen';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<ScreenId>('home');
  const [previousScreen, setPreviousScreen] = useState<ScreenId>('home');
  const [goal, setGoal] = useState<Goal>(initialGoal);
  const [scenario] = useState<ImpactScenario>(defaultImpactScenario);
  const [hasImpactPending, setHasImpactPending] = useState<boolean>(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [deviceFrame, setDeviceFrame] = useState<boolean>(true);
  const [showSimulateModal, setShowSimulateModal] = useState<boolean>(false);
  const [isAnalyzingGoal, setIsAnalyzingGoal] = useState<boolean>(false);

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
    } else if (currentScreen === 'impact') {
      setCurrentScreen('home');
    } else if (currentScreen === 'goals_list' || currentScreen === 'activity' || currentScreen === 'profile') {
      setCurrentScreen('home');
    } else {
      setCurrentScreen('home');
    }
  };

  const handleUpdateGoal = (updated: Partial<Goal>) => {
    setGoal((prev) => ({ ...prev, ...updated }));
    showToast('目标参数已实时调整');
  };

  const handleAnalyzeGoal = async (text: string): Promise<Partial<Goal>> => {
    setIsAnalyzingGoal(true);
    try {
      const response = await fetch('/api/goal/interpret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'DeepSeek 解析失败，请稍后重试。');
      }

      const parsed = payload.goal ?? {};
      const updates: Partial<Goal> = { quote: text };
      if (typeof parsed.title === 'string' && parsed.title.trim()) updates.title = parsed.title.trim();
      if (typeof parsed.targetAmount === 'number') updates.targetAmount = parsed.targetAmount;
      if (typeof parsed.targetDate === 'string' && parsed.targetDate.trim()) updates.targetDate = parsed.targetDate.trim();
      if (typeof parsed.monthlySavings === 'number') updates.monthlySavings = parsed.monthlySavings;
      if (typeof parsed.emergencyFundProtected === 'number') updates.emergencyFundProtected = parsed.emergencyFundProtected;
      if (typeof parsed.flexibilityWeeks === 'number') updates.flexibilityWeeks = parsed.flexibilityWeeks;

      setGoal((prev) => ({ ...prev, ...updates }));
      showToast('DeepSeek 已生成目标草案，请核对后再继续');
      return updates;
    } catch (error) {
      throw error instanceof Error ? error : new Error('DeepSeek 解析失败，请检查网络和 API 配置。');
    } finally {
      setIsAnalyzingGoal(false);
    }
  };

  const handleConfirmPlan = (monthlyAmount: number, delayDays: number) => {
    const updatedStatus = delayDays > 0 ? 'delayed' : 'normal';
    setGoal((prev) => ({
      ...prev,
      monthlySavings: monthlyAmount,
      delayDays,
      status: updatedStatus,
      targetDate:
        delayDays === 20
          ? '2027年1月5日'
          : delayDays === -25
          ? '2026年11月20日'
          : '2026年12月15日',
    }));
    showToast(`计划已确认：以每月 ¥${monthlyAmount.toLocaleString()} 节奏推进`);
    navigateTo('home');
  };

  const handleApplyOption = (option: 'A' | 'B') => {
    if (option === 'A') {
      setGoal((prev) => ({
        ...prev,
        monthlySavings: scenario.optionA.newMonthly,
        status: 'normal',
        delayDays: 0,
        targetDate: scenario.optionA.completionDate,
      }));
      showToast('已应用方案 A：微调月存 ¥1,800，保持原日期');
    } else {
      setGoal((prev) => ({
        ...prev,
        monthlySavings: scenario.optionB.newMonthly,
        status: 'delayed',
        delayDays: scenario.optionB.delayDays,
        targetDate: scenario.optionB.completionDate,
      }));
      showToast('已应用方案 B：出行延后 18 天至 2027年1月2日');
    }
    setHasImpactPending(false);
    navigateTo('home');
  };

  const handleLater = () => {
    showToast('已标记稍后处理，NOVA 将在下次账单日前再次提醒');
    navigateTo('home');
  };

  const handleDismiss = () => {
    setHasImpactPending(false);
    showToast('已忽略本次提示');
    navigateTo('home');
  };

  const handleResetData = () => {
    setGoal(initialGoal);
    setHasImpactPending(true);
    showToast('已重置为初始演示数据');
  };

  const handleTriggerImpact = () => {
    setHasImpactPending(true);
    navigateTo('impact');
    showToast('已模拟 9月20日 汽车保养支出 ¥900');
  };

  // Get screen titles for TopBar
  const getScreenTitle = () => {
    switch (currentScreen) {
      case 'create_goal':
        return '创建目标';
      case 'feasibility':
        return '目标可行性';
      case 'impact':
        return '目标影响';
      case 'goals_list':
        return '我的目标';
      case 'activity':
        return '动态脉络';
      case 'profile':
        return '个人设置';
      default:
        return '';
    }
  };

  const isHomeScreen = currentScreen === 'home';
  const showBottomNav =
    currentScreen === 'home' ||
    currentScreen === 'goals_list' ||
    currentScreen === 'activity' ||
    currentScreen === 'profile';

  return (
    <div className="min-h-screen bg-[#E5E8EB] flex flex-col items-center justify-center p-0 md:py-6 text-[#1F2329] selection:bg-[#E6F2F2]">
      {/* Top Floating Switcher Pill (Quick Screen Access) */}
      <aside aria-label="屏幕快速切换与调试" className="w-full max-w-[500px] px-3 mb-2 flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
          <span className="font-semibold text-[#646A73] shrink-0 text-[11px]">快速直达:</span>
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
            className="p-1 rounded-md bg-white border border-[#D0D5DD] text-[#646A73] hover:text-[#1F2329] cursor-pointer"
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
              hasImpactPending={hasImpactPending}
              onNavigateToFeasibility={() => navigateTo('feasibility')}
              onNavigateToImpact={() => navigateTo('impact')}
              onNavigateToCreate={() => navigateTo('create_goal')}
            />
          )}

          {currentScreen === 'create_goal' && (
            <CreateGoalScreen
              goal={goal}
              onUpdateGoal={handleUpdateGoal}
              onAnalyzeGoal={handleAnalyzeGoal}
              isAnalyzing={isAnalyzingGoal}
              onNext={() => navigateTo('feasibility')}
              onBack={handleBack}
            />
          )}

          {currentScreen === 'feasibility' && (
            <FeasibilityScreen
              goal={goal}
              onConfirmPlan={handleConfirmPlan}
              onBack={handleBack}
            />
          )}

          {currentScreen === 'impact' && (
            <GoalImpactScreen
              goal={goal}
              scenario={scenario}
              onApplyOption={handleApplyOption}
              onLater={handleLater}
              onDismiss={handleDismiss}
              onBack={handleBack}
            />
          )}

          {currentScreen === 'goals_list' && (
            <GoalsListScreen
              goal={goal}
              onSelectGoal={() => navigateTo('home')}
              onNavigateToCreate={() => navigateTo('create_goal')}
              onNavigateToImpact={() => navigateTo('impact')}
            />
          )}

          {currentScreen === 'activity' && (
            <ActivityScreen onNavigateToImpact={() => navigateTo('impact')} />
          )}

          {currentScreen === 'profile' && (
            <ProfileScreen
              goal={goal}
              onNavigate={navigateTo}
              onTriggerImpact={handleTriggerImpact}
              onResetData={handleResetData}
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
                  <span className="font-bold text-[14px] text-[#1F2329]">
                    模拟数据与事件注入
                  </span>
                </div>
                <button
                  onClick={() => setShowSimulateModal(false)}
                  className="text-[#646A73] hover:text-[#1F2329]"
                >
                  <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
              </div>

              <p className="text-[12px] text-[#646A73]">
                你可以在此随时模拟生活变动，测试 NOVA 如何动态护航你的目标与应急金。
              </p>

              <div className="space-y-2">
                <button
                  onClick={() => {
                    handleTriggerImpact();
                    setShowSimulateModal(false);
                  }}
                  className="w-full py-2.5 px-3 rounded-xl bg-[#E6F2F2] hover:bg-[#0F6B6D] hover:text-white text-[#0F6B6D] font-semibold text-[13px] text-left flex items-center justify-between transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px]">car_repair</span>
                    <span>模拟突发支出 ¥900 (触发目标影响)</span>
                  </div>
                  <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                </button>

                <button
                  onClick={() => {
                    handleUpdateGoal({ currentAmount: 5000 });
                    setShowSimulateModal(false);
                    showToast('已存入额外 ¥1,500，进度提升至 62.5%');
                  }}
                  className="w-full py-2.5 px-3 rounded-xl bg-[#F5F7F8] hover:bg-[#E5E8EB] text-[#1F2329] font-medium text-[13px] text-left flex items-center justify-between transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px] text-[#2E7D5B]">
                      savings
                    </span>
                    <span>模拟额外存入 ¥1,500 (超额提速)</span>
                  </div>
                  <span className="material-symbols-outlined text-[16px]">add</span>
                </button>

                <button
                  onClick={() => {
                    handleResetData();
                    setShowSimulateModal(false);
                  }}
                  className="w-full py-2 px-3 rounded-xl border border-[#E5E8EB] hover:bg-[#F5F7F8] text-[#646A73] text-[12px] font-medium text-center transition-colors cursor-pointer"
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
