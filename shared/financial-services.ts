import { z } from 'zod';
import {GoalContractSchema,GoalContractChangeSchema} from './goal-contract.ts';
import {InvestmentAnswersSchema} from './investment-profile.ts';
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const quantity = z.string().regex(/^\d+$/);
export const ServiceActionSchema = z.discriminatedUnion('kind', [
  z.object({kind:z.literal('subscription_card'),subscriptionId:z.string(),cardId:z.string(),expectedBindingVersion:z.number().int().nonnegative()}).strict(),
  z.object({kind:z.literal('goal_notifications'),goalId:z.string(),mode:z.enum(['all','critical','muted'])}).strict(),
  z.object({kind:z.literal('travel_request_decision'),id:z.string(),decision:z.enum(['accept','decline'])}).strict(),
  z.object({kind:z.literal('verify_recipient'),id:z.string(),expectedVersion:z.number().int().positive(),suffix:z.string().regex(/^\d{4}$/),acknowledged:z.literal(true)}).strict(),
  z.object({kind:z.literal('review_recipient'),id:z.string(),expectedVersion:z.number().int().positive()}).strict(),
  GoalContractChangeSchema.extend({kind:z.literal('goal_contract')}).strict(),
  z.object({kind:z.literal('portfolio_repair'),optionId:z.string().min(1),expectedTwinVersion:z.number().int().positive()}).strict(),
  z.object({ kind: z.literal('transfer'), recipientId: z.string(), recipientVersion: z.number().int(), accountId: z.string(), amountCents: money.positive(), note: z.string().max(120).default('') }).strict(),
  z.object({ kind: z.literal('split'), totalCents: money.positive(), participantIds: z.array(z.string()).min(2).max(20), accountId: z.string(), alreadyPaid: z.boolean(), dueDate: z.iso.date(), payerId:z.string().optional(), shares:z.array(z.object({recipientId:z.string(),amountCents:money}).strict()).min(2).max(20).optional() }).strict(),
  z.object({ kind: z.literal('pay_split_share'), id: z.string(), accountId:z.string() }).strict(),
  z.object({kind:z.literal('reschedule_split'),id:z.string(),expectedDueDate:z.iso.date(),dueDate:z.iso.date()}).strict(),
  z.object({ kind: z.literal('close_split'), id: z.string() }).strict(),
  z.object({ kind: z.literal('risk_profile'), level: z.number().int().min(1).max(4), tolerateLoss: z.boolean(), useByDate: z.iso.date() }).strict(),
  z.object({kind:z.literal('investment_questionnaire'),answers:InvestmentAnswersSchema}).strict(),
  z.object({ kind: z.literal('buy'), productId: z.string(), accountId: z.string(), amountCents: money.positive() }).strict(),
  z.object({ kind: z.literal('redeem'), productId: z.string(), accountId: z.string(), quantityMicro: quantity }).strict(),
  z.object({ kind: z.literal('card'), id: z.string(), action: z.enum(['lock','unlock','lost','limit','controls']), limitCents: money.optional(), online: z.boolean().optional(), overseas: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('apply_card'), product: z.enum(['travel_debit','everyday_credit']), requestedLimitCents: money.default(500000), employmentEvidence:z.enum(['available','missing']).optional() }).strict(),
  z.object({kind:z.literal('replace_card'),id:z.string()}).strict(),
  z.object({kind:z.literal('withdraw_card_application'),id:z.string()}).strict(),
  z.object({kind:z.literal('supplement_card_application'),id:z.string(),employment:z.enum(['synthetic_salaried','synthetic_freelance']),acknowledged:z.literal(true)}).strict(),
  z.object({ kind: z.literal('allocate'), goalId: z.string(), accountId: z.string(), amountCents: money }).strict(),
  z.object({ kind: z.literal('mandate'), id: z.string().optional(), goalId: z.string(), accountId: z.string(), maxPerOrderCents: money.positive(), totalCents: money.positive(), merchants: z.array(z.string()).min(1), expiresAt: z.iso.datetime() }).strict(),
  z.object({ kind: z.literal('revoke_mandate'), id: z.string() }).strict(),
  z.object({ kind: z.literal('book'), quoteIds: z.array(z.string()).min(1).max(2), accountId: z.string(), cardId: z.string(), goalId: z.string(), mandateId: z.string() }).strict(),
  z.object({ kind: z.literal('cancel_booking'), id: z.string() }).strict(),
]);
export type ServiceAction = z.infer<typeof ServiceActionSchema>;
export const MandateDraftSchema=z.object({provider:z.literal('deterministic'),status:z.enum(['draft','needs_information']),
  missing:z.array(z.string()),explanation:z.string(),draft:z.object({merchants:z.array(z.enum(['air-demo','stay-demo'])).min(1),maxPerOrderCents:money.positive(),totalCents:money.positive(),expiresOn:z.iso.date()}).nullable()}).strict();
