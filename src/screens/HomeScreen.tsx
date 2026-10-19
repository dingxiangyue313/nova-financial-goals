import React from 'react';
import { Goal } from '../types';
import { SnapshotSchema, type Snapshot } from '../../shared/contracts';
import { normalizeUiCard } from '../../shared/generative';
import { readableDate, shortDate } from '../api';

interface HomeScreenProps {
  goal: Goal;
  snapshot: Snapshot;
  hasImpactPending: boolean;
  onNavigateToFeasibility: () => void;
  onNavigateToImpact: () => void;
  onNavigateToCreate: () => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  goal,
  snapshot,
  hasImpactPending,
  onNavigateToFeasibility,
  onNavigateToImpact,
  onNavigateToCreate,
}) => {
  const percentage = goal.progressPercent.toFixed(1);
  const cards = SnapshotSchema.shape.cards.parse(snapshot.cards).map(card => normalizeUiCard(card));
  const insight = cards.find(card => card.type === 'goal_feasibility_card');
  const impact = snapshot.pendingImpact;
  const connectedSources = snapshot.dataConnections.filter(item => item.status === 'connected');
  const failedSources = snapshot.dataConnections.filter(item => item.status === 'error');
  const lastSyncedAt = connectedSources.map(item => item.lastSyncedAt).filter(Boolean).sort().at(-1);

  return (
    <div className="flex flex-col w-full gap-3.5 select-none py-2 px-4">
      {/* Greeting & Subhead */}
      <section className="flex flex-col gap-0.5">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-medium text-[#5A616B]">
            {readableDate(snapshot.clock)} · 演示日期
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#E6F2F2] text-[#0F6B6D] text-[11px] font-semibold">
            <span className="material-symbols-outlined text-[13px]">verified</span>
            {connectedSources.length ? '智能守护中' : '等待连接数据'}
          </span>
        </div>
        <h1 className="text-[20px] font-bold text-[#1F2329] tracking-tight">
          早上好，Alex
        </h1>
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-medium text-[#5A616B]">我的目标</span>
          <button
            onClick={onNavigateToCreate}
            className="text-[12px] text-[#0F6B6D] hover:underline flex items-center gap-0.5 font-medium cursor-pointer"
          >
            <span className="material-symbols-outlined text-[14px]">add</span>
            新建目标
          </button>
        </div>
      </section>

      <div className="flex items-center gap-1.5 rounded-lg border border-[#E5E8EB] bg-white px-3 py-2 text-[11px] text-[#5A616B]">
        <span className="material-symbols-outlined text-[15px] text-[#0F6B6D]">sync</span>
        {connectedSources.length
          ? `已连接 ${connectedSources.length} 个模拟来源 · 数据更新于 ${lastSyncedAt ? new Date(lastSyncedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '等待首次同步'}`
          : '尚未连接流水 · 当前结果仅为演示估算'}
      </div>

      {failedSources.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-[#F2D5A7] bg-[#FFF9ED] px-3 py-2 text-[11px] text-[#76551D]">
          <span className="material-symbols-outlined mt-0.5 text-[15px]">cloud_off</span>
          <div>
            <p className="font-semibold">{connectedSources.length ? '部分数据待更新' : '守护结论暂缓更新'}</p>
            <p>{failedSources.map(item => item.label).join('、')}暂时未更新；NOVA 不会基于缺失数据给出新的即时风险结论。</p>
          </div>
        </div>
      )}

      {/* Proactive Alert Banner for Impact (if event is active) */}
      {hasImpactPending && (
        <section
          onClick={onNavigateToImpact}
          className="bg-amber-50/90 border border-amber-200/80 rounded-xl p-3 flex items-center justify-between cursor-pointer hover:bg-amber-100/80 transition-all shadow-sm"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0"></span>
            <div className="flex flex-col min-w-0">
              <span className="text-[13px] font-bold text-amber-900 truncate">
                NOVA 洞察：{impact?.title}支出 ¥{((impact?.expenseCents || 0) / 100).toLocaleString()}
              </span>
              <span className="text-[11px] text-amber-700 truncate">
                储蓄节奏受扰动，点击查看调整方案
              </span>
            </div>
          </div>
          <span className="material-symbols-outlined text-amber-800 text-[18px] shrink-0 ml-2">
            chevron_right
          </span>
        </section>
      )}

      {/* Goal Hero Card (日本旅行) */}
      <section className="flex flex-col bg-white rounded-xl border border-[#E5E8EB] p-3.5 shadow-sm gap-2.5">
        {/* Japan photo integrated */}
        <div className="relative w-full h-20 rounded-lg overflow-hidden bg-slate-200">
          <img
            alt={goal.title}
            className="w-full h-full object-cover object-center"
            src={goal.imageUrl}
            onError={(e) => {
              // High-res scenic winter Japan fallback
              e.currentTarget.src =
                'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=800&q=80';
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent"></div>

          <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#E6F2F2] text-[#276B4E] text-[11px] font-semibold shadow-sm backdrop-blur-xs">
            <span className="material-symbols-outlined text-[14px]">
              {goal.status === 'delayed' ? 'schedule' : 'check_circle'}
            </span>
            <span>
              {snapshot.assessment.status === 'insufficient_data' ? '数据不足' : snapshot.assessment.status === 'infeasible' ? '需调整目标' : goal.status === 'delayed' ? `可能延期 ${goal.delayDays} 天` : snapshot.goal.status === 'draft' ? '待确认计划' : '进度正常'}
            </span>
          </div>

          <div className="absolute bottom-1.5 left-2 right-2 flex justify-between items-baseline text-white">
            <span className="font-bold text-[15px] drop-shadow-sm">{goal.title}</span>
            <span className="text-[11px] text-white/90">
              目标日 {shortDate(goal.targetDate)}
            </span>
          </div>
        </div>

        {/* Financial Metrics */}
        <div className="flex items-baseline justify-between pt-0.5">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[12px] text-[#5A616B]">已存</span>
            <span className="text-[22px] font-bold text-[#1F2329] tracking-tight font-editorial">
              ¥{goal.currentAmount.toLocaleString()}
            </span>
            <span className="text-[13px] text-[#5A616B]">
              / ¥{goal.targetAmount.toLocaleString()}
            </span>
          </div>
          <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#E6F2F2] text-[#0F6B6D] text-[12px] font-semibold">
            <span className="material-symbols-outlined text-[14px]">trending_up</span>
            <span>已完成 {percentage}%</span>
          </div>
        </div>

        {/* Progress track / N-track element */}
        <div className="w-full bg-[#F5F7F8] border border-[#E5E8EB] rounded-lg p-2.5">
          <div className="relative w-full h-[52px]">
            <svg
              className="w-full h-full"
              fill="none"
              preserveAspectRatio="none"
              viewBox="0 0 310 52"
            >
              <path
                d="M 20 40 L 155 12 L 290 40"
                stroke="#E5E8EB"
                strokeDasharray="3 3"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2.5"
              ></path>
              <path
                d="M 20 40 L 80 27"
                stroke="#0F6B6D"
                strokeLinecap="round"
                strokeWidth="3.5"
              ></path>
            </svg>
            <div className="absolute left-1 bottom-0 flex flex-col items-center">
              <div className="w-3.5 h-3.5 rounded-full bg-[#0F6B6D] border-2 border-white shadow-sm"></div>
              <span className="text-[10px] text-[#0F6B6D] font-bold mt-0.5">
                ¥{goal.currentAmount.toLocaleString()}
              </span>
            </div>
            <div className="absolute left-1/2 -translate-x-1/2 top-0 flex flex-col items-center">
              <div className="w-3 h-3 rounded-full bg-[#E5E8EB] border border-white"></div>
              <span className="text-[10px] text-[#5A616B] mt-0.5">推进中</span>
            </div>
            <div className="absolute right-1 bottom-0 flex flex-col items-center">
              <div className="w-3.5 h-3.5 rounded-full bg-[#276B4E] border-2 border-white shadow-sm flex items-center justify-center">
                <span className="material-symbols-outlined text-white text-[8px]">flag</span>
              </div>
              <span className="text-[10px] text-[#276B4E] font-bold mt-0.5">
                ¥{goal.targetAmount.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* Narrative projection & recommendation */}
        <div className="flex flex-col gap-1 bg-[#F5F7F8] border border-[#E5E8EB] rounded-lg px-3 py-2 text-[12px]">
          <div className="flex items-center gap-1.5 text-[#1F2329]">
            <span className="material-symbols-outlined text-[#0F6B6D] text-[15px]">
              calendar_month
            </span>
            <span className="font-medium">
              {insight?.body || '正在评估目标进度'} {snapshot.assessment.projectedDate ? `预计 ${shortDate(snapshot.assessment.projectedDate)}` : ''}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[#5A616B]">
            <span className="material-symbols-outlined text-[#A45F00] text-[15px]">
              lightbulb
            </span>
            <span>
              本月建议存入{' '}
              <strong className="text-[#1F2329] font-semibold">
                ¥{goal.monthlySavings.toLocaleString()}
              </strong>
            </span>
          </div>
        </div>

        {/* CTA button */}
        <button
          onClick={onNavigateToFeasibility}
          className="w-full h-11 min-h-[44px] rounded-lg bg-[#0F6B6D] hover:bg-[#084C4E] active:scale-[0.99] text-white flex items-center justify-center gap-1.5 font-semibold text-[14px] transition-colors shadow-sm cursor-pointer"
          id="btn-adjust-plan"
        >
          <span className="material-symbols-outlined text-[18px]">visibility</span>
          <span>查看计划</span>
        </button>
      </section>

    </div>
  );
};
