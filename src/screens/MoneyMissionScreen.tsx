import { useState } from 'react';
import type { MoneyMissionReadModel } from '../types';
import { MissionStepper, missionStages, type MissionStage } from '../components/money-mission/MissionStepper';
import { MissionState } from '../components/money-mission/MissionState';

export function MoneyMissionScreen({ model, loading = false, error = null, compact = false, onRefresh, onNavigate }: {
  model: MoneyMissionReadModel | null; loading?: boolean; error?: string | null; compact?: boolean;
  onRefresh: () => void; onNavigate: (stage: MissionStage) => void;
}) {
  const [viewedStage, setViewedStage] = useState<MissionStage | null>(null);
  const selected = model && viewedStage && model.completedStages.includes(viewedStage) ? viewedStage : model?.currentStage;
  const stage = missionStages.find(item => item.id === selected);
  return <section aria-labelledby="money-mission-title" className="w-full p-4 text-[#1F2329]">
    <header className="mb-4">
      <p className="mb-1 text-[11px] font-semibold text-[#0F6B6D]">模拟财务任务 · 每一步由你决定</p>
      <h1 id="money-mission-title" className="text-[20px] font-bold tracking-tight">日本旅行 Money Mission</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-[#5A616B]">从看懂账单，到准备旅行金，再到持续守护。</p>
    </header>
    {loading ? <MissionState kind="loading" message="正在读取 Money Mission…" />
      : error ? <MissionState kind="error" message={error} onRetry={onRefresh} />
      : !model ? <MissionState kind="empty" message="还没有任务数据，请重新读取任务。" onRetry={onRefresh} />
      : <div data-testid="money-mission-layout" className={`grid min-w-0 grid-cols-1 gap-4 ${compact ? '' : 'lg:grid-cols-[minmax(0,32fr)_minmax(0,68fr)]'}`}>
        <aside className="min-w-0">
          <MissionStepper model={model} selected={selected!} onSelect={setViewedStage} />
          <p className="mt-3 px-2 text-[11px] leading-relaxed text-[#5A616B]">数据截至 {model.dataAsOf}。已完成阶段可以回看；新的操作仍需核对和确认。</p>
        </aside>
        <section aria-label="当前任务" className="min-w-0 rounded-2xl border border-[#E5E8EB] bg-white p-5">
          <p className="text-[11px] font-semibold text-[#0F6B6D]">{selected === model.currentStage ? '当前阶段' : '已完成阶段'}</p>
          <h2 className="mt-2 text-[18px] font-bold">{stage?.title}</h2>
          <p className="mt-3 text-[13px] leading-relaxed text-[#5A616B]">{stage?.description}</p>
          <div className="mt-4 space-y-3">
            {!model.goalId && <MissionState kind="empty" message="还没有任务数据，先描述你的旅行目标。" />}
            {selected !== model.currentStage && <MissionState kind="completed" message="此阶段已完成，可随时回看。" />}
            {selected === model.currentStage && <p className="text-[13px] leading-relaxed text-[#5A616B]">可在 NOVA 工作台继续当前任务。这里保留你的任务进度。</p>}
            {model.limitations.map((limitation, index) => <p key={index} className="text-[12px] leading-relaxed text-[#5A616B]">{limitation}</p>)}
          </div>
          {selected === model.currentStage && model.nextAction
            ? <button type="button" onClick={() => onNavigate(model.currentStage)} className="mt-5 min-h-11 w-full rounded-xl bg-[#0F6B6D] px-4 py-3 text-[13px] font-semibold text-white hover:bg-[#084C4E] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F6B6D]">{model.nextAction.label}</button>
            : <button type="button" onClick={() => setViewedStage(null)} className="mt-5 min-h-11 rounded-xl border border-[#B9D9D8] px-4 py-3 text-[13px] font-semibold text-[#0F6B6D]">返回当前阶段</button>}
          <button type="button" onClick={onRefresh} className="mt-2 min-h-11 w-full rounded-xl px-4 py-2 text-[12px] text-[#0F6B6D] focus-visible:outline-2 focus-visible:outline-offset-2">刷新任务进度</button>
        </section>
      </div>}
  </section>;
}
