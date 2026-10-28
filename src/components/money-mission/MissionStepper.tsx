import type { MoneyMissionReadModel } from '../../types';

export type MissionStage = MoneyMissionReadModel['currentStage'];
export const missionStages: { id: MissionStage; label: string; title: string; description: string }[] = [
  { id: 'goal', label: '目标', title: '描述旅行目标', description: '确认旅行时间、预算和需要保护的资金。' },
  { id: 'data', label: '数据', title: '连接或导入数据', description: '连接模拟来源或导入账单，再核对覆盖范围和待确认项目。' },
  { id: 'bill', label: '账单', title: '查看账单分析', description: '了解与旅行目标有关的支出变化，核对结论与来源。' },
  { id: 'subscription', label: '订阅', title: '核对订阅处理', description: '确认可能的订阅，选择保留、提醒或准备模拟取消。' },
  { id: 'plan', label: '方案', title: '比较目标方案', description: '根据已核验数据比较可行节奏，再选择适合你的方案。' },
  { id: 'transfer', label: '转账', title: '准备转账安排', description: '先查看准确安排和影响，确认后才能执行模拟操作。' },
  { id: 'monitoring', label: '守护', title: '查看持续守护', description: '查看已确认的安排与处理结果，出现需要处理的变化时再提醒。' },
];

export function MissionStepper({ model, selected, onSelect }: {
  model: MoneyMissionReadModel; selected: MissionStage; onSelect: (stage: MissionStage) => void;
}) {
  return <nav aria-label="Money Mission 进度" className="rounded-2xl border border-[#E5E8EB] bg-white p-3">
    <p className="px-2 pb-2 text-[13px] font-semibold text-[#1F2329]">一步步准备旅行金</p>
    <ol className="flex flex-col gap-1">
      {missionStages.map((stage, index) => {
        const current = stage.id === model.currentStage;
        const completed = model.completedStages.includes(stage.id);
        const status = current ? '当前' : completed ? '已完成 · 可回看' : '待开始';
        return <li key={stage.id}><button type="button" disabled={!current && !completed}
          aria-current={current ? 'step' : undefined} aria-pressed={selected === stage.id}
          onClick={() => onSelect(stage.id)}
          className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F6B6D] ${selected === stage.id ? 'bg-[#E6F2F2] text-[#0F6B6D]' : 'text-[#5A616B]'} disabled:opacity-70`}>
          <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-current text-[11px]">{completed ? '✓' : index + 1}</span>
          <span className="flex flex-1 flex-wrap items-center justify-between gap-x-2 gap-y-1"><span className="font-semibold">{stage.label}</span><span className="text-[11px]">{status}</span></span>
        </button></li>;
      })}
    </ol>
  </nav>;
}
