import React, { useState } from 'react';
import { Goal } from '../types';
import type { Assessment } from '../../shared/contracts';

interface FeasibilityScreenProps {
  goal: Goal;
  assessment: Assessment;
  selectedPlanId: string | null;
  onConfirmPlan: (planId: string) => void;
  onBack: () => void;
}

export const FeasibilityScreen: React.FC<FeasibilityScreenProps> = ({
  goal,
  assessment,
  selectedPlanId,
  onConfirmPlan,
}) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const options = assessment.plans.map(p => ({
    id: p.id, type: p.label, amountText: `¥${(p.monthlyCents / 100).toLocaleString()}`,
    periodText: '/ 月', forecastText: p.explanation,
    isRecommended: p.recommended, disabled: p.status === 'infeasible',
  }));
  const selectedOption = options.find(o => o.id === selectedId);
  const percentage = goal.progressPercent.toFixed(1);

  return (
    <div className="flex-1 flex flex-col relative w-full pt-2 pb-safe px-4 overflow-y-auto no-scrollbar">
      <div className="flex flex-col w-full pb-6 space-y-3.5">
        {/* Headline Conclusion: Calm Editorial Assurance */}
        <div className="w-full rounded-xl p-3.5 flex flex-col gap-1 shadow-sm bg-white border border-[#E5E8EB]">
          <div className="flex items-start gap-2.5">
            <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 bg-[#EBF7F2]">
              <span
                className="material-symbols-outlined text-[20px] text-[#2E7D5B]"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                check_circle
              </span>
            </div>
            <div className="flex flex-col min-w-0">
              <h2 className="text-[16px] font-semibold tracking-tight text-[#1F2329]">
                {assessment.status === 'insufficient_data' ? '数据不足，先核对目标假设' : assessment.status === 'infeasible' ? '当前条件下目标难以按时实现' : assessment.status === 'at_risk' ? '当前节奏可能延期' : '按当前数据和假设，这个目标可以实现'}
              </h2>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#2E7D5B]"></span>
                <p className="text-[11px] text-[#646A73]">
                  {assessment.dataSufficiency}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* N-shaped Reasoning Track (3 Distinct Nodes with Flow Line) */}
        <div className="w-full rounded-xl p-3.5 shadow-sm relative overflow-hidden bg-white border border-[#E5E8EB]">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[12px] text-[#1F2329] font-bold tracking-wide">
              推演与推进阶段
            </span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#F0F2F5] text-[#646A73]">
              阶段详情
            </span>
          </div>

          <div className="relative flex flex-col space-y-3">
            {/* Connecting Vertical Line */}
            <div className="absolute left-[15px] top-3.5 bottom-3.5 w-0.5 bg-[#E5E8EB]"></div>

            {/* Node 1 */}
            <div className="relative flex items-start gap-2.5 z-10">
              <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm bg-[#E6F2F2] text-[#0F6B6D]">
                <span className="material-symbols-outlined text-[17px]">timelapse</span>
              </div>
              <div className="flex-1 rounded-lg p-2.5 shadow-sm bg-[#F8FAFB] border border-[#E5E8EB]">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-[#646A73]">阶段 01</span>
                  <span className="text-[11px] font-semibold text-[#1F2329]">当前进度</span>
                </div>
                <p className="text-[12px] mt-0.5 leading-relaxed text-[#1F2329]">
                  已存{' '}
                  <span className="font-semibold text-[#0F6B6D]">
                    ¥{goal.currentAmount.toLocaleString()}
                  </span>
                  ，完成 {percentage}%
                </p>
              </div>
            </div>

            {/* Node 2 */}
            <div className="relative flex items-start gap-2.5 z-10">
              <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm bg-[#EBF7F2] text-[#2E7D5B]">
                <span className="material-symbols-outlined text-[17px]">
                  event_available
                </span>
              </div>
              <div className="flex-1 rounded-lg p-2.5 shadow-sm bg-[#F8FAFB] border border-[#E5E8EB]">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-[#2E7D5B]">阶段 02</span>
                  <span className="text-[11px] font-semibold text-[#2E7D5B]">可行方案</span>
                </div>
                <p className="text-[12px] mt-0.5 leading-relaxed text-[#1F2329]">
                  建议月存{' '}
                  <span className="font-semibold text-[#0F6B6D]">
                    ¥{(assessment.plans.find(p => p.recommended)?.monthlyCents || assessment.requiredMonthlyCents) / 100}
                  </span>
                  ，{assessment.status === 'on_track' ? '预计按时完成' : '请比较下方方案'}
                </p>
              </div>
            </div>

            {/* Node 3 */}
            <div className="relative flex items-start gap-2.5 z-10">
              <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm bg-[#F0F2F5] text-[#646A73]">
                <span className="material-symbols-outlined text-[17px]">checklist</span>
              </div>
              <div className="flex-1 rounded-lg p-2.5 shadow-sm bg-[#F8FAFB] border border-[#E5E8EB]">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-[#646A73]">阶段 03</span>
                  <span className="text-[11px] font-semibold text-[#646A73]">确认计划</span>
                </div>
                <p className="text-[12px] mt-0.5 leading-relaxed text-[#1F2329]">
                  选择适合你的节奏，再决定是否启用
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Interactive Decision Options: 3 Choices */}
        <div className="w-full flex flex-col space-y-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-[12px] text-[#1F2329] font-bold">
              选择适合你的节奏
            </span>
            <span className="text-[11px] text-[#646A73]">请选择一种方案</span>
          </div>

          {options.map((option) => {
            const isSelected = selectedId === option.id;
            return (
              <button type="button"
                key={option.id}
                disabled={option.disabled}
                aria-pressed={isSelected}
                onClick={() => !option.disabled && setSelectedId(option.id)}
                className={`w-full rounded-xl p-3 flex items-center justify-between text-left transition-all cursor-pointer shadow-sm active:scale-[0.99] select-none ${
                  isSelected
                    ? 'bg-[#F4FAF9] border-2 border-[#0F6B6D]'
                    : 'bg-white border border-[#E5E8EB] hover:border-[#0F6B6D]/40' + (option.disabled ? ' opacity-50 cursor-not-allowed' : '')
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {/* Radio circle */}
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                      isSelected
                        ? 'border-2 border-[#0F6B6D] bg-[#0F6B6D]'
                        : 'border-2 border-[#D0D5DD] bg-white'
                    }`}
                  >
                    <div
                      className={`w-2 h-2 rounded-full transition-transform ${
                        isSelected ? 'bg-white scale-100' : 'bg-transparent scale-0'
                      }`}
                    ></div>
                  </div>

                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-bold text-[#1F2329]">
                        {option.type}
                      </span>
                      <span className="text-[16px] font-bold text-[#1F2329] font-editorial">
                        {option.amountText}
                      </span>
                      <span className="text-[12px] text-[#646A73]">
                        {option.periodText}
                      </span>
                      {option.isRecommended && (
                        <span className="text-[11px] px-1.5 py-0.5 rounded font-medium bg-[#E6F2F2] text-[#0F6B6D]">
                          NOVA 推荐
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-[#646A73] truncate">
                      {option.forecastText}
                    </p>
                  </div>
                </div>

                <span className="material-symbols-outlined text-[18px] text-[#9AA0A6]">
                  chevron_right
                </span>
              </button>
            );
          })}
        </div>

        {/* Action Area: Primary CTA & Safety Reassurance */}
        <div className="w-full flex flex-col space-y-2.5 pt-1">
          <button
            disabled={selectedId === null}
            onClick={() => selectedId && onConfirmPlan(selectedId)}
            className={`w-full h-12 rounded-xl text-[14px] font-semibold flex items-center justify-center gap-2 transition-all shadow-none ${
              selectedId !== null
                ? 'bg-[#0F6B6D] hover:bg-[#084C4E] active:scale-[0.98] text-white cursor-pointer shadow-md'
                : 'bg-[#E5E8EB] text-[#8F959E] cursor-not-allowed'
            }`}
          >
            <span>
              {selectedOption
                ? `确认以此节奏推进 (${selectedOption.amountText} / 月)`
                : '请选择一个方案'}
            </span>
            {selectedOption && (
              <span className="material-symbols-outlined text-[18px]">check</span>
            )}
          </button>

          <div className="flex items-center justify-center gap-1.5 px-2">
            <span className="material-symbols-outlined text-[15px] text-[#646A73]">
              lock
            </span>
            <span className="text-[11px] text-[#646A73] text-center">
              {selectedPlanId ? '当前方案已激活。' : '选择方案只会设置提醒与推进节奏，不会自动扣款。'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
