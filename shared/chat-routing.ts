import { z } from 'zod';
import type { AgentTurnWithRun } from './contracts';

export const chatDestinations = {
  transfer: { category: 'transfers', section: 'contact' },
  aa_create: { category: 'transfers', section: 'aa' },
  aa_records: { category: 'transfers', section: 'records' },
  investment_products: { category: 'wealth', section: 'products' },
  investment_holdings: { category: 'wealth', section: 'holdings' },
  investment_profile: { category: 'wealth', section: 'profile' },
  cards: { category: 'cards', section: 'mine' },
  card_apply: { category: 'cards', section: 'apply' },
  subscription_card: { category: 'cards', section: 'subscriptions' },
  bills: { category: 'bills', section: 'overview' },
  spending: { category: 'bills', section: 'analysis' },
  subscriptions: { category: 'bills', section: 'subscriptions' },
  bill_import: { category: 'bills', section: 'data' },
  travel_quotes: { category: 'travel', section: 'quotes' },
  travel_mandate: { category: 'travel', section: 'mandates' },
  travel_payment: { category: 'travel', section: 'payment' },
  travel_orders: { category: 'travel', section: 'orders' },
  goal_allocation: { category: 'overview', section: 'allocation' },
  goal_transfer: { category: 'overview', section: 'transfer' },
  cashflow: { category: 'overview', section: 'forecast' },
  goal_adjust: { category: 'overview', section: 'plans' },
} as const;
export const ChatDestinationSchema = z.enum(Object.keys(chatDestinations) as [keyof typeof chatDestinations, ...Array<keyof typeof chatDestinations>]);
export const ChatRouteDecisionSchema = z.object({
  mode: z.enum(['navigate', 'chat', 'clarify']),
  destination: ChatDestinationSchema.nullable(),
  question: z.string().max(160).nullable(),
  chatIntent: z.enum(['goal_planning','goal_status','goal_impact','clarification']).nullish(),
  answer: z.string().max(500).nullable().optional(),
  memoryAction: z.enum(['continue','new','cancel']).nullish(),
  draft: z.object({ recipientQuery: z.preprocess(v=>v===null?undefined:v,z.string().max(60).optional()), amount: z.preprocess(v=>v===null?undefined:v,z.string().max(40).optional()),
    sourceAccount: z.preprocess(v=>v===null?undefined:v,z.string().max(60).optional()) }).strict().nullish(),
}).strict().refine(value => value.mode === 'navigate' ? value.destination !== null : value.destination === null);
export const ChatRouteResponseSchema = z.object({ decision: ChatRouteDecisionSchema,
  provider: z.enum(['deepseek', 'deterministic', 'unavailable']), reason: z.string().nullable() });
export const ChatMemorySchema = z.object({ destination: ChatDestinationSchema.nullable(),
  recipientQuery: z.string().max(60).default(''), amountCents: z.number().int().nonnegative().nullable().default(null),
  sourceAccount: z.string().max(60).default(''), status: z.enum(['active','cancelled']).default('active') });
export type ChatMemory=z.infer<typeof ChatMemorySchema>;
export type ChatConversationResponse=z.infer<typeof ChatRouteResponseSchema>&{threadId:string;memory:ChatMemory;turn:AgentTurnWithRun|null};
