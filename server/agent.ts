import { z } from 'zod';
import { addDays } from './domain.ts';
import { UiCardSchema, type UiCard } from '../shared/contracts.ts';
import { containsPromptInjection } from './security.ts';

const ParsedGoal = z.object({
  title: z.string().max(60).nullable().optional(),
  targetAmount: z.number().positive().max(10_000_000).nullable().optional(),
  targetDate: z.string().max(40).nullable().optional(),
  monthlySavings: z.number().nonnegative().max(10_000_000).nullable().optional(),
  emergencyFundProtected: z.number().nonnegative().max(10_000_000).nullable().optional(),
  flexibilityWeeks: z.number().int().nonnegative().max(52).nullable().optional(),
});
export type ParsedGoalDraft = z.infer<typeof ParsedGoal>;

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

export async function interpretGoal(text: string, clock: string): Promise<{ goal: ParsedGoalDraft; provider: 'deepseek' | 'deterministic'; notice?: string }> {
  if (!text.trim() || text.length > 500) throw new Error('目标描述不能为空，且最多 500 字。');
  if (containsPromptInjection(text)) return { goal: deterministic('', clock), provider: 'deterministic',
    notice: '检测到与目标规划无关的指令，未发送给模型。请只描述目标、金额和日期。' };
  const fallback = () => ({ goal: deterministic(text, clock), provider: 'deterministic' as const,
    notice: '当前使用确定性演示解析，请核对金额和日期。' });
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return fallback();
  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
        thinking: { type: 'disabled' }, response_format: { type: 'json_object' }, max_tokens: 500,
        messages: [
          { role: 'system', content: `你只解析模拟财务目标，不做财务决策。当前演示日期 ${clock}。输出 JSON object：title,targetAmount,targetDate,monthlySavings,emergencyFundProtected,flexibilityWeeks。日期用 YYYY-MM-DD；未知字段为 null。不要编造金额。` },
          { role: 'user', content: text },
        ] }), signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return fallback();
    const raw = await response.json();
    const content = raw?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return fallback();
    const goal = ParsedGoal.parse(JSON.parse(content));
    if (!goal.title && !goal.targetAmount && !goal.targetDate) return fallback();
    return { goal, provider: 'deepseek' };
  } catch { return fallback(); }
}

// DeepSeek may compose approved cards, but it cannot invent card content, actions, or financial numbers.
export async function composeUiCards(cards: UiCard[]): Promise<{ cards: UiCard[]; provider: 'deepseek' | 'deterministic' }> {
  const safeCards = cards.map(card => UiCardSchema.parse(card));
  const fallback = { cards: safeCards, provider: 'deterministic' as const };
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return fallback;
  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
        thinking: { type: 'disabled' }, response_format: { type: 'json_object' }, max_tokens: 150,
        messages: [
          { role: 'system', content: '只输出 JSON 对象 {"order":[卡片 ID]}。用给定 ID 排序，优先显示目标进度与显著影响。必须保留所有 ID，不得新建组件、文案、金额、操作或动作。' },
          { role: 'user', content: JSON.stringify(safeCards.map(({ id, type, tone }) => ({ id, type, tone }))) },
        ] }), signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return fallback;
    const content = (await response.json())?.choices?.[0]?.message?.content;
    const parsed = z.object({ order: z.array(z.string()) }).parse(JSON.parse(content));
    const known = new Map(safeCards.map(card => [card.id, card]));
    if (parsed.order.length !== safeCards.length || new Set(parsed.order).size !== safeCards.length ||
      parsed.order.some(id => !known.has(id))) return fallback;
    return { cards: parsed.order.map(id => UiCardSchema.parse(known.get(id))), provider: 'deepseek' };
  } catch { return fallback; }
}
