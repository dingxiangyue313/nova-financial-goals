import type { MissionStage } from '../../../shared/money-mission';

export const MISSION_STAGES: { id: MissionStage; label: string }[] = [
  { id: 'goal', label: '目标' },
  { id: 'data', label: '数据' },
  { id: 'bills', label: '账单' },
  { id: 'subscription', label: '订阅' },
  { id: 'planning', label: '计划' },
  { id: 'transfer', label: '转账' },
  { id: 'monitoring', label: '监控' }
];

export function MissionStepper({
  current,
  completed,
  onSelect
}: {
  current: MissionStage;
  completed: MissionStage[];
  onSelect: (stage: MissionStage) => void;
}) {
  return (
    <nav aria-label="Money Mission 进度">
      <ol className="mission-stepper">
        {MISSION_STAGES.map((stage, index) => {
          const done = completed.includes(stage.id);
          const active = stage.id === current;
          return (
            <li key={stage.id} aria-current={active ? 'step' : undefined}>
              <button type="button" aria-label={stage.label} className={active ? 'is-current' : done ? 'is-done' : ''} onClick={() => onSelect(stage.id)}>
                <span className="mission-step-index">{index + 1}</span>
                {stage.label}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
