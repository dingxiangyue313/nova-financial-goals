import { z } from 'zod';
import { addDays } from './domain.ts';
import { IsoDateSchema, type AgentTask } from '../shared/contracts.ts';
import { requestDeepSeekJson } from './deepseek-client.ts';
import { containsPromptInjection } from './security.ts';

export type UnderstandingKind = 'create' | 'supplement' | 'modify' | 'reject' | 'ask' | 'cancel' | 'select';
export type FieldChange<T> = { op: 'set'; value: T } | { op: 'clear' };
export type Understanding = {
  kind: UnderstandingKind;
  changes: Partial<Record<'title' | 'targetCents' | 'targetDate' | 'savedCents' | 'monthlyContributionCapCents' |
    'protectedCents' | 'latestAllowedDate' | 'preserveEssentialSpending', FieldChange<string | number | boolean>>>;
  preferences: string[]; unknowns: string[]; ambiguity: string | null;
  provider: 'deepseek' | 'deterministic'; fallbackReason: string | null;
};

const Suggested = z.object({ kind: z.enum(['create', 'supplement', 'modify', 'reject', 'ask', 'cancel', 'select']),
  titleQuote: z.string().max(60).nullable(), amountQuote: z.string().max(40).nullable(),
  dateQuote: z.string().max(40).nullable(),
  amountField: z.string().max(40).nullable().optional() }).strict();
const numerals: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

export function parseYuan(raw: string): number | null {
  const text = raw.replace(/[\s,，¥元人民币]/g, '');
  if (text === '零' || text === '〇') return 0;
  if (/^\d+(?:\.\d{1,2})?$/.test(text)) {
    const [whole, decimals = ''] = text.split('.');
    const cents = Number(whole) * 100 + Number(decimals.padEnd(2, '0'));
    return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
  }
  if (/^[一二两三四五六七八九]千[一二两三四五六七八九]?$/.test(text))
    return ((numerals[text[0]] * 1000) + (text.length === 3 ? numerals[text[2]] * 100 : 0)) * 100;
  if (/^[一二两三四五六七八九]万(?:[一二两三四五六七八九]千)?$/.test(text))
    return (numerals[text[0]] * 10000 + (text.length > 2 ? numerals[text[2]] * 1000 : 0)) * 100;
  if (/^[一二两三四五六七八九]百$/.test(text)) return numerals[text[0]] * 10000;
  return null;
}

function iso(year: number, month: number, day: number): string | null {
  const value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return IsoDateSchema.safeParse(value).success ? value : null;
}

export function parseGoalDate(raw: string, clock: string): string | null {
  const exact = raw.match(/(20\d{2})\s*[-年/.]\s*(\d{1,2})\s*[-月/.]\s*(\d{1,2})\s*日?/);
  if (exact) return iso(Number(exact[1]), Number(exact[2]), Number(exact[3]));
  const monthDay = raw.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  if (monthDay) return iso(Number(clock.slice(0, 4)), Number(monthDay[1]), Number(monthDay[2]));
  if (/年底|年末/.test(raw)) return iso(Number(clock.slice(0, 4)), 12, 31);
  const relative = raw.match(/([一二两三四五六七八九十]|\d{1,2})个?月后/);
  if (relative) {
    const count = relative[1] === '十' ? 10 : (numerals[relative[1]] ?? Number(relative[1]));
    if (Number.isInteger(count) && count > 0 && count <= 24) {
      const date = new Date(`${clock}T12:00:00Z`);
      date.setUTCMonth(date.getUTCMonth() + count);
      return date.toISOString().slice(0, 10);
    }
  }
  return null;
}

const amountToken = '(?:¥\\s*)?(?:\\d[\\d,]*(?:\\.\\d{1,2})?|零|〇|[一二两三四五六七八九](?:千[一二两三四五六七八九]?|万(?:[一二两三四五六七八九]千)?|百))\\s*元?';
function quotedAmount(text: string, prefix: string): string | null {
  return text.match(new RegExp(`(?:${prefix})[^，。；;]{0,12}?(${amountToken})`))?.[1] ?? null;
}
function savedAmountQuote(text: string): string | null {
  const explicit = quotedAmount(text, '(?:已经存了|已存|现在有|已有)');
  if (explicit) return explicit;
  // Short replies such as “存款600元” answer the saved-money question.
  // Require a clause boundary so “每月存款600元” remains a monthly limit.
  return text.match(new RegExp(`(?:^|[，。；;\\s]|我|目前|现在)(?:存款|存了|攒了)[^，。；;]{0,8}?(${amountToken})`))?.[1] ?? null;
}
function setAmount(changes: Understanding['changes'], field: keyof Understanding['changes'], raw: string | null,
  unknowns: string[]) {
  if (!raw) return;
  const cents = parseYuan(raw);
  if (cents === null) unknowns.push(field);
  else changes[field] = { op: 'set', value: cents };
}

