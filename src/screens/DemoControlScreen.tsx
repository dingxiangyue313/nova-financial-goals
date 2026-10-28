import type { Snapshot } from '../../shared/contracts';
import type { ScreenId } from '../types';
import { api } from '../api';

const SCREENS: { id: ScreenId; label: string }[] = [
  { id: 'home', label: '1. 首页' },
  { id: 'create_goal', label: '2. 创建目标' },
  { id: 'impact', label: '3. 目标影响' },
  { id: 'feasibility', label: '4. 目标可行性' },
  { id: 'workspace', label: 'NOVA 工作台' }
];

const EVENTS = [
  { label: '重置旅行任务', path: 'load', body: {} },
  { label: '工资到账并检查转入', path: 'demo-event', body: { kind: 'salary' } },
  { label: '工资未到账', path: 'demo-event', body: { kind: 'missing_salary' } },
  { label: '下次取消超时', path: 'demo-event', body: { kind: 'cancel_timeout' } },
  { label: '下次取消失败', path: 'demo-event', body: { kind: 'cancel_failure' } }
];

export function DemoControlScreen({
  currentScreen,
  deviceFrame,
  onNavigate,
  onToggleFrame,
  onSnapshot,
  onToast
}: {
  currentScreen: ScreenId;
  deviceFrame: boolean;
  onNavigate: (screen: ScreenId) => void;
  onToggleFrame: () => void;
  onSnapshot: (snapshot: Snapshot) => void;
  onToast: (message: string) => void;
}) {
  return (
    <>
      <aside aria-label="屏幕快速切换与调试" className="w-full max-w-[500px] px-3 mb-2 flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
          <span className="font-semibold text-[#5A616B] shrink-0 text-[11px]">快速直达:</span>
          {SCREENS.map(screen => (
            <button
              key={screen.id}
              onClick={() => onNavigate(screen.id)}
              className={`px-2.5 py-1 rounded-full shrink-0 cursor-pointer font-medium text-[11px] ${
                currentScreen === screen.id
                  ? 'bg-[#0F6B6D] text-white shadow-xs'
                  : 'bg-white/80 hover:bg-white text-[#1F2329] border border-[#D0D5DD]'
              }`}
            >
              {screen.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          <button
            onClick={onToggleFrame}
            className="p-1 rounded-md bg-white border border-[#D0D5DD] text-[#5A616B] hover:text-[#1F2329] cursor-pointer"
            title={deviceFrame ? '切换为自适应全屏' : '切换为手机尺寸 390x844'}
          >
            <span className="material-symbols-outlined text-[16px]">{deviceFrame ? 'fullscreen' : 'smartphone'}</span>
          </button>
        </div>
      </aside>
      <div className="w-full max-w-[500px] p-3 mb-3 bg-white rounded-xl space-y-2">
        <strong>Money Mission 演示后台</strong>
        <p className="text-xs">仅操作合成数据。先创建储蓄计划，再注入工资事件。工资事件同时载入11月26日的模拟银行余额快照。普通用户界面不会显示这些按钮。</p>
        <div className="flex flex-wrap gap-2">
          {EVENTS.map(item => (
            <button
              key={item.label}
              className="mission-secondary"
              onClick={async () => {
                try {
                  onSnapshot(await api<Snapshot>('/api/mission/' + item.path, 'POST', item.body));
                  onNavigate('home');
                } catch (error) {
                  onToast(error instanceof Error ? error.message : '操作未完成');
                }
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button className="mission-link" onClick={() => onNavigate('money_mission')}>打开账单流程</button>
        <button className="mission-link ml-4" onClick={() => onNavigate('money_mission')}>打开储蓄计划</button>
      </div>
    </>
  );
}
