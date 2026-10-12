import React from 'react';
import { Goal } from '../types';

interface GoalsListScreenProps {
  goal: Goal;
  hasImpactPending: boolean;
  onSelectGoal: (g: Goal) => void;
  onNavigateToCreate: () => void;
  onNavigateToImpact: () => void;
}

export const GoalsListScreen: React.FC<GoalsListScreenProps> = ({
  goal,
  hasImpactPending,
  onSelectGoal,
  onNavigateToCreate,
  onNavigateToImpact,
}) => {
  return (
    <div className="flex-1 flex flex-col pt-2 pb-safe px-4 overflow-y-auto no-scrollbar space-y-3.5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[18px] font-bold text-[#1F2329]">所有目标 & 资金池</h2>
          <p className="text-[12px] text-[#646A73]">动态追踪进度与隔离保护底线</p>
        </div>
        <button
          onClick={onNavigateToCreate}
          className="px-3 py-1.5 rounded-lg bg-[#0F6B6D] text-white text-[12px] font-semibold flex items-center gap-1 hover:bg-[#084C4E] transition-all cursor-pointer shadow-sm active:scale-95"
        >
          <span className="material-symbols-outlined text-[15px]">add</span>
          新建
        </button>
      </div>

      {/* Emergency Fund Protected Card */}
      <div className="bg-[#EBF7F2] border border-[#2E7D5B]/30 rounded-xl p-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#2E7D5B]/15 text-[#2E7D5B] flex items-center justify-center">
            <span className="material-symbols-outlined text-[20px]">shield</span>
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-[14px] font-bold text-[#1F2329]">核心应急金</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#2E7D5B] text-white font-semibold">
                绝对隔离
              </span>
            </div>
            <p className="text-[12px] text-[#646A73]">不纳入任何消费目标规划</p>
          </div>
        </div>
        <div className="text-right">
          <span className="text-[16px] font-bold text-[#2E7D5B] font-editorial">
            ¥{goal.emergencyFundProtected.toLocaleString()}
          </span>
          <p className="text-[11px] text-[#2E7D5B] font-medium">100% 安全</p>
        </div>
      </div>

      {/* Primary Goal Card */}
      <div
        onClick={() => onSelectGoal(goal)}
        className="bg-white border border-[#E5E8EB] rounded-xl p-3.5 shadow-sm space-y-2.5 cursor-pointer hover:border-[#0F6B6D]/50 transition-colors"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#0F6B6D]"></span>
            <span className="text-[15px] font-bold text-[#1F2329]">{goal.title}</span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#E6F2F2] text-[#0F6B6D] font-medium">
              专项预算
            </span>
          </div>
          <span className="text-[12px] text-[#646A73]">
            {goal.targetDate}
          </span>
        </div>

        <div className="flex items-baseline justify-between text-[13px]">
          <span className="text-[#646A73]">
            已存 <strong className="text-[#1F2329]">¥{goal.currentAmount.toLocaleString()}</strong>
          </span>
          <span className="text-[#646A73]">
            目标 ¥{goal.targetAmount.toLocaleString()}
          </span>
        </div>

        <div className="w-full h-2 rounded-full bg-[#F0F2F5] overflow-hidden">
          <div
            className="h-full bg-[#0F6B6D] rounded-full"
            style={{ width: `${goal.progressPercent}%` }}
          ></div>
        </div>

        <div className="flex items-center justify-between pt-1 text-[12px]">
          <span className="text-[#646A73]">
            月供计划: ¥{goal.monthlySavings.toLocaleString()}
          </span>
          <button
            disabled={!hasImpactPending}
            onClick={(e) => {
              e.stopPropagation();
              onNavigateToImpact();
            }}
            className="text-[#0F6B6D] hover:underline flex items-center gap-0.5 font-medium cursor-pointer"
          >
            <span>{hasImpactPending ? '查看影响分析' : '当前无显著影响'}</span>
            <span className="material-symbols-outlined text-[14px]">trending_up</span>
          </button>
        </div>
      </div>


    </div>
  );
};
