import type { AgentTask } from '../shared/contracts.ts';

type GoalContext = Pick<AgentTask, 'facts' | 'constraints'>;

export function expiredGoalQuestion(task: GoalContext, clock: string): string | null {
  const deadline = task.constraints.latestAllowedDate ?? task.facts.originalTargetDate;
  if (!deadline || deadline >= clock) return null;
  return `目标日期 ${deadline} 已早于当前模拟日期 ${clock}，无法从现在开始试算。你希望改到哪一天？已填写的预算和已存金额会保留。`;
}

export function safeGoalQuestion(task: GoalContext, clock: string, proposed: string): string {
  const expired = expiredGoalQuestion(task, clock);
  if (expired) return expired;
  if (!/¥|\d{3,}/.test(proposed)) return proposed;
  // Do not repeat unverified model numbers, but retain the question's field.
  if (/日期|时间|哪天|哪一年|几月|截止|完成日|年.*月/.test(proposed)) return '你希望在哪个具体日期完成目标？请提供年、月、日。';
  if (/已存|存下|积蓄/.test(proposed)) return '目前为这个目标已经存了多少？尚未开始存可以回复零元。';
  if (/每月|月存|月投入/.test(proposed)) return '每月最多愿意为这个目标投入多少？';
  if (/应急|保护/.test(proposed)) return '希望保留多少不能动用的保护资金？';
  if (/预算|总额|总共/.test(proposed)) return '这个目标的总预算是多少？';
  return '希望优先保持完成日期，还是保持每月投入上限？';
}
