import React from 'react';
import { Goal, ScreenId } from '../types';

interface ProfileScreenProps {
  goal: Goal;
  onNavigate: (s: ScreenId) => void;
  onTriggerImpact: () => void;
  onResetData: () => void;
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({
  goal,
  onNavigate,
  onTriggerImpact,
  onResetData,
}) => {
  return (
    <div className="flex-1 flex flex-col pt-2 pb-safe px-4 overflow-y-auto no-scrollbar space-y-3.5">
      {/* Profile Card */}
      <div className="bg-white border border-[#E5E8EB] rounded-xl p-4 shadow-sm flex items-center gap-3.5">
        <div className="w-13 h-13 rounded-full bg-[#E6F2F2] border-2 border-[#0F6B6D]/30 flex items-center justify-center text-[#0F6B6D]">
          <span className="material-symbols-outlined text-[28px]">person</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-[17px] font-bold text-[#1F2329]">Alex</h2>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#EBF7F2] text-[#2E7D5B] font-semibold">
              守护正常
            </span>
          </div>
          <p className="text-[12px] text-[#646A73] mt-0.5">alex.planner@nova.fin</p>
        </div>
      </div>

      {/* Safety & Risk Settings */}
      <div className="bg-white border border-[#E5E8EB] rounded-xl p-4 shadow-sm space-y-3">
        <h3 className="text-[13px] font-bold text-[#1F2329] flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[17px] text-[#0F6B6D]">shield</span>
          安全边界设定
        </h3>

        <div className="flex items-center justify-between py-2 border-b border-[#F0F2F5] text-[13px]">
          <span className="text-[#646A73]">核心应急金底线</span>
          <span className="font-bold text-[#1F2329]">
            ¥{goal.emergencyFundProtected.toLocaleString()} (严格隔离)
          </span>
        </div>

        <div className="flex items-center justify-between py-2 border-b border-[#F0F2F5] text-[13px]">
          <span className="text-[#646A73]">可承受时间浮动</span>
          <span className="font-semibold text-[#1F2329]">1–2 周平滑</span>
        </div>

        <div className="flex items-center justify-between py-2 text-[13px]">
          <span className="text-[#646A73]">自动划扣授权</span>
          <span className="font-semibold text-[#2E7D5B] flex items-center gap-1">
            <span className="material-symbols-outlined text-[15px]">lock</span>
            从不自动划扣
          </span>
        </div>
      </div>

      {/* Quick Prototype Navigation & Simulation Tools */}
      <div className="bg-[#F8FAFB] border border-[#E5E8EB] rounded-xl p-3.5 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-bold text-[#1F2329] flex items-center gap-1">
            <span className="material-symbols-outlined text-[15px] text-[#0F6B6D]">tune</span>
            演示与屏幕快速直达
          </span>
          <span className="text-[10px] text-[#646A73]">原型无缝切换</span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-[12px]">
          <button
            onClick={() => onNavigate('home')}
            className="p-2.5 rounded-lg bg-white border border-[#E5E8EB] hover:border-[#0F6B6D] text-[#1F2329] font-medium text-left flex items-center gap-1.5 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px] text-[#0F6B6D]">dashboard</span>
            <span>屏幕 1：首页</span>
          </button>

          <button
            onClick={() => onNavigate('create_goal')}
            className="p-2.5 rounded-lg bg-white border border-[#E5E8EB] hover:border-[#0F6B6D] text-[#1F2329] font-medium text-left flex items-center gap-1.5 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px] text-[#0F6B6D]">mic</span>
            <span>屏幕 2：创建目标</span>
          </button>

          <button
            onClick={() => onNavigate('feasibility')}
            className="p-2.5 rounded-lg bg-white border border-[#E5E8EB] hover:border-[#0F6B6D] text-[#1F2329] font-medium text-left flex items-center gap-1.5 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px] text-[#0F6B6D]">analytics</span>
            <span>屏幕 4：目标可行性</span>
          </button>

          <button
            onClick={() => onNavigate('impact')}
            className="p-2.5 rounded-lg bg-white border border-[#E5E8EB] hover:border-[#0F6B6D] text-[#1F2329] font-medium text-left flex items-center gap-1.5 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px] text-[#C74242]">psychology</span>
            <span>屏幕 3：目标影响</span>
          </button>
        </div>

        <div className="pt-2 flex gap-2">
          <button
            onClick={onTriggerImpact}
            className="flex-1 py-2 rounded-lg bg-[#E6F2F2] hover:bg-[#0F6B6D] hover:text-white text-[#0F6B6D] font-semibold text-[12px] transition-colors cursor-pointer"
          >
            模拟突发支出 ¥900
          </button>
          <button
            onClick={onResetData}
            className="py-2 px-3 rounded-lg bg-white border border-[#E5E8EB] text-[#646A73] hover:text-[#1F2329] text-[12px] font-medium transition-colors cursor-pointer"
          >
            重置数据
          </button>
        </div>
      </div>
    </div>
  );
};
