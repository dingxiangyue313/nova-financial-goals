import {z} from 'zod';
import {ChatDestinationSchema} from './chat-routing.ts';
import {businessActions,destinationForAction,type BusinessAction} from './capabilities.ts';
import {knowledgeIds} from './product-knowledge.ts';
export const GoalFieldSchema=z.enum(['title','targetCents','savedCents','targetDate','monthlyContributionCapCents','protectedCents']);
export const SemanticCommandSchema=z.object({
 operation:z.enum(['goal','explain','read_facts','clarify','cancel','resume',...businessActions]),
 lifecycle:z.enum(['continue','new']).default('continue'),taskId:z.string().nullable().default(null),
 taskCandidates:z.array(z.string()).max(8).default([]),
 knowledgeRefs:z.array(z.enum(knowledgeIds)).max(3).default([]),
 questionKey:z.enum(['scope','select_action','amount_role','target_date','target_budget','savings']).default('scope'),
 actionCandidates:z.array(z.enum(businessActions)).max(4).default([]),
 read:z.object({kind:z.enum(['account_balances','goal_funds','goal_progress','travel_orders']),id:z.string().nullable().default(null)}).nullable().default(null),
 patches:z.array(z.object({field:GoalFieldSchema, value:z.union([z.string(),z.number()]).nullable().transform(v=>v===null?null:String(v)),evidence:z.string().min(1),precision:z.enum(['exact','year','month','approximate']).default('exact')}).strip()).max(6).default([]),
 transfer:z.preprocess(v=>v===null?{}:v,z.object({recipient:z.string().nullable().default(null),amount:z.union([z.string(),z.number()]).nullable().default(null).transform(v=>v===null?null:String(v)),account:z.string().nullable().default(null)}).strip().default({recipient:null,amount:null,account:null})),
 timeHint:z.string().nullable().default(null),question:z.string().max(180).nullable().default(null),answer:z.string().max(500).nullable().default(null),
}).strip().transform(c=>({...c,action:businessActions.includes(c.operation as BusinessAction)?c.operation as BusinessAction:null,
 operation:businessActions.includes(c.operation as BusinessAction)?'navigate':c.operation,
 capability:businessActions.includes(c.operation as BusinessAction)?destinationForAction(c.operation as BusinessAction):null}));
export type SemanticCommand=z.infer<typeof SemanticCommandSchema>;
export const ConversationTaskSchema=z.object({id:z.string(),kind:z.enum(['goal','service']),status:z.enum(['active','cancelled']),
 capability:ChatDestinationSchema.nullable(),goal:z.partialRecord(GoalFieldSchema,z.union([z.string(),z.number(),z.null()])),timeHint:z.string().nullable(),
 recipientQuery:z.string(),amountCents:z.number().int().nonnegative().nullable(),sourceAccount:z.string(),
 name:z.string().default(''),progress:z.enum(['collecting','ready','cancelled']).default('collecting'),
 lastOperation:z.string().default(''),updatedAt:z.string().default(''),revision:z.number().int().nonnegative().default(0),
 fieldSources:z.record(z.string(),z.object({evidence:z.string(),revision:z.number().int(),at:z.string()})).default({})});
export const ConversationStateSchema=z.object({version:z.number().int().nonnegative().default(0),activeTaskId:z.string().nullable().default(null),tasks:z.array(ConversationTaskSchema).default([])});
export type ConversationState=z.infer<typeof ConversationStateSchema>;
export type ConversationTask=z.infer<typeof ConversationTaskSchema>;
export const ReplyEvidenceSchema=z.array(z.object({kind:z.enum(['account_snapshot','goal_ledger','order_ledger','calculation']),id:z.string(),version:z.number().int().positive(),asOf:z.iso.date()}).strict());
export type ReplyEvidence=z.infer<typeof ReplyEvidenceSchema>;
