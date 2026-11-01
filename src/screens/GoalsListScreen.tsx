import type { Goal } from '../../shared/contracts';

interface GoalsListScreenProps {
  goals: Goal[];
  primaryGoalId: string | null;
  emergencyCents: number;
  hasImpactPending: boolean;
  onSelectGoal: (id: string) => void | Promise<void>;
  onNavigateToCreate: () => void;
  onNavigateToImpact: () => void;
}

const yuan = (cents: number) => `¥${(cents / 100).toLocaleString('zh-CN')}`;

export function GoalsListScreen({ goals, primaryGoalId, emergencyCents, hasImpactPending,
  onSelectGoal, onNavigateToCreate, onNavigateToImpact }: GoalsListScreenProps) {
  return <div className="flex-1 space-y-3.5 overflow-y-auto px-4 pb-safe pt-2 no-scrollbar">
    <div className="flex items-center justify-between"><div><h2 className="text-[18px] font-bold">我的计划</h2><p className="text-[12px] text-[#5A616B]">首页展示你指定的主目标，其他计划仍持续守护</p></div><button onClick={onNavigateToCreate} className="rounded-lg bg-[#0F6B6D] px-3 py-2 text-[12px] font-semibold text-white">＋ 新建</button></div>
    <div className="flex items-center justify-between rounded-xl border border-[#A9D0C0] bg-[#EBF7F2] p-3.5"><div><p className="text-[13px] font-bold">核心应急金</p><p className="text-[11px] text-[#5A616B]">所有目标共同遵守，不参与计划投入</p></div><strong className="text-[#276B4E]">{yuan(emergencyCents)}</strong></div>
    {goals.length === 0 && <div className="rounded-2xl border border-dashed border-[#B8CDCD] bg-white p-8 text-center"><h3 className="font-bold">还没有计划</h3><p className="mt-1 text-[12px] text-[#5A616B]">告诉 NOVA 你想完成什么，它会先补齐信息再试算。</p><button onClick={onNavigateToCreate} className="mt-4 rounded-xl bg-[#0F6B6D] px-4 py-2.5 text-[12px] font-semibold text-white">创建第一个计划</button></div>}
    {goals.map(goal => {
      const progress = goal.targetCents ? Math.min(100, goal.savedCents / goal.targetCents * 100) : 0;
      const primary = goal.id === primaryGoalId;
      return <article key={goal.id} className={`rounded-xl border bg-white p-3.5 shadow-sm ${primary ? 'border-[#0F6B6D]' : 'border-[#E5E8EB]'}`}>
        <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h3 className="text-[15px] font-bold">{goal.title}</h3>{primary && <span className="rounded-full bg-[#E6F2F2] px-2 py-0.5 text-[10px] font-semibold text-[#0F6B6D]">首页主目标</span>}</div><p className="mt-1 text-[11px] text-[#5A616B]">目标日 {goal.targetDate} · {goal.status === 'active' ? '推进中' : goal.status === 'paused' ? '已暂停' : goal.status === 'achieved' ? '已完成' : '待启用'}</p></div><strong className="text-[13px]">{yuan(goal.savedCents)} / {yuan(goal.targetCents)}</strong></div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#F0F2F5]"><div className="h-full rounded-full bg-[#0F6B6D]" style={{ width: `${progress}%` }}/></div>
        <div className="mt-3 flex gap-2"><button onClick={() => void onSelectGoal(goal.id)} className={`flex-1 rounded-lg px-3 py-2 text-[11px] font-semibold ${primary ? 'bg-[#F2FAFA] text-[#0F6B6D]' : 'border border-[#0F6B6D] text-[#0F6B6D]'}`}>查看目标详情</button>{primary && hasImpactPending && <button onClick={onNavigateToImpact} className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800">查看影响</button>}</div>
      </article>;
    })}
  </div>;
}

