import React from 'react';

import type { Audit } from '../../shared/contracts';

interface ActivityScreenProps {
  audit: Audit[];
  hasImpactPending: boolean;
  onNavigateToImpact: () => void;
}

export const ActivityScreen: React.FC<ActivityScreenProps> = ({ audit, hasImpactPending, onNavigateToImpact }) => {
  const events = [...audit].reverse().map(evt => ({
    date: evt.at.slice(0, 16).replace('T', ' '), title: evt.action,
    tag: evt.outcome, tagColor: evt.outcome === 'blocked' ? 'bg-red-50 text-red-600 border-red-200' : 'bg-teal-50 text-teal-700 border-teal-200',
    description: evt.detail, actionable: hasImpactPending && evt.action === 'simulate_expense',
  }));
  return (
    <div className="flex-1 flex flex-col pt-2 pb-safe px-4 overflow-y-auto no-scrollbar space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[18px] font-bold text-[#1F2329]">收支动态与脉络</h2>
          <p className="text-[12px] text-[#5A616B]">每一笔生活涟漪，NOVA 都帮你稳妥接住</p>
        </div>
      </div>

      <div className="space-y-3">
        {events.length === 0 && <div className="bg-white border border-[#E5E8EB] rounded-xl p-4 text-sm text-[#5A616B]">当前还没有操作记录。创建目标或模拟支出后，这里会显示审计轨迹。</div>}
        {events.map((evt, idx) => (
          <div
            key={idx}
            className="bg-white border border-[#E5E8EB] rounded-xl p-3.5 shadow-sm space-y-1.5"
          >
            <div className="flex items-center justify-between">
              <span className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold ${evt.tagColor}`}>
                {evt.tag}
              </span>
              <span className="text-[11px] text-[#8F959E]">{evt.date}</span>
            </div>
            <h3 className="text-[14px] font-bold text-[#1F2329]">{evt.title}</h3>
            <p className="text-[12px] text-[#5A616B] leading-relaxed">{evt.description}</p>
            {evt.actionable && (
              <div className="pt-1.5">
                <button
                  onClick={onNavigateToImpact}
                  className="w-full py-2 bg-[#E6F2F2] hover:bg-[#0F6B6D] hover:text-white text-[#0F6B6D] rounded-lg text-[12px] font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[15px]">psychology</span>
                  <span>查看影响与解决方案</span>
                  <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
