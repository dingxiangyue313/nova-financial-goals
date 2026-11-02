import { z } from 'zod';
import type { AgentTurnWithRun } from './contracts';

export {pageDestinations as chatDestinations} from "./capabilities.ts";
import {pageDestinations as chatDestinations} from "./capabilities.ts";
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
// Routing consumes only this allowlist. Extra model metadata (e.g. goalDraft)
// is discarded, never forwarded as goal data or executable arguments.
}).strip().refine(value => value.mode === 'navigate' ? value.destination !== null : value.destination === null);
export const ChatRouteResponseSchema = z.object({ decision: ChatRouteDecisionSchema,
  provider: z.enum(['deepseek', 'deterministic', 'unavailable']), reason: z.string().nullable() });
export const ChatMemorySchema = z.object({ destination: ChatDestinationSchema.nullable(),
  recipientQuery: z.string().max(60).default(''), amountCents: z.number().int().nonnegative().nullable().default(null),
  sourceAccount: z.string().max(60).default(''), status: z.enum(['active','cancelled']).default('active') });
export type ChatMemory=z.infer<typeof ChatMemorySchema>;
export type ChatConversationResponse=z.infer<typeof ChatRouteResponseSchema>&{threadId:string;memory:ChatMemory;turn:AgentTurnWithRun|null};
