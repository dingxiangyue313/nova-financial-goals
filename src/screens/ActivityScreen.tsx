import React from 'react';

interface ActivityScreenProps {
  onNavigateToImpact: () => void;
}

export const ActivityScreen: React.FC<ActivityScreenProps> = ({ onNavigateToImpact }) => {
  const events = [
    {
      date: '9月20日 15:32',
      title: '汽车保养支出 ¥900',
      tag: '突发支出',
      tagColor: 'bg-red-50 text-red-600 border-red-200',
      description: '触发 NOVA 节奏研判：原储蓄计划可能受到 18 天波及。已生成 2 套平滑方案。',
      actionable: true,
    },
    {
      date: '9月15日 10:00',
      title: '月度存入 ¥500',
      tag: '常规积累',
      tagColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      description: '计入「日本旅行」专项资金，当前累计 ¥3,500，完成度 43.8%。',
      actionable: false,
    },
    {
      date: '9月01日 09:00',
      title: '月度资产底线体检',
      tag: '底线守护',
      tagColor: 'bg-teal-50 text-teal-700 border-teal-200',
      description: '¥20,000 应急金严密隔离保护中，无被意外挪用风险。',
      actionable: false,
    },
    {
      date: '8月28日 21:15',
      title: '创建新目标「日本旅行」',
      tag: '目标立项',
      tagColor: 'bg-blue-50 text-blue-700 border-blue-200',
      description: '通过语音录入快速解析，锁定 12月15日 出行窗口，总预算 ¥8,000。',
      actionable: false,
    },
  ];

  return (
    <div className="flex-1 flex flex-col pt-2 pb-safe px-4 overflow-y-auto no-scrollbar space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[18px] font-bold text-[#1F2329]">收支动态与脉络</h2>
          <p className="text-[12px] text-[#646A73]">每一笔生活涟漪，NOVA 都帮你稳妥接住</p>
        </div>
      </div>

      <div className="space-y-3">
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
            <p className="text-[12px] text-[#646A73] leading-relaxed">{evt.description}</p>
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
