import React, { useState } from 'react';
import { Goal } from '../types';

interface CreateGoalScreenProps {
  goal: Goal;
  onUpdateGoal: (updated: Partial<Goal>) => void;
  onAnalyzeGoal: (text: string) => Promise<Partial<Goal>>;
  isAnalyzing: boolean;
  onNext: (updated: Partial<Goal>) => void;
  onBack: () => void;
}

export const CreateGoalScreen: React.FC<CreateGoalScreenProps> = ({
  goal,
  onUpdateGoal,
  onAnalyzeGoal,
  isAnalyzing,
  onNext,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [customQuote, setCustomQuote] = useState(
    goal.quote || '“我想三个月后去日本旅行，预算¥8,000，不能动应急金。”'
  );
  const [targetAmount, setTargetAmount] = useState(goal.targetAmount);
  const [targetDate, setTargetDate] = useState(goal.targetDate);
  const [emergencyFund, setEmergencyFund] = useState(goal.emergencyFundProtected);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisComplete, setAnalysisComplete] = useState(false);

  const handleAnalyze = async () => {
    if (!customQuote.trim()) {
      setAnalysisError('请先输入目标描述。');
      return;
    }
    setAnalysisError(null);
    setAnalysisComplete(false);
    try {
      const updates = await onAnalyzeGoal(customQuote.trim());
      if (typeof updates.targetAmount === 'number') setTargetAmount(updates.targetAmount);
      if (typeof updates.targetDate === 'string') setTargetDate(updates.targetDate);
      if (typeof updates.emergencyFundProtected === 'number') setEmergencyFund(updates.emergencyFundProtected);
      setAnalysisComplete(true);
      setIsEditing(true);
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : '解析失败，请检查 API 配置后重试。');
    }
  };

  const handleSaveSettings = () => {
    onUpdateGoal({
      targetAmount,
      targetDate,
      emergencyFundProtected: emergencyFund,
      quote: customQuote,
    });
    setIsEditing(false);
  };

  const samplePresets = [
    '“我想三个月后去日本旅行，预算¥8,000，不能动应急金。”',
    '“打算明年春天去冰岛看极光，存¥18,000，应急金保持¥20,000。”',
    '“半年内买新微单和大师镜头，预算¥12,000，不动底线应急金。”',
  ];

  return (
    <div className="flex-1 flex flex-col justify-between relative w-full pt-2 pb-safe px-4 overflow-y-auto no-scrollbar">
      <div className="flex flex-col w-full pt-1 gap-3">
        {/* Card 1: 已记录原话 */}
        <section className="bg-white rounded-xl p-3.5 border border-[#E5E8EB] shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-[#0F6B6D]">
              <span
                className="material-symbols-outlined text-[16px]"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                format_quote
              </span>
              <span className="text-[13px] font-semibold tracking-tight text-[#1F2329]">
                已记录原话
              </span>
            </div>
            <button
              onClick={() => {
                setIsRecording(!isRecording);
                if (!isRecording) {
                  setTimeout(() => {
                    setIsRecording(false);
                  }, 2000);
                }
              }}
              className="flex items-center gap-1 text-[#646A73] hover:text-[#0F6B6D] transition-colors cursor-pointer text-left"
              title="点击模拟语音重录"
            >
              <span className={`material-symbols-outlined text-[14px] ${isRecording ? 'text-red-500 animate-pulse' : ''}`}>
                {isRecording ? 'graphic_eq' : 'mic'}
              </span>
              <span className="text-[12px] leading-tight">
                {isRecording ? '正在聆听录音...' : '2026年9月21日 · 语音/文字输入'}
              </span>
            </button>
          </div>

          <div className="bg-[#F5F7F8] p-2.5 rounded-lg border border-[#E5E8EB] flex flex-col gap-1.5">
            <label className="block">
              <span className="sr-only">目标描述</span>
              <textarea
                value={customQuote}
                onChange={(event) => {
                  setCustomQuote(event.target.value);
                  setAnalysisError(null);
                  setAnalysisComplete(false);
                }}
                maxLength={500}
                rows={3}
                aria-label="目标描述"
                placeholder="例如：我想三个月后去日本旅行，预算 8000 元，不能动应急金。"
                className="w-full resize-y bg-transparent text-[14px] leading-relaxed text-[#1F2329] font-medium focus:outline-none"
              />
            </label>
            {/* Quick preset switches */}
            <div className="flex flex-wrap gap-1.5 pt-1 border-t border-[#E5E8EB]/70">
              <span className="text-[11px] text-[#8F959E] self-center">试听不同原话:</span>
              {samplePresets.map((preset, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    setCustomQuote(preset);
                    if (idx === 1) {
                      setTargetAmount(18000);
                      onUpdateGoal({ title: '冰岛极光', targetAmount: 18000 });
                    } else if (idx === 2) {
                      setTargetAmount(12000);
                      onUpdateGoal({ title: '摄影器材', targetAmount: 12000 });
                    } else {
                      setTargetAmount(8000);
                      onUpdateGoal({ title: '日本旅行', targetAmount: 8000 });
                    }
                  }}
                  className={`text-[11px] px-2 py-0.5 rounded-full transition-colors ${
                    customQuote === preset
                      ? 'bg-[#0F6B6D] text-white font-medium'
                      : 'bg-white border border-[#E5E8EB] text-[#646A73] hover:border-[#0F6B6D]'
                  }`}
                >
                  示例 {idx + 1}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-1.5 pt-2 border-t border-[#E5E8EB]/70">
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={isAnalyzing}
                className="w-full min-h-[40px] rounded-lg bg-[#0F6B6D] hover:bg-[#084C4E] disabled:opacity-60 text-white text-[12px] font-semibold flex items-center justify-center gap-1.5 transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">
                  {isAnalyzing ? 'progress_activity' : 'auto_awesome'}
                </span>
                {isAnalyzing ? 'DeepSeek 正在解析…' : 'DeepSeek 智能解析'}
              </button>
              {analysisError && (
                <p role="alert" className="text-[11px] leading-relaxed text-red-600">
                  {analysisError}
                </p>
              )}
              {analysisComplete && (
                <p role="status" className="text-[11px] leading-relaxed text-[#2E7D5B]">
                  已生成草案并展开可修改字段。请核对识别结果，再决定是否继续。
                </p>
              )}
              <p className="text-[10px] leading-relaxed text-[#8F959E]">
                点击解析会将这段目标描述发送给 DeepSeek；请勿输入真实账号、银行卡或身份证信息。
              </p>
            </div>
          </div>
        </section>

        {/* Card 2: NOVA 的理解 */}
        <section className="bg-white rounded-xl p-4 border border-[#E5E8EB] shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[15px] font-semibold leading-tight text-[#1F2329] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[18px] text-[#0F6B6D]">
                psychology
              </span>
              <span>NOVA 的理解：</span>
            </h2>
            <span className="text-[12px] px-2.5 py-0.5 rounded-full bg-[#EBF7F2] text-[#2E7D5B] font-medium flex items-center gap-1">
              <span
                className="material-symbols-outlined text-[13px]"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                check_circle
              </span>
              解析完成
            </span>
          </div>

          <div className="relative pl-4 space-y-3">
            {/* Timeline track line */}
            <div className="absolute left-[5px] top-2 bottom-3 w-[1.5px] bg-[#E5E8EB]"></div>

            {/* Node 1: 目标金额 */}
            <div className="relative flex items-start gap-2.5">
              <div className="w-2.5 h-2.5 rounded-full bg-[#0F6B6D] mt-1 ring-2 ring-white shrink-0 -ml-[18px]"></div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-[13px] text-[#646A73]">目标金额</span>
                  <span className="text-[20px] font-bold leading-tight text-[#1F2329] font-editorial">
                    ¥{targetAmount.toLocaleString()}
                  </span>
                </div>
                <p className="text-[12px] leading-tight text-[#8F959E]">旅行专项预算</p>
              </div>
            </div>

            {/* Node 2: 目标日期 */}
            <div className="relative flex items-start gap-2.5">
              <div className="w-2.5 h-2.5 rounded-full bg-[#0F6B6D] mt-1 ring-2 ring-white shrink-0 -ml-[18px]"></div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-[13px] text-[#646A73]">目标日期</span>
                  <span className="text-[14px] text-[#1F2329] font-semibold">
                    {targetDate}
                  </span>
                </div>
                <p className="text-[12px] leading-tight text-[#8F959E]">目标日期按演示时钟计算</p>
              </div>
            </div>

            {/* Node 3: 受保护资金 */}
            <div className="relative flex items-start gap-2.5">
              <div className="w-2.5 h-2.5 rounded-full bg-[#D48806] mt-1 ring-2 ring-white shrink-0 -ml-[18px]"></div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-[13px] text-[#646A73]">受保护资金</span>
                  <span className="text-[14px] text-[#1F2329] font-semibold">
                    ¥{emergencyFund.toLocaleString()}{' '}
                    <span className="text-[#D48806] text-[13px] font-normal">
                      (应急金)
                    </span>
                  </span>
                </div>
                <p className="text-[12px] leading-tight text-[#8F959E]">不纳入本次计划</p>
              </div>
            </div>

            {/* Node 4: 可调整范围 */}
            <div className="relative flex items-start gap-2.5">
              <div className="w-2.5 h-2.5 rounded-full bg-[#646A73] mt-1 ring-2 ring-white shrink-0 -ml-[18px]"></div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-[13px] text-[#646A73]">可调整范围</span>
                  <span className="text-[13px] text-[#1F2329] font-medium">
                    允许 {goal.flexibilityWeeks} 周浮动
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Edit confirmation hint */}
          <button
            onClick={() => setIsEditing(!isEditing)}
            className="w-full mt-3 pt-2 flex items-center justify-between text-[#646A73] hover:text-[#0F6B6D] bg-[#F5F7F8] rounded-lg px-3 py-2 border border-[#E5E8EB] transition-colors cursor-pointer text-left"
          >
            <span className="text-[12px] text-[#646A73]">
              这些理解对吗？若有偏差可直接修正。
            </span>
            <span className="material-symbols-outlined text-[16px] text-[#0F6B6D]">
              tune
            </span>
          </button>

          {/* Inline Edit Panel if toggled */}
          {isEditing && (
            <div className="mt-3 p-3 bg-white rounded-lg border border-[#0F6B6D]/30 space-y-2.5 animate-fadeIn">
              <div className="flex items-center justify-between text-[12px] font-semibold text-[#1F2329]">
                <span>微调 NOVA 解析参数</span>
                <span className="text-[11px] text-[#0F6B6D]">实时生效</span>
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] text-[#646A73] block">目标金额 (元):</label>
                <input
                  type="number"
                  value={targetAmount}
                  onChange={(e) => setTargetAmount(Number(e.target.value))}
                  className="w-full text-[13px] p-2 bg-[#F5F7F8] border border-[#E5E8EB] rounded-lg focus:outline-none focus:border-[#0F6B6D]"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] text-[#646A73] block">应急金保护线 (元):</label>
                <input
                  type="number"
                  value={emergencyFund}
                  onChange={(e) => setEmergencyFund(Number(e.target.value))}
                  className="w-full text-[13px] p-2 bg-[#F5F7F8] border border-[#E5E8EB] rounded-lg focus:outline-none focus:border-[#0F6B6D]"
                />
              </div>
              <button
                onClick={handleSaveSettings}
                className="w-full py-2 bg-[#0F6B6D] text-white rounded-lg text-[12px] font-semibold hover:bg-[#084C4E] transition-colors"
              >
                保存并更新
              </button>
            </div>
          )}
        </section>
      </div>

      {/* Footer Area */}
      <div className="flex flex-col gap-2.5 pt-4 pb-2">
        <button
          onClick={() => onNext({ targetAmount, targetDate, emergencyFundProtected: emergencyFund, quote: customQuote })}
          type="button"
          id="cta-feasibility"
          className="w-full h-11 min-h-[44px] bg-[#0F6B6D] hover:bg-[#084C4E] active:scale-[0.99] text-white rounded-xl text-[14px] font-semibold flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer"
        >
          <span>下一步：查看可行性</span>
          <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
        </button>

        <div className="grid grid-cols-2 gap-2.5">
          <button
            onClick={() => setIsEditing(!isEditing)}
            type="button"
            id="cta-edit"
            className="h-11 min-h-[44px] rounded-xl bg-white border border-[#E5E8EB] text-[#1F2329] text-[13px] font-medium flex items-center justify-center gap-1 hover:bg-[#F5F7F8] active:scale-[0.99] transition-all cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px] text-[#646A73]">
              edit_note
            </span>
            <span>修改设定</span>
          </button>

          <button
            onClick={() => {
              alert('已开启补充信息模式：可记录例如「机票已出/不可退」、「可接受青年旅舍」等个性化边界。');
            }}
            type="button"
            id="cta-more"
            className="h-11 min-h-[44px] rounded-xl bg-white border border-[#E5E8EB] text-[#1F2329] text-[13px] font-medium flex items-center justify-center gap-1 hover:bg-[#F5F7F8] active:scale-[0.99] transition-all cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px] text-[#646A73]">
              add_circle
            </span>
            <span>补充更多信息</span>
          </button>
        </div>

        <div className="flex items-center justify-center gap-1 text-[#8F959E] pt-0.5">
          <span className="material-symbols-outlined text-[14px]">lock</span>
          <p className="text-[12px] tracking-tight">创建后可随时调整，不会自动划扣资金</p>
        </div>
      </div>
    </div>
  );
};
