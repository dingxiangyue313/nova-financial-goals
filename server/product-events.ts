import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {saveProductEvent} from './store.ts';

export const ProductEventNameSchema=z.enum(['goal_draft_confirmed','data_path_selected','import_review_completed','bill_evidence_opened','subscription_candidate_corrected','subscription_action_confirmed','goal_plan_activated','transfer_schedule_confirmed','operation_unknown_reconciled','risk_repair_applied','external_request_resolved']);
const Properties=z.object({stage:z.enum(['data','bills','subscription','planning','transfer','monitoring','handoff']).optional(),outcome:z.enum(['succeeded','failed','unknown','skipped','cancelled','reconciled','opened']).optional(),durationBucket:z.enum(['under_1m','1m_to_5m','over_5m']).optional(),sourceCount:z.number().int().min(0).max(3).optional(),errorCode:z.enum(['DATA_UPLOAD_DISABLED','DATA_FILE_TOO_LARGE','DATA_BALANCE_STALE','TWIN_VERSION_CHANGED','APPROVAL_EXPIRED','IMPORT_UNRESOLVED_ISSUES','OPERATION_UNKNOWN','NONE']).optional()}).strict();
export function recordProductEvent(sessionId:string,name:unknown,properties:unknown){const event={id:randomUUID(),name:ProductEventNameSchema.parse(name),properties:Properties.parse(properties),at:new Date().toISOString()};saveProductEvent(sessionId,event);return event;}
