import React from 'react';
import { Goal, ScreenId } from '../types';

interface ProfileScreenProps {
  goal: Goal;
  onNavigate: (s: ScreenId) => void;
  onDataConnections: () => void;
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({
  goal,
  onNavigate,
  onDataConnections,
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
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#EBF7F2] text-[#276B4E] font-semibold">
              守护正常
            </span>
          </div>
          <p className="text-[12px] text-[#5A616B] mt-0.5">alex.planner@nova.fin</p>
        </div>
      </div>

      <button onClick={() => onNavigate('ai_safety')} className="w-full rounded-xl border border-[#E5E8EB] bg-white p-4 text-left font-semibold text-[#0F6B6D]">NOVA AI 安全</button>
      {/* Safety & Risk Settings */}
      <div className="bg-white border border-[#E5E8EB] rounded-xl p-4 shadow-sm space-y-3">
        <h3 className="text-[13px] font-bold text-[#1F2329] flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[17px] text-[#0F6B6D]">shield</span>
          安全边界设定
        </h3>

        <div className="flex items-center justify-between py-2 border-b border-[#F0F2F5] text-[13px]">
          <span className="text-[#5A616B]">核心应急金底线</span>
          <span className="font-bold text-[#1F2329]">
            ¥{goal.emergencyFundProtected.toLocaleString()} (严格隔离)
          </span>
        </div>

        <div className="flex items-center justify-between py-2 border-b border-[#F0F2F5] text-[13px]">
          <span className="text-[#5A616B]">可承受时间浮动</span>
          <span className="font-semibold text-[#1F2329]">{goal.flexibilityWeeks} 周浮动</span>
        </div>

        <div className="flex items-center justify-between py-2 text-[13px]">
          <span className="text-[#5A616B]">自动划扣授权</span>
          <span className="font-semibold text-[#276B4E] flex items-center gap-1">
            <span className="material-symbols-outlined text-[15px]">lock</span>
            从不自动划扣
          </span>
        </div>
      </div>

      <button onClick={onDataConnections} className="w-full bg-white border border-[#E5E8EB] rounded-xl p-4 shadow-sm flex items-center justify-between text-[#0F6B6D] font-semibold text-sm">
        <span className="flex items-center gap-2"><span className="material-symbols-outlined text-[19px]">account_balance</span>数据连接与自动守护</span>
        <span className="material-symbols-outlined">arrow_forward</span>
      </button>

    </div>
  );
};
