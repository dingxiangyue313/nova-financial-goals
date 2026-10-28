import React, { useEffect, useState } from 'react';
import { Goal } from '../types';
import { SnapshotSchema, type Snapshot } from '../../shared/contracts';
import { normalizeUiCard } from '../../shared/generative';
import { shortDate } from '../api';

const formatCurrentDate = (date: Date) => new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
}).format(date);

const formatCurrentDateTime = (date: Date) => new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
}).format(date);

interface HomeScreenProps {
  goal: Goal;
  snapshot: Snapshot;
  hasImpactPending: boolean;
  onNavigateToFeasibility: () => void;
  onNavigateToImpact: () => void;
  onNavigateToCreate: () => void;
  onNavigateToMoneyMission: () => void;
  onNavigateToServices: () => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  goal,
  snapshot,
  hasImpactPending,
  onNavigateToFeasibility,
  onNavigateToImpact,
  onNavigateToCreate,
  onNavigateToMoneyMission,
  onNavigateToServices,
}) => {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const percentage = goal.progressPercent.toFixed(1);
  const brief = snapshot.moneyMission?.billBrief;
  const importedRows=snapshot.statementImportBatches.filter(b=>b.status==='committed').reduce((n,b)=>n+b.importedCount,0);
  const cards = SnapshotSchema.shape.cards.parse(snapshot.cards).map(card => normalizeUiCard(card));
  const insight = cards.find(card => card.type === 'goal_feasibility_card');
  const impact = snapshot.pendingImpact;
  const connectedSources = snapshot.dataConnections.filter(item => item.status === 'connected');
  const failedSources = snapshot.dataConnections.filter(item => item.status === 'error');

  return (
    <div className="flex flex-col w-full gap-3.5 select-none py-2 px-4">
      {/* Greeting & Subhead */}
      <section className="flex flex-col gap-0.5">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-medium text-[#5A616B]">
            {snapshot.accountSnapshots.length ? `${snapshot.clock} · 模拟今日` : `${formatCurrentDate(now)} · 今日`}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#E6F2F2] text-[#0F6B6D] text-[11px] font-semibold">
            <span className="material-symbols-outlined text-[13px]">verified</span>
            {connectedSources.length ? '智能守护中' : importedRows ? '模拟数据已就绪' : '等待连接数据'}
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

      {brief && <button type="button" aria-label="查看账单与消费" onClick={onNavigateToMoneyMission} className="rounded-2xl bg-[#0F6B6D] text-white p-4 text-left shadow-md"><span className="text-[11px]">消费趋势 · 合成账单 · 截至 {brief.dataAsOf}</span><strong className="block text-[20px] mt-1">{Number(brief.periodStart.slice(5,7))}月花了 ¥{(brief.totalExpenseCents/100).toLocaleString('zh-CN')}</strong><span className="grid grid-cols-3 gap-2 mt-3"><span className="rounded-xl bg-white/15 p-2 text-[10px]">餐饮变化<strong className="block text-[12px] whitespace-nowrap">¥{((brief.changes.find(c=>c.category==='dining')?.increaseCents??0)/100).toLocaleString('zh-CN')}</strong></span><span className="rounded-xl bg-white/15 p-2 text-[10px]">即将续费<strong className="block text-[13px]">¥{((brief.subscriptionCandidates[0]?.monthlyCents??0)/100).toLocaleString('zh-CN')}</strong></span><span className="rounded-xl bg-white/15 p-2 text-[10px]">工资前低谷<strong className="block text-[13px]">{snapshot.moneyMission?.forecast?.minimumBalanceCents==null?'待核对':'¥'+(snapshot.moneyMission.forecast.minimumBalanceCents/100).toLocaleString('zh-CN')}</strong></span></span><span className="block text-xs mt-3">处理续费，核对并安排工资到账后转入 →</span></button>}
      {!brief&&<button type="button" aria-label="查看账单与消费" onClick={onNavigateToMoneyMission} className="rounded-2xl bg-[#0F6B6D] text-white p-4 text-left"><strong className="block text-lg">账单与订阅</strong><span className="block mt-2 text-xs">连接模拟来源或导入账单后，查看消费趋势与续费提醒 →</span></button>}
      <div className="flex items-center gap-1.5 rounded-lg border border-[#E5E8EB] bg-white px-3 py-2 text-[11px] text-[#5A616B]">
        <span className="material-symbols-outlined text-[15px] text-[#0F6B6D]">sync</span>
        {connectedSources.length
          ? `已连接 ${connectedSources.length} 个模拟来源 · 财务数据截至 ${snapshot.finance.updatedAt}`
          : importedRows ? `已导入 ${importedRows} 条历史证据 · 余额单独核对` : '尚未连接流水 · 当前结果仅为演示估算'}
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
            src={snapshot.accountSnapshots.length ? '/japan-trip.jpg' : goal.imageUrl}
            onError={(e) => {
              // High-res scenic winter Japan fallback
              e.currentTarget.src =
                '/japan-trip.jpg';
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
        <div className="flex items-baseline justify-between gap-2 pt-0.5">
          <div className="flex items-baseline gap-1 whitespace-nowrap">
            <span className="text-[12px] text-[#5A616B]">已存</span>
            <span className="text-[22px] font-bold text-[#1F2329] tracking-tight font-editorial">
              ¥{goal.currentAmount.toLocaleString()}
            </span>
            <span className="text-[13px] text-[#5A616B]">
              / ¥{goal.targetAmount.toLocaleString()}
            </span>
          </div>
          <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#E6F2F2] text-[#0F6B6D] text-[10px] whitespace-nowrap font-semibold">
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
      <button type="button" className="mission-secondary" onClick={onNavigateToServices}>金融任务：转账、AA、理财、卡片与旅行预订</button>
    </div>
  );
};
