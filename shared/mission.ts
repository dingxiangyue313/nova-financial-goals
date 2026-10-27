import {MissionNotificationSchema} from './money-mission.ts';
import { z } from 'zod';

export const MissionRowSchema = z.object({
  id: z.string(), date: z.iso.date(), merchant: z.string(), cents: z.number().int(),
  category: z.enum(['餐饮', '住房', '交通', '购物', '订阅', '水电', '保险', '工资', '退款', '内部转账', '待核对']),
  source: z.enum(['银行卡', '微信', '支付宝']), excluded: z.boolean().default(false),
});
export type MissionRow = z.infer<typeof MissionRowSchema>;
export const MissionSchema = z.object({
  artifactsVersion:z.literal(2).optional(),monitoringEnabled:z.boolean().optional(),notifications:z.array(MissionNotificationSchema).optional(),
  demoOutcome: z.enum(['succeeded', 'failed', 'unknown']).optional(),
  version: z.literal(1), rows: z.array(MissionRowSchema),
  batches: z.array(z.object({ id: z.string(), name: z.string(), count: z.number().int(), duplicates: z.number().int(), at: z.iso.date(), rowIds: z.array(z.string()) })),
  subscription: z.object({ status: z.enum(['active', 'cancelled', 'unknown', 'failed']), preference: z.enum(['none', 'keep', 'remind', 'ignored']),
    cancelledAt: z.string().nullable(), effectiveAt: z.iso.date().nullable(), paidThrough: z.iso.date(), nextChargeSuppressed: z.boolean(), merchantOperationId: z.string().nullable() }),
  schedule: z.object({ id: z.string(), goalId: z.string(), amountCents: z.number().int().positive(), frequency: z.enum(['once', 'monthly']), status: z.enum(['active', 'paused', 'cancelled', 'completed']), createdAt: z.iso.date(), endDate: z.iso.date(), processedMonths: z.array(z.string()) }).nullable(),
  pending: z.object({ relatedId:z.string().optional(), id: z.string(), kind: z.enum(['cancel_subscription', 'create_schedule', 'pause_schedule', 'resume_schedule', 'cancel_schedule']), amountCents: z.number().int(), frequency: z.enum(['once', 'monthly']), twinVersion: z.number().int(), expiresAt: z.number(), fingerprint: z.string() }).nullable(),
  receipts: z.array(z.object({ id: z.string(), kind: z.string(), status: z.enum(['succeeded', 'failed', 'unknown', 'skipped']), date: z.iso.date(), detail: z.string(), amountCents: z.number().int(), requestId: z.string() })),
});
export type Mission = z.infer<typeof MissionSchema>;

export function missionCompletionDate(today: string, remainingCents: number, monthlyCents: number, initialCents = 0) {
  if (remainingCents <= initialCents) return today;
  if (monthlyCents <= 0) return null;
  const date = new Date(`${today}T00:00:00Z`);
  const count = Math.ceil((remainingCents - initialCents) / monthlyCents);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + (date.getUTCDate() >= 26 ? 1 : 0) + count - 1, 26)).toISOString().slice(0, 10);
}

export function datedCashflow(state: { clock: string; finance: { checkingCents: number }; mission: Pick<Mission, 'subscription'> }, contribution = 0) {
  const m = state.mission; let balance = state.finance.checkingCents; let low = balance; let lowDate = state.clock;
  const events: { date: string; title: string; cents: number; balanceCents: number }[] = [];
  const start = new Date(`${state.clock}T00:00:00Z`);
  for (let offset = 1; offset <= 62; offset++) {
    const d = new Date(start); d.setUTCDate(d.getUTCDate() + offset); const day = d.getUTCDate(); const date = d.toISOString().slice(0, 10);
    const charges: [number, string, number][] = [[1, '房租', -280000], [5, 'CloudBox Plus', m.subscription.nextChargeSuppressed ? 0 : -6800], [8, '日常采购', -30000], [10, '水电', -42000], [15, '交通', -20000], [18, '保险', -28000], [25, '预计工资（假设按时到账）', 850000], [26, '预计旅行金转入（须工资实际到账）', -contribution]];
    for (const [due, title, cents] of charges) if (day === due && cents) { balance += cents; events.push({ date, title, cents, balanceCents: balance }); if (balance < low) { low = balance; lowDate = date; } }
  }
  return { lowCents: low, lowDate, events, stressLowCents: low - 50000, assumption: '工资通常25日到账；压力情景增加¥500必要支出；未包含未知支出。预测不是保证。' };
}

