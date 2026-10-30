import {z} from 'zod';
export const TravelTaskNodeSchema=z.object({id:z.string(),label:z.string(),dependsOn:z.array(z.string()),status:z.enum(['complete','pending','blocked','unknown','needs_recovery']),detail:z.string(),sourceRefs:z.array(z.string())});
export const TravelTaskSchema=z.object({id:z.string(),schemaVersion:z.union([z.literal(1),z.literal(2)]),checkpointRevision:z.number().int().optional(),goalId:z.string(),goalTitle:z.string(),twinVersion:z.number().int(),asOf:z.iso.date(),
 status:z.enum(['planning','needs_attention','booked','refund_pending']),coverageCents:z.number().int(),targetCents:z.number().int(),
 progress:z.object({cashCents:z.number().int(),heldCents:z.number().int(),effectiveOrderCents:z.number().int(),fulfilledCents:z.number().int(),prepared:z.boolean(),paid:z.boolean(),fulfilled:z.boolean(),taskComplete:z.boolean()}).optional(),nodes:z.array(TravelTaskNodeSchema),limitations:z.array(z.string())});
export type TravelTask=z.infer<typeof TravelTaskSchema>;
export const TravelProofSchema=z.object({schemaVersion:z.union([z.literal(1),z.literal(2)]),task:TravelTaskSchema,
 operations:z.array(z.object({operationId:z.string(),kind:z.string(),status:z.string(),amountCents:z.number().int(),date:z.iso.date()})),
 audit:z.array(z.object({id:z.string(),stage:z.string(),status:z.string(),hash:z.string(),previousHash:z.string()})),
 sources:z.array(z.object({id:z.string(),summary:z.string(),kind:z.string()})).optional(),checkpoint:z.object({id:z.string(),revision:z.number().int(),schemaVersion:z.number().int(),stateHash:z.string(),operationIds:z.array(z.string())}).optional(),fulfillment:z.array(z.object({eventId:z.string(),bookingId:z.string(),status:z.string(),reportedOn:z.iso.date(),evidenceRef:z.string()})).optional(),limitations:z.array(z.string())});
export type TravelProof=z.infer<typeof TravelProofSchema>;
