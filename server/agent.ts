import { z } from 'zod';
import { addDays } from './domain.ts';
import { AgentIntentSchema, UiCardSchema, type AgentIntent, type UiCard } from '../shared/contracts.ts';
import { containsPromptInjection } from './security.ts';
import { requestDeepSeekJson } from './deepseek-client.ts';

const ParsedGoal = z.object({
  title: z.string().max(60).nullable().optional(),
  targetAmount: z.number().positive().max(10_000_000).nullable().optional(),
  targetDate: z.string().max(40).nullable().optional(),
  monthlySavings: z.number().nonnegative().max(10_000_000).nullable().optional(),
  emergencyFundProtected: z.number().nonnegative().max(10_000_000).nullable().optional(),
  flexibilityWeeks: z.number().int().nonnegative().max(52).nullable().optional(),
});
export type ParsedGoalDraft = z.infer<typeof ParsedGoal>;

export async function interpretAgentRequest(text: string, deterministicIntent: AgentIntent, safeContext?: {
  context: Array<{ role: string; content: string }>; twin: { version: number; goalStatus: string; hasImpact: boolean; hasMandate: boolean };
}): Promise<{
  intent: AgentIntent; explanation: string | null; provider: 'deepseek' | 'deterministic'; fallbackReason: string | null;
}> {
  if (containsPromptInjection(text)) return { intent: 'rejected_prompt_injection', explanation: null,
    provider: 'deterministic', fallbackReason: 'PROMPT_INJECTION_DETECTED' };
  const fallback = (reason: string | null) => ({ intent: deterministicIntent, explanation: null,
    provider: 'deterministic' as const, fallbackReason: reason });
  const result = await requestDeepSeekJson(z.object({
    intent: AgentIntentSchema.exclude(['rejected_prompt_injection']),
    explanation: z.string().max(160).nullable(),
  }), { maxTokens: 180, messages: [
    { role: 'system', content: `你只为模拟财务助手识别任务。输出 JSON {intent,explanation}。intent 只能是：goal_planning,goal_status,goal_impact,mandate_management,external_agent_request,clarification。explanation 最多 80 个中文字符，不计算金额、不提出执行参数、不声称已执行。` },
    { role: 'user', content: JSON.stringify({ recentConversation: safeContext?.context.slice(-20) ?? [],
      financialState: safeContext?.twin ?? null, currentMessage: text }) },
  ] });
  if (!result.ok) return fallback(result.reason);
  return { intent: result.data.intent, explanation: result.data.explanation, provider: 'deepseek', fallbackReason: null };
}

function deterministic(text: string, clock: string): ParsedGoalDraft {
  const target = text.match(/(?:预算|目标|存|需要|准备)[^\d¥]{0,8}¥?\s*([\d,]+(?:\.\d{1,2})?)/);
  const allAmounts = [...text.matchAll(/¥\s*([\d,]+(?:\.\d{1,2})?)/g)];
  const amount = target?.[1] || allAmounts[0]?.[1];
  const emergency = text.match(/应急金[^\d¥]{0,8}¥?\s*([\d,]+)/);
  const exactDate = text.match(/(20\d{2})年(\d{1,2})月(\d{1,2})日/);
  const monthDay = text.match(/(\d{1,2})月(\d{1,2})日/);
  const relativeMonths = text.match(/([一二三四五六七八九十\d]+)个?月后/);
  const chinese = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 } as Record<string, number>;
  let targetDate: string | null = null;
  if (exactDate) targetDate = `${exactDate[1]}-${exactDate[2].padStart(2, '0')}-${exactDate[3].padStart(2, '0')}`;
  else if (monthDay) targetDate = `${clock.slice(0, 4)}-${monthDay[1].padStart(2, '0')}-${monthDay[2].padStart(2, '0')}`;
  else if (relativeMonths) {
    const count = Number(relativeMonths[1]) || chinese[relativeMonths[1]];
    if (count) targetDate = addDays(clock, count * 30);
  }
  const title = text.match(/(?:去|到)(日本|冰岛|巴黎|旅行|旅游)/) ? `${text.match(/(?:去|到)(日本|冰岛|巴黎|旅行|旅游)/)![1]}旅行`
    : text.match(/(相机|学费|开店|买房|旅行)/)?.[1] || '我的新目标';
  return ParsedGoal.parse({ title, targetAmount: amount ? Number(amount.replaceAll(',', '')) : null,
    targetDate, emergencyFundProtected: emergency ? Number(emergency[1].replaceAll(',', '')) : null,
    monthlySavings: null, flexibilityWeeks: null });
}

export async function interpretGoal(text: string, clock: string): Promise<{
  goal: ParsedGoalDraft; provider: 'deepseek' | 'deterministic'; notice?: string; fallbackReason?: string;
}> {
  if (!text.trim() || text.length > 500) throw new Error('目标描述不能为空，且最多 500 字。');
  if (containsPromptInjection(text)) return { goal: deterministic('', clock), provider: 'deterministic', fallbackReason: 'PROMPT_INJECTION_DETECTED',
    notice: '检测到与目标规划无关的指令，未发送给模型。请只描述目标、金额和日期。' };
  const fallback = (reason: string) => ({ goal: deterministic(text, clock), provider: 'deterministic' as const, fallbackReason: reason,
    notice: '当前使用确定性演示解析，请核对金额和日期。' });
  const result = await requestDeepSeekJson(ParsedGoal, { maxTokens: 500, messages: [
    { role: 'system', content: `你只解析模拟财务目标，不做财务决策。当前演示日期 ${clock}。输出 JSON object：title,targetAmount,targetDate,monthlySavings,emergencyFundProtected,flexibilityWeeks。日期用 YYYY-MM-DD；所有金额字段必须是 JSON number；emergencyFundProtected 表示受保护应急金的金额（例如 20000），不能输出 boolean；未知字段为 null。不要编造金额。` },
    { role: 'user', content: text },
  ] });
  if (!result.ok) return fallback(result.reason);
  if (!result.data.title && !result.data.targetAmount && !result.data.targetDate) return fallback('DEEPSEEK_EMPTY_RESULT');
  return { goal: result.data, provider: 'deepseek' };
}

// DeepSeek may compose approved cards, but it cannot invent card content, actions, or financial numbers.
export async function composeUiCards(cards: UiCard[]): Promise<{ cards: UiCard[]; provider: 'deepseek' | 'deterministic' }> {
  const safeCards = cards.map(card => UiCardSchema.parse(card));
  const fallback = { cards: safeCards, provider: 'deterministic' as const };
  const result = await requestDeepSeekJson(z.object({ order: z.array(z.string()) }), {
    maxTokens: 150, timeoutMs: 5_000, messages: [
      { role: 'system', content: '只输出 JSON 对象 {"order":[卡片 ID]}。用给定 ID 排序，优先显示目标进度与显著影响。必须保留所有 ID，不得新建组件、文案、金额、操作或动作。' },
      { role: 'user', content: JSON.stringify(safeCards.map(({ id, type, tone }) => ({ id, type, tone }))) },
    ],
  });
  if (!result.ok) return fallback;
  const known = new Map(safeCards.map(card => [card.id, card]));
  if (result.data.order.length !== safeCards.length || new Set(result.data.order).size !== safeCards.length ||
    result.data.order.some(id => !known.has(id))) return fallback;
  return { cards: result.data.order.map(id => UiCardSchema.parse(known.get(id))), provider: 'deepseek' };
}
