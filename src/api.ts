import { AiSafetyOverviewSchema, AiSafetyDecisionReceiptSchema, AiSafetyControlSchema, MoneyMissionReadModelSchema, SnapshotSchema, type Snapshot } from '../shared/contracts';
import type { Goal, ImpactScenario } from './types';

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

export async function api<T = Snapshot>(url: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: body === undefined || body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch {
    throw new Error('暂时无法连接本地服务。请稍后重试，已输入的内容会保留。');
  }
  if(!response.headers.get('content-type')?.includes('application/json')) throw new ApiError(response.status,'接口未返回有效数据，请刷新页面；若仍出现，请确认打开的是当前服务端口。','INVALID_API_RESPONSE');
  const json = await response.json();
  if (!response.ok) throw new ApiError(response.status, json.error || '请求失败，请稍后重试', json.code || json.error);
  if (url === '/api/goals/current/plan-preview' || url === '/api/goals/current/plan-change') return json as T;
  if (url === '/api/ai-safety') return AiSafetyOverviewSchema.parse(json) as T;
  if (url === '/api/ai-safety/control' || url === '/api/demo/ai-safety/safe-mode') return AiSafetyControlSchema.parse(json) as T;
  if (/^\/api\/ai-safety\/runs\/[^/]+\/receipt$/.test(url)) return AiSafetyDecisionReceiptSchema.parse(json) as T;
  if (url === '/api/money-mission') return MoneyMissionReadModelSchema.parse(json) as T;
  if (/^\/api\/(statement-import|account-snapshots|services|capabilities|subscriptions)/.test(url) || url.startsWith('/api/money-mission/') || url.startsWith('/api/product/') && !url.endsWith('/start') && !url.endsWith('/confirm')) return json as T;
  return url === '/api/goal/interpret' || url === '/api/goals' || url === '/api/ui/cards' || url === '/api/mcp/token' || url.startsWith('/api/operations/') || url.startsWith('/api/agent') || url.startsWith('/api/risk/') || url.startsWith('/api/data-connections') || url.startsWith('/api/demo/data-connections/')
    ? json as T : SnapshotSchema.parse(json) as T;
}

export const yuan = (cents: number) => cents / 100;
export const cents = (amount: number) => Math.round(amount * 100);
export function readableDate(iso: string) {
  const [year, month, day] = iso.split('-').map(Number);
  return `${year}年${month}月${day}日`;
}
export function shortDate(iso: string) {
  const [, month, day] = iso.split('-').map(Number);
  return `${month}月${day}日`;
}

export function displayGoal(s: Snapshot): Goal {
  const g = s.primaryGoal ?? s.goal;
  const preferred = s.assessment.plans.find(p => p.recommended) || s.assessment.plans[1];
  return {
    id: g.id, title: g.title, targetAmount: yuan(g.targetCents), currentAmount: yuan(g.savedCents), progressPercent: s.assessment.progressPercent,
    targetDate: g.targetDate, originalDate: g.originalDate,
    monthlySavings: yuan(g.monthlyContributionCents || preferred?.monthlyCents || 0),
    emergencyFundProtected: yuan(s.finance.emergencyCents),
    status: s.assessment.status === 'at_risk' ? 'delayed' : 'normal',
    imageUrl: g.imageUrl, flexibilityWeeks: g.flexibilityWeeks, quote: g.quote,
    delayDays: s.assessment.delayDays,
  };
}

export function displayImpact(s: Snapshot): ImpactScenario | null {
  const i = s.pendingImpact;
  if (!i) return null;
  return {
    expenseTitle: i.title, expenseAmount: yuan(i.expenseCents), expenseDate: shortDate(i.detectedAt),
    impactDays: i.delayDays, previousMonthly: yuan(s.goal.monthlyContributionCents),
    adjustedMonthlyRemaining: yuan(Math.max(0, s.goal.monthlyContributionCents - i.shortfallCents)),
    emergencyFundAmount: yuan(s.finance.emergencyCents),
    optionA: { title: '方案 A · 保持目标日期', description: '适度增加后续月存',
      increasePerMonth: yuan(i.optionAContributionCents - s.goal.monthlyContributionCents),
      newMonthly: yuan(i.optionAContributionCents), completionDate: s.goal.originalDate, available: i.optionAAvailable },
    optionB: { title: '方案 B · 调整目标日期', description: '保持原有月存节奏',
      delayDays: i.delayDays, newMonthly: yuan(s.goal.monthlyContributionCents), completionDate: i.optionBDate },
  };
}