export async function understandGoalMessage(text: string, clock: string, task: AgentTask | null,
  context: Array<{ role: string; content: string }> = []): Promise<Understanding> {
  if (containsPromptInjection(text)) return { kind: 'ask', changes: {}, preferences: [], unknowns: [],
    ambiguity: '这条消息包含与目标无关的指令，请重新描述目标。', provider: 'deterministic', fallbackReason: 'PROMPT_INJECTION_DETECTED' };
  const fallback = (reason: string | null): Understanding => {
    const changes: Understanding['changes'] = {};
    const unknowns: string[] = [];
    const preferences: string[] = [];
    const kind: UnderstandingKind = /取消(?:这个|当前)?(?:目标|任务|计划)|不做了/.test(text) ? 'cancel'
      : /选(?:择)?推荐的|就推荐的/.test(text) ? 'select'
        : /不要(?:这个|该)?方案|拒绝(?:这个|该)?方案/.test(text) ? 'reject'
          : /^(?:为什么|怎么|能否|可以吗|请问)/.test(text) ? 'ask'
            : task?.facts.title || task?.facts.targetCents || task?.facts.originalTargetDate ? 'modify' : 'create';
    if (kind === 'cancel' || kind === 'select' || kind === 'reject' || kind === 'ask')
      return { kind, changes, preferences, unknowns, ambiguity: null, provider: 'deterministic', fallbackReason: reason };
    const clear = (field: keyof Understanding['changes'], pattern: RegExp) => {
      if (pattern.test(text)) changes[field] = { op: 'clear' };
    };
    clear('savedCents', /(?:撤回|清除|删除|不算|取消)(?:已存|已有|存款)/);
    clear('monthlyContributionCapCents', /(?:撤回|清除|删除|不设|取消)(?:每月|月存)(?:上限|限制)?/);
    clear('protectedCents', /(?:撤回|清除|删除|不设|取消)应急金/);
    clear('targetDate', /(?:撤回|清除|删除|取消)(?:目标|完成)?日期/);
    const title = text.match(/(?:去|到)(日本|冰岛|巴黎|欧洲|韩国|中国)(?:旅行|旅游)?/)?.[1];
    if (title) changes.title = { op: 'set', value: `${title}旅行` };
    else if (!task?.facts.title) {
      const general = text.match(/(?:买|购)(相机|车|房)|(?:旅行|旅游|学费|开店)/)?.[1]
        ?? text.match(/旅行|旅游|学费|开店/)?.[0];
      if (general) changes.title = { op: 'set', value: general };
    }
    const targetRaw = /目标日期|完成日期|截止日期/.test(text) ? null
      : quotedAmount(text, '(?:预算|目标(?:金额)?|需要|要存|存够)');
    const bareAmount = text.trim().match(new RegExp(`^(${amountToken})[。！!]?\\s*$`))?.[1] ?? null;
    const previousAssistant = context.slice().reverse().find(item => item.role === 'assistant')?.content ?? '';
    const answeringSavedQuestion = Boolean(bareAmount && task?.phase === 'awaiting_user' &&
      task.waitingReason === 'missing_information' && task.facts.savedCents === null &&
      /已存金额|存了多少|已有存款/.test(previousAssistant));
    setAmount(changes, 'targetCents', targetRaw ?? (!task?.facts.targetCents && !answeringSavedQuestion
      ? bareAmount : null), unknowns);
    setAmount(changes, 'savedCents', savedAmountQuote(text) ?? (answeringSavedQuestion ? bareAmount : null), unknowns);
    setAmount(changes, 'monthlyContributionCapCents', quotedAmount(text, '(?:每月最多存|每个月最多存|每月可存|每月只存|每月存|每个月存)'), unknowns);
    setAmount(changes, 'protectedCents', quotedAmount(text, '(?:应急金|保留应急金|保护应急金)'), unknowns);
    if (/不(?:削减|减少|动)(?:健身|运动)支出/.test(text)) preferences.push('保留健身支出');
    if (/可能.{0,4}奖金|奖金.{0,4}可能/.test(text)) unknowns.push('可能有奖金，金额和到账时间未确认');
    if (/不动应急金|不使用应急金|保留必要支出|不削减必要支出/.test(text))
      changes.preserveEssentialSpending = { op: 'set', value: true };
    const delay = text.match(/最多(?:晚|延后|推迟)([一二两三四五六七八九十\d]+)周/);
    let ambiguity: string | null = bareAmount && task?.facts.targetCents && !answeringSavedQuestion &&
      !targetRaw && !changes.savedCents ? '这笔金额是已存款、每月打算存的金额，还是要修改目标总额？' : null;
    if (delay) {
      const weeks = delay[1] === '十' ? 10 : (numerals[delay[1]] ?? Number(delay[1]));
      if (task?.facts.originalTargetDate && weeks <= 52) changes.latestAllowedDate = {
        op: 'set', value: addDays(task.facts.originalTargetDate, weeks * 7),
      };
      else ambiguity = '你希望以哪一天作为最多延后的起点？';
    }
    const datePhrase = text.match(/20\d{2}\s*[-年/.]\s*\d{1,2}\s*[-月/.]\s*\d{1,2}\s*日?|\d{1,2}\s*月\s*\d{1,2}\s*日?|年底|年末|[一二两三四五六七八九十\d]+个?月后/)?.[0];
    if (datePhrase) {
      const date = parseGoalDate(datePhrase, clock);
      if (date) changes.targetDate = { op: 'set', value: date };
      else { unknowns.push('targetDate'); ambiguity = '请给我一个有效的目标日期（年、月、日）。'; }
    }
    return { kind, changes, preferences, unknowns, ambiguity, provider: 'deterministic', fallbackReason: reason };
  };
  const result = await requestDeepSeekJson(Suggested, { maxTokens: 180, timeoutMs: 5_000, messages: [
    { role: 'system', content: '识别模拟理财目标对话。只输出 JSON：kind 为 create/supplement/modify/reject/ask/cancel/select；titleQuote、amountQuote、dateQuote 必须是当前消息逐字片段或 null；amountField 表示金额属于目标总额、已存、每月上限或保护资金，无法判断则为 null。结合上一轮助手追问理解简短回答，例如问已存多少钱后回复“600元”表示已存金额。不要推断未说出的数字，不要执行工具。' },
    { role: 'user', content: JSON.stringify({ clock, task: task ? { phase: task.phase, facts: task.facts, constraints: task.constraints,
      unknowns: task.unknowns } : null, recentConversation: context.slice(-12), currentMessage: text }) },
  ] });
  const parsed = fallback(result.ok ? null : result.reason);
  if (!result.ok) return parsed;
  const suggestion = result.data;
  const quotesValid = [suggestion.titleQuote, suggestion.amountQuote, suggestion.dateQuote]
    .every(quote => quote === null || text.includes(quote));
  if (!quotesValid) return { ...parsed, fallbackReason: 'MODEL_QUOTE_NOT_IN_MESSAGE' };
  if (suggestion.titleQuote?.trim() && !parsed.changes.title &&
    /旅行|旅游|买|购|学费|开店|目标/.test(text))
    parsed.changes.title = { op: 'set', value: suggestion.titleQuote.trim() };
  if (suggestion.amountQuote && !parsed.changes.targetCents && !parsed.changes.savedCents && !parsed.ambiguity) {
    const index = text.indexOf(suggestion.amountQuote);
    const nearby = text.slice(Math.max(0, index - 12), index);
    const cents = parseYuan(suggestion.amountQuote);
    if (cents !== null && cents > 0 && ['targetCents', 'target', 'targetAmount'].includes(suggestion.amountField ?? '') &&
      /预算|目标金额|需要|存够/.test(nearby))
      parsed.changes.targetCents = { op: 'set', value: cents };
  }
  if (suggestion.dateQuote && !parsed.changes.targetDate) {
    const date = parseGoalDate(suggestion.dateQuote, clock);
    if (date) parsed.changes.targetDate = { op: 'set', value: date };
  }
  // Model labels may refine a question, but deterministic extraction remains authoritative.
  if (suggestion.kind === 'ask' && Object.keys(parsed.changes).length === 0)
    return { ...parsed, kind: 'ask', provider: 'deepseek', fallbackReason: null };
  return { ...parsed, provider: 'deepseek', fallbackReason: null };
}
