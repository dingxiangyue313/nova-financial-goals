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
  amountField: z.string().max(40).nullable().optional(),
  amountPatches: z.array(z.object({ field: z.enum(['targetCents','savedCents','monthlyContributionCapCents','protectedCents']),
    quote: z.string().min(1).max(40) }).strict()).max(4).default([]),
  datePrecision: z.enum(['exact','approximate','missing']).optional(),
  dateQuestion: z.string().max(100).nullable().optional(),
}).strict();
const numerals: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

export function parseYuan(raw: string): number | null {
  const text = raw.replace(/[\s,，¥￥元人民币块钱]/g, '');
  if (text === '零' || text === '〇') return 0;
  const scaled = text.match(/^(\d+(?:\.\d{1,2})?)(万|千)$/);
  if (scaled) {
    const base = parseYuan(scaled[1]);
    const cents = base === null ? NaN : base * (scaled[2] === '万' ? 10000 : 1000);
    return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
  }
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
  const year = Number(clock.slice(0, 4)) + (/明年/.test(raw) ? 1 : /后年/.test(raw) ? 2 : 0);
  const monthEnd = raw.match(/(今年|明年|后年)?\s*(\d{1,2}|十一|十二|十|[一二三四五六七八九])月底/);
  if (monthEnd) {
    const word = monthEnd[2];
    const month = word === '十一' ? 11 : word === '十二' ? 12 : word === '十' ? 10 : numerals[word] ?? Number(word);
    return month >= 1 && month <= 12 ? iso(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate()) : null;
  }
  const monthDay = raw.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  if (monthDay) return iso(year, Number(monthDay[1]), Number(monthDay[2]));
  const chineseMonthDay=raw.match(/(十一|十二|十|[一二三四五六七八九])月(\d{1,2})日?/);
  if(chineseMonthDay){const word=chineseMonthDay[1];return iso(year,word==='十一'?11:word==='十二'?12:word==='十'?10:numerals[word],Number(chineseMonthDay[2]));}
  if (/年底|年末/.test(raw)) return iso(year, 12, 31);
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

const amountToken = '(?:¥\\s*)?(?:\\d[\\d,]*(?:\\.\\d{1,2})?\\s*[万千]?|零|〇|[一二两三四五六七八九](?:千[一二两三四五六七八九]?|万(?:[一二两三四五六七八九]千)?|百))\\s*元?(?![\\d.万千])';
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
  const dateForMessage=(quote:string)=>{
    if(/20\d{2}|今年|明年|后年|个月后|月后/.test(quote))return parseGoalDate(quote,clock);
    const prior=context.slice().reverse().find(item=>item.role==='user'&&/20\d{2}(?=年|[-/.])|明年|后年|今年/.test(item.content))?.content??'';
    const year=prior.match(/20\d{2}(?=年|[-/.])/)?.[0]??String(Number(clock.slice(0,4))+(/后年/.test(prior)?2:/明年/.test(prior)?1:0));
    return parseGoalDate(quote,year+clock.slice(4));
  };
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
    const targetRaw = quotedAmount(text, '(?:预算|目标金额|一共|总共|总额|需要|要存|存够|攒够)')
      ?? text.match(new RegExp(`(?:前|想|打算|计划)存\\s*(${amountToken})`))?.[1]
      ?? text.match(new RegExp(`(?:^|[，。；;])存\\s*(${amountToken})(?=去|用于|买)`))?.[1] ?? null;
    const bareAmount = text.trim().match(new RegExp(`^(${amountToken})[。！!]?\\s*$`))?.[1] ?? null;
    const previousAssistant = context.slice().reverse().find(item => item.role === 'assistant')?.content ?? '';
    const answeringSavedQuestion = Boolean(bareAmount && task?.phase === 'awaiting_user' &&
      task.waitingReason === 'missing_information' && task.facts.savedCents === null &&
      /已存金额|存了多少|已有存款/.test(previousAssistant));
    setAmount(changes, 'targetCents', targetRaw ?? (!task?.facts.targetCents && !answeringSavedQuestion
      ? bareAmount : null), unknowns);
    setAmount(changes, 'savedCents', savedAmountQuote(text) ?? (answeringSavedQuestion ? bareAmount : null), unknowns);
    setAmount(changes, 'monthlyContributionCapCents', quotedAmount(text, '(?:每个?月(?:最多|上限|不超过|至多|只能|可|只)?(?:投入|存款|存|攒)?|月存上限)'), unknowns);
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
    const datePhrase = text.match(/20\d{2}\s*[-年/.]\s*\d{1,2}\s*[-月/.]\s*\d{1,2}\s*日?|(?:今年|明年|后年)?\s*(?:\d{1,2}|十一|十二|十|[一二三四五六七八九])月底|(?:今年|明年|后年)?\s*\d{1,2}\s*月\s*\d{1,2}\s*日?|(?:今年|明年|后年)?(?:年底|年末)|[一二两三四五六七八九十\d]+个?月后/)?.[0];
    if (datePhrase) {
      const date = dateForMessage(datePhrase);
      if (date) changes.targetDate = { op: 'set', value: date };
      else { unknowns.push('targetDate'); ambiguity = '请给我一个有效的目标日期（年、月、日）。'; }
    }
    const vagueDate=text.match(/(?:今年|明年|后年)?(?:暑假|寒假|夏天|冬天|春节|国庆)/)?.[0];
    const monthOnly=text.match(/(?:20\d{2}\s*年\s*|今年|明年|后年)?(?:1[0-2]|0?[1-9]|十一|十二|十|[一二三四五六七八九])\s*月/)?.[0];
    if(monthOnly&&!datePhrase&&!vagueDate){
      changes.targetDate={op:'clear'};
      unknowns.push(`目标时间：${monthOnly}`);
      ambiguity=`已记下${monthOnly}，你希望在这个月的几号前准备好资金？`;
    }
    if (vagueDate && !datePhrase) {
      changes.targetDate={op:'clear'};
      unknowns.push(`目标时间：${vagueDate}`);
      ambiguity=`你说的“${vagueDate}”大概是几月几日？可以先告诉我月份，具体日期再一起确认。`;
    }
    return { kind, changes, preferences, unknowns, ambiguity, provider: 'deterministic', fallbackReason: reason };
  };
  const result = await requestDeepSeekJson(Suggested, { maxTokens: 650, timeoutMs: 8_000, messages: [
    { role: 'system', content: '结合已有目标草稿和最近对话理解当前消息，输出JSON字段补丁。kind:create/supplement/modify/reject/ask/cancel/select；titleQuote、amountQuote、dateQuote为当前消息逐字片段或null；amountField可为null。amountPatches数组包含field与quote：field为targetCents/savedCents/monthlyContributionCapCents/protectedCents，quote必须是当前消息中完整金额片段（包括万/千单位），不要计算数值。“一共一万”“总共10000”可表示目标总额，无需出现预算关键词；按上轮追问理解省略回答；一轮可包含多个金额。仅补充当前明确的信息，未提及的旧字段保持不变；无法确定金额角色则不要填。datePrecision:exact/approximate/missing；暑假、夏天等为approximate，不能擅自确定某一天；dateQuestion用中文只追问缺少的时间细节。不要重新追问已有金额，不执行操作，不推断未提供的数字。' },
    { role: 'user', content: JSON.stringify({ clock, task: task ? { phase: task.phase, facts: task.facts, constraints: task.constraints,
      unknowns: task.unknowns } : null, recentConversation: context.slice(-12), currentMessage: text }) },
  ] });
  const parsed = fallback(result.ok ? null : result.reason);
  if (!result.ok) return parsed;
  const suggestion = result.data;
  const quotesValid = [suggestion.titleQuote, suggestion.amountQuote, suggestion.dateQuote,...suggestion.amountPatches.map(p=>p.quote)]
    .every(quote => quote === null || text.includes(quote));
  if (!quotesValid) return { ...parsed, fallbackReason: 'MODEL_QUOTE_NOT_IN_MESSAGE' };
  if (suggestion.titleQuote?.trim() && !parsed.changes.title)
    parsed.changes.title = { op: 'set', value: suggestion.titleQuote.trim() };
  const aliases:Record<string,typeof suggestion.amountPatches[number]['field']>={target:'targetCents',targetAmount:'targetCents',targetCents:'targetCents',savedCents:'savedCents',monthlyContributionCapCents:'monthlyContributionCapCents',protectedCents:'protectedCents'};
  const patches=[...suggestion.amountPatches];
  if(suggestion.amountQuote&&aliases[suggestion.amountField??''])patches.push({field:aliases[suggestion.amountField!],quote:suggestion.amountQuote});
  for(const patch of patches){
    if(parsed.changes[patch.field])continue;
    const cents=parseYuan(patch.quote);
    // A budget quote alone cannot also establish an existing savings balance.
    if(patch.field==='savedCents'&&parsed.changes.targetCents?.op==='set'
      &&parsed.changes.targetCents.value===cents
      &&!/(?:已存|已经|存了|攒了|现有|已有|现在有|手上有|手里有|余额|积蓄|存款)/.test(text))continue;
    if(cents!==null&&(patch.field!=='targetCents'||cents>0))parsed.changes[patch.field]={op:'set',value:cents};
  }
  if (suggestion.dateQuote && !parsed.changes.targetDate) {
    const date = dateForMessage(suggestion.dateQuote);
    if (date) parsed.changes.targetDate = { op: 'set', value: date };
  }
  if(!parsed.ambiguity&&suggestion.datePrecision==='approximate'&&suggestion.dateQuote&& !parseGoalDate(suggestion.dateQuote,clock)){
    parsed.changes.targetDate={op:'clear'};
    parsed.ambiguity=`你说的“${suggestion.dateQuote}”具体是几月几日？可以先确认月份。`;
  }
  // Model labels may refine a question, but deterministic extraction remains authoritative.
  if (suggestion.kind === 'ask' && Object.keys(parsed.changes).length === 0)
    return { ...parsed, kind: 'ask', provider: 'deepseek', fallbackReason: null };
  return { ...parsed, provider: 'deepseek', fallbackReason: null };
}