export type MandateDraft=z.infer<typeof MandateDraftSchema>;
export const ProviderEventSchema=z.object({id:z.string().min(1).max(100),provider:z.literal('nova-sim-provider'),domain:z.enum(['investment','booking']),subjectId:z.string().min(1).max(200),revision:z.number().int().positive().max(1000000000),status:z.enum(['pending','settled','confirmed','failed']),reportedOn:z.iso.date()}).strict();
export type ProviderEvent=z.infer<typeof ProviderEventSchema>;
export const FinancialServicesSchema = z.object({
  missionCheckpoints:z.array(z.object({id:z.string(),goalId:z.string(),schemaVersion:z.union([z.literal(1),z.literal(2)]),revision:z.number().int().positive(),stateHash:z.string(),updatedOn:z.iso.date(),operationIds:z.array(z.string()),migratedFrom:z.literal(1).optional()})).default([]),
  fulfillmentRecords:z.array(z.object({eventId:z.string(),bookingId:z.string(),revision:z.number().int().positive(),status:z.enum(['fulfilled','not_fulfilled']),reportedOn:z.iso.date(),evidenceRef:z.string(),payloadHash:z.string()})).default([]),
  subscriptionCardBindings:z.array(z.object({subscriptionId:z.string(),cardId:z.string(),version:z.number().int().positive(),operationId:z.string()})).default([]),
  subscriptionCardOperations:z.array(z.object({id:z.string(),subscriptionId:z.string(),cardId:z.string(),status:z.enum(['unknown','succeeded','failed']),providerStatus:z.enum(['succeeded','failed'])})).default([]),
  goalNotices:z.array(z.object({id:z.string(),goalId:z.string(),label:z.string(),critical:z.boolean(),status:z.enum(['pending','delivered','read','cancelled']),createdOn:z.iso.date()})).default([]),
  goalNotificationPreferences:z.array(z.object({goalId:z.string(),mode:z.enum(['all','critical','muted'])})).default([]),
  travelRequests:z.array(z.object({id:z.string(),agentId:z.literal('travel-agent-demo'),goalId:z.string(),quoteIds:z.array(z.string()),status:z.enum(['received','accepted','declined','superseded']),expiresAt:z.iso.datetime(),receivedAt:z.iso.datetime(),revision:z.number().int().positive(),replacesRequestId:z.string().optional()})).default([]),
  providerEventLog:z.array(z.object({id:z.string(),payloadHash:z.string(),subjectId:z.string(),domain:z.enum(['investment','booking']),revision:z.number().int(),outcome:z.enum(['applied','stale','terminal_ignored']),reportedOn:z.iso.date()})).default([]),
  providerRevisions:z.array(z.object({subjectId:z.string(),domain:z.enum(['investment','booking']),revision:z.number().int()})).default([]),
  subscriptionNotifications:z.array(z.object({id:z.string(),actionId:z.string(),subscriptionId:z.string(),title:z.string(),dueDate:z.iso.date(),
    status:z.enum(['pending','delivered','read','cancelled']),snoozedUntil:z.iso.date().nullable(),deliveredAt:z.string().nullable(),readAt:z.string().nullable()})).default([]),
  goalContracts:z.array(GoalContractSchema).default([]),
  initialized: z.boolean().default(false),
  risk: z.object({ level: z.number().int(), tolerateLoss: z.boolean(), useByDate: z.iso.date(), expiresOn: z.iso.date(),answers:InvestmentAnswersSchema.optional() }).nullable().default(null),
  recipients: z.array(z.object({ id: z.string(), name: z.string(), phone: z.string(), alias: z.string(), suffix: z.string(), version: z.number().int(),identityStatus:z.enum(['verified','needs_review']).optional(),verifiedVersion:z.number().int().positive().optional() })).default([]),
  holds: z.array(z.object({ id: z.string(), operationId: z.string(), accountId: z.string(), goalId: z.string().nullable(), amountCents: money, status: z.enum(['active','consumed','released']) })).default([]),
  allocations: z.array(z.object({ goalId: z.string(), accountId: z.string(), amountCents: money })).default([]),
  journals: z.array(z.object({ id: z.string(), eventId: z.string(), operationId: z.string(), accountId: z.string(), amountCents: z.number().int(), date: z.iso.date(), reason: z.string() })).default([]),
  events: z.array(z.string()).default([]),
  splits: z.array(z.object({ id: z.string(), accountId: z.string(), totalCents: money, sampleLabel:z.string().max(80).optional(), alreadyPaid: z.boolean(), dueDate: z.iso.date(), payerId:z.string().optional(), participants:z.array(z.object({id:z.string(),name:z.string(),alias:z.string(),suffix:z.string(),version:z.number().int()})).optional(), dateChanges:z.array(z.object({from:z.iso.date(),to:z.iso.date(),changedOn:z.iso.date(),operationId:z.string()})).optional(), status: z.enum(['open','partial','collected','closed']), shares: z.array(z.object({ recipientId: z.string(), amountCents: money, collectedCents: money })) })).default([]),
  positions: z.array(z.object({ productId: z.string(), quantityMicro: quantity, reservedMicro: quantity, acquiredOn: z.iso.date() })).default([]),
  investments: z.array(z.object({ id: z.string(), kind: z.enum(['buy','redeem']), productId: z.string(), accountId: z.string(), amountCents: money, feeCents: money, quantityMicro: quantity, status: z.enum(['pending','settled','failed','unknown']), providerStatus: z.enum(['pending','settled','failed']),externalRevision:z.number().int().positive().optional(), settlesOn: z.iso.date(), operationId: z.string() })).default([]),
  cards: z.array(z.object({ id: z.string(), label: z.string(), suffix: z.string(), type: z.enum(['debit','credit']), accountId: z.string(), status: z.enum(['active','locked','lost']), online: z.boolean(), overseas: z.boolean(), limitCents: money, version: z.number().int() })).default([]),
  cardOperations:z.array(z.object({id:z.string(),cardId:z.string(),kind:z.enum(['card','replace_card']),status:z.enum(['unknown','succeeded','failed']),providerStatus:z.enum(['succeeded','failed']),replacementCardId:z.string().nullable(),originalVersion:z.number().int()})).default([]),
  applications: z.array(z.object({ id: z.string(), product: z.string(), requestedCents: money, approvedCents: money, status: z.enum(['under_review','approved','rejected','unknown','withdrawn','needs_information']), operationId: z.string(),providerAccepted:z.boolean().optional(),decisionReason:z.string().optional(),employmentEvidence:z.enum(['available','missing']).optional(),employment:z.enum(['synthetic_salaried','synthetic_freelance']).optional(),supplementedOn:z.iso.date().optional() })).default([]),
  mandates: z.array(z.object({ id: z.string(), goalId: z.string(), accountId: z.string(), maxPerOrderCents: money, totalCents: money, reservedCents: money, spentCents: money, merchants: z.array(z.string()), expiresAt: z.iso.datetime(), status: z.enum(['active','revoked']) })).default([]),
  quotes: z.array(z.object({ id: z.string(), merchantId: z.string(), label: z.string(), kind: z.enum(['flight','hotel']),currency:z.literal('CNY').optional(), baseCents: money, taxCents: money, feeCents: money, totalCents: money, refundable: z.boolean(), expiresAt: z.iso.datetime(),requestId:z.string().optional(),replacesQuoteId:z.string().optional(),revision:z.number().int().positive().optional(), signature: z.string() })).default([]),
  bookings: z.array(z.object({ id: z.string(), quoteId: z.string(), merchantId: z.string(), accountId: z.string(), cardId: z.string(), goalId: z.string(), mandateId: z.string(), amountCents: money, refundable: z.boolean(), operationId: z.string(), status: z.enum(['submitted','confirmed','failed','unknown','cancelled','refund_pending','refunded']), payment: z.enum(['held','captured','released','refunded']), providerStatus: z.enum(['confirmed','failed','pending']), refundOn: z.iso.date().nullable() })).default([]),
  receipts: z.array(z.object({ id: z.string(), operationId: z.string(), kind: z.string(), status: z.enum(['succeeded','pending','failed','unknown']), label: z.string(), amountCents: money, date: z.iso.date() })).default([]),
  fault: z.enum(['none','decline','timeout_before','timeout_after','partial']).default('none'),
});
export type FinancialServices = z.infer<typeof FinancialServicesSchema>;
