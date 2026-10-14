import React, { useState } from 'react';
import { Goal, ImpactScenario } from '../types';
import { readableDate, shortDate } from '../api';

interface GoalImpactScreenProps {
  goal: Goal;
  scenario: ImpactScenario;
  onApplyOption: (option: 'A' | 'B') => void;
  onLater: () => void;
  onDismiss: () => void;
  onBack: () => void;
}

export const GoalImpactScreen: React.FC<GoalImpactScreenProps> = ({
  goal,
  scenario,
  onApplyOption,
  onLater,
  onDismiss,
}) => {
  const [selectedOption, setSelectedOption] = useState<'A' | 'B' | null>(null);

  const handleSubmit = () => {
    if (!selectedOption) return;
    onApplyOption(selectedOption);
  };

  return (
    <div className="flex-1 flex flex-col relative w-full pt-2 pb-4 px-4 overflow-y-auto no-scrollbar">
      <div className="flex flex-col w-full min-h-full justify-between pb-1 space-y-3">
        {/* Top Header Section */}
        <section className="flex flex-col space-y-2.5 pt-0.5">
          <div className="flex items-center justify-between">
            <h2 className="text-[20px] font-bold text-[#1F2329] tracking-tight">
              {goal.title}可能延期 {scenario.impactDays} 天
            </h2>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#E6F2F2] text-[#0F6B6D] text-[12px] font-semibold">
              <span className="material-symbols-outlined text-[14px]">psychology</span>
              NOVA 洞察
            </span>
          </div>

          <p className="text-[14px] text-[#5A616B] leading-relaxed">
            本月新增 ¥{scenario.expenseAmount.toLocaleString()} {scenario.expenseTitle}
            ，影响了原有储蓄节奏。你可以增加月存金额，或调整出发日期。
          </p>

          <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-[#EBF7F2] border border-[#276B4E]/20 text-[#1F2329]">
            <span className="material-symbols-outlined text-[#276B4E] text-[18px] shrink-0">
              verified_user
            </span>
            <div className="flex-1 flex items-center justify-between text-[13px]">
              <span className="text-[#1F2329] font-semibold">
                ¥{scenario.emergencyFundAmount.toLocaleString()} 应急金未受影响
              </span>
              <span className="text-[#276B4E] font-medium flex items-center gap-1 text-[12px]">
                <span className="material-symbols-outlined text-[14px]">check_circle</span>
                安全隔离
              </span>
            </div>
          </div>
        </section>

        {/* Section: 为什么会受影响 */}
        <section className="p-3.5 rounded-xl bg-white border border-[#E5E8EB] flex flex-col space-y-3 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-bold text-[#1F2329] tracking-wide uppercase">
              为什么会受影响
            </span>
            <span className="text-[11px] text-[#5A616B] bg-[#F5F7F8] border border-[#E5E8EB] px-2 py-0.5 rounded-full">
              基于当前模拟数据估算
            </span>
          </div>

          <div className="relative pl-6 space-y-3.5 before:absolute before:left-[9px] before:top-2 before:bottom-2 before:w-[2px] before:bg-[#E5E8EB]">
            {/* Step 1: 突发支出 */}
            <div className="relative group">
              <div className="absolute -left-[21px] top-1 w-3.5 h-3.5 rounded-full bg-white border border-[#CBD5E1] flex items-center justify-center">
                <span className="w-2 h-2 rounded-full bg-[#C74242]"></span>
              </div>
              <div className="flex flex-col">
                <div className="flex items-baseline justify-between">
                  <span className="text-[13px] text-[#C74242] font-semibold">
                    突发支出 · 触发点
                  </span>
                  <span className="text-[12px] text-[#8F959E]">{scenario.expenseDate}</span>
                </div>
                <p className="text-[14px] text-[#1F2329] mt-0.5">
                  记录到「{scenario.expenseTitle}{' '}
                  <span className="text-[15px] font-bold text-[#C74242]">
                    ¥{scenario.expenseAmount.toLocaleString()}
                  </span>
                  」
                </p>
              </div>
            </div>

            {/* Step 2: 传导影响 */}
            <div className="relative">
              <div className="absolute -left-[21px] top-1 w-3.5 h-3.5 rounded-full bg-white border border-[#CBD5E1] flex items-center justify-center">
                <span className="w-2 h-2 rounded-full bg-[#8F959E]"></span>
              </div>
              <div className="flex flex-col">
                <span className="text-[13px] text-[#5A616B] font-medium">
                  传导影响 · 结余调整
                </span>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[13px] text-[#8F959E] line-through">
                    预计 ¥{scenario.previousMonthly}
                  </span>
                  <span className="material-symbols-outlined text-[14px] text-[#8F959E]">
                    trending_flat
                  </span>
                  <span className="text-[14px] text-[#1F2329] font-bold">
                    现降至 ¥{scenario.adjustedMonthlyRemaining}
                  </span>
                </div>
              </div>
            </div>

            {/* Step 3: 目标影响 */}
            <div className="relative">
              <div className="absolute -left-[21px] top-1 w-3.5 h-3.5 rounded-full bg-white border border-[#CBD5E1] flex items-center justify-center">
                <span className="w-2 h-2 rounded-full bg-[#0F6B6D]"></span>
              </div>
              <div className="flex flex-col">
                <div className="flex items-baseline justify-between">
                  <span className="text-[13px] text-[#0F6B6D] font-bold">
                    目标影响 · {goal.title}
                  </span>
                </div>
                <p className="text-[13px] text-[#5A616B] mt-0.5">
                  原 {readableDate(goal.originalDate || goal.targetDate)}{' '}
                  <span className="text-[#1F2329] font-medium">
                    → 预计 {readableDate(scenario.optionB.completionDate)}
                  </span>
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Section: 方案选择 */}
        <section className="flex flex-col space-y-2.5">
          <div className="flex items-center gap-1.5 px-0.5">
            <span className="material-symbols-outlined text-[#0F6B6D] text-[18px]">
              lightbulb
            </span>
            <p className="text-[13px] text-[#1F2329] font-medium">
              我有两个不动应急金的办法，由你来决定生活节奏：
            </p>
          </div>

          <div className="flex flex-col space-y-2">
            {/* Option A */}
            <button type="button"
              disabled={!scenario.optionA.available}
              aria-pressed={selectedOption === 'A'}
              onClick={() => scenario.optionA.available && setSelectedOption('A')}
              className={`relative flex items-start gap-3 p-3.5 rounded-xl text-left transition-all cursor-pointer select-none shadow-sm ${
                selectedOption === 'A'
                  ? 'bg-[#F4FAF9] border-2 border-[#0F6B6D]'
                  : `bg-white border border-[#E5E8EB] hover:border-[#0F6B6D]/40 ${scenario.optionA.available ? '' : 'opacity-50 cursor-not-allowed'}`
              }`}
            >
              <div className="pt-0.5">
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                    selectedOption === 'A'
                      ? 'border-2 border-[#0F6B6D] bg-[#0F6B6D]'
                      : 'border-2 border-[#CBD5E1] bg-white'
                  }`}
                >
                  <div
                    className={`w-2 h-2 rounded-full bg-white ${
                      selectedOption === 'A' ? 'block' : 'hidden'
                    }`}
                  ></div>
                </div>
              </div>
              <div className="flex-1 flex flex-col min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-[14px] font-bold text-[#1F2329]">
                    {scenario.optionA.title}
                  </span>
                </div>
                <p className="text-[13px] text-[#5A616B] mt-1 leading-relaxed">
                  后续微调每月存入{' '}
                  <span className="text-[#1F2329] font-semibold">
                    ¥{scenario.optionA.newMonthly.toLocaleString()}
                  </span>
                  ，{scenario.optionA.available ? '预计可在' : '超出可用月结余，暂不可选；原目标日'}{' '}
                  <span className="text-[#1F2329] font-semibold">{shortDate(scenario.optionA.completionDate)}</span> 出发。
                </p>
              </div>
            </button>

            {/* Option B */}
            <button type="button"
              aria-pressed={selectedOption === 'B'}
              onClick={() => setSelectedOption('B')}
              className={`relative flex items-start gap-3 p-3.5 rounded-xl text-left transition-all cursor-pointer select-none shadow-sm ${
                selectedOption === 'B'
                  ? 'bg-[#F4FAF9] border-2 border-[#0F6B6D]'
                  : 'bg-white border border-[#E5E8EB] hover:border-[#0F6B6D]/40'
              }`}
            >
              <div className="pt-0.5">
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                    selectedOption === 'B'
                      ? 'border-2 border-[#0F6B6D] bg-[#0F6B6D]'
                      : 'border-2 border-[#CBD5E1] bg-white'
                  }`}
                >
                  <div
                    className={`w-2 h-2 rounded-full bg-white ${
                      selectedOption === 'B' ? 'block' : 'hidden'
                    }`}
                  ></div>
                </div>
              </div>
              <div className="flex-1 flex flex-col min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-[14px] font-bold text-[#1F2329]">
                    {scenario.optionB.title}
                  </span>
                </div>
                <p className="text-[13px] text-[#5A616B] mt-1 leading-relaxed">
                  维持每月存入{' '}
                  <span className="text-[#1F2329] font-semibold">
                    ¥{scenario.optionB.newMonthly.toLocaleString()}
                  </span>
                  ，平移出行窗口至{' '}
                  <span className="text-[#1F2329] font-semibold">{readableDate(scenario.optionB.completionDate)}</span>。
                </p>
              </div>
            </button>
          </div>
        </section>

        {/* CTA & Actions */}
        <section className="flex flex-col space-y-2 pt-1">
          <button
            disabled={!selectedOption}
            onClick={handleSubmit}
            className={`w-full py-3.5 px-5 rounded-xl text-[15px] font-semibold transition-all flex items-center justify-center gap-2 shadow-sm ${
              selectedOption
                ? 'bg-[#0F6B6D] text-white hover:bg-[#084C4E] active:scale-[0.99] cursor-pointer'
                : 'bg-[#E5E8EB] text-[#8F959E] cursor-not-allowed'
            }`}
          >
            <span>
              {selectedOption === 'A'
                ? '确认应用：方案 A（保持原日期）'
                : selectedOption === 'B'
                ? `确认应用：方案 B（延后 ${scenario.optionB.delayDays} 天）`
                : '请选择一个方案'}
            </span>
            {selectedOption && (
              <span className="material-symbols-outlined text-[18px]">
                arrow_forward
              </span>
            )}
          </button>

          <p className="text-[11px] text-[#8F959E] text-center">
            选择方案只会调整提醒与节奏，不会自动划扣资金
          </p>

          <div className="flex items-center justify-center gap-6 pt-0.5">
            <button
              onClick={onLater}
              className="text-[13px] font-medium text-[#5A616B] hover:text-[#0F6B6D] transition-colors py-1 flex items-center gap-1 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[15px]">schedule</span>
              稍后处理
            </button>
            <span className="w-1 h-1 rounded-full bg-[#CBD5E1]"></span>
            <button
              onClick={onDismiss}
              className="text-[13px] font-medium text-[#5A616B] hover:text-[#C74242] transition-colors py-1 flex items-center gap-1 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[15px]">close</span>
              忽略本次提示
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};
