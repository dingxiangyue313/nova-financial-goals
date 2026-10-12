import { env } from "cloudflare:workers";
import { runLiveAgent,type LiveAgentTrace } from "@backend/live-agent-runtime";
import { runCandidateAgent,type CandidateAgentTrace } from "@backend/candidate-agent-runtime";
import { sha256 } from "@backend/security-architecture";

export type ShadowComparison={
  id:string;createdAt:string;baselineLatencyMs:number;candidateLatencyMs:number;
  intentMatch:boolean;entitiesMatch:boolean;toolPlanMatch:boolean;securityMatch:boolean;
  phase2Eligible:boolean;eligibilityReason:string;phase2RecommendedArchitecture:"baseline"|"candidate";
  phase3Eligible:boolean;phase3EligibilityReason:string;phase3RecommendedArchitecture:"baseline"|"candidate";
  phase4Eligible:boolean;phase4EligibilityReason:string;phase4RecommendedArchitecture:"baseline"|"candidate";
  baseline:{intent:string;tools:string[];injectionDetected:boolean;evidenceCount:number;feasible:boolean|null;tokens:number};
  candidate:{intent:string;specialist:string;tools:string[];injectionDetected:boolean;evidenceCount:number;feasible:boolean|null;tokens:number};
};

const timed=async<T>(work:()=>Promise<T>)=>{const started=performance.now();const value=await work();return {value,latencyMs:Math.round(performance.now()-started)}};
const toolNames=(trace:LiveAgentTrace)=>trace.model.toolCalls.map(call=>call.name);

export function phase2Eligibility(text:string,candidate:CandidateAgentTrace){
  if(candidate.injection.detected)return {eligible:false,reason:"SECURITY_SIGNAL"};
  if(candidate.specialist==="coach_agent")return {eligible:true,reason:"READ_ONLY_COACH"};
  const feasibilityRequest=/可行|能不能实现|是否能实现|能否实现|评估.{0,12}目标|分析.{0,12}目标/.test(text);
  const writeOrActivation=/创建|建立|激活|确认|转账|支付|扣款|授权|调整|改成|修改/.test(text);
  if(candidate.specialist==="goal_agent"&&feasibilityRequest&&!writeOrActivation)return {eligible:true,reason:"READ_ONLY_FEASIBILITY"};
  return {eligible:false,reason:"BASELINE_ONLY_INTENT"};
}

export function phase3Eligibility(text:string,candidate:CandidateAgentTrace){
  const phase2=phase2Eligibility(text,candidate);if(phase2.eligible)return phase2;
  if(candidate.injection.detected)return {eligible:false,reason:"SECURITY_SIGNAL"};
  const activationOrMoneyMovement=/激活|立即执行|确认创建|转账|支付|扣款|划款|授权|mandate/i.test(text);
  if(candidate.specialist==="goal_agent"&&candidate.model.intent.intent==="create_goal"&&!activationOrMoneyMovement)return {eligible:true,reason:"GOAL_DRAFT_ONLY"};
  return {eligible:false,reason:"BASELINE_ONLY_INTENT"};
}

export function phase4Eligibility(text:string,candidate:CandidateAgentTrace){
  const phase3=phase3Eligibility(text,candidate);if(phase3.eligible)return phase3;
  if(candidate.injection.detected)return {eligible:false,reason:"SECURITY_SIGNAL"};
  const activationOrMoneyMovement=/激活|立即执行|确认修改|确认调整|转账|支付|扣款|划款|授权|mandate/i.test(text);
  if(candidate.specialist==="goal_agent"&&candidate.model.intent.intent==="update_goal"&&!activationOrMoneyMovement)return {eligible:true,reason:"GOAL_UPDATE_DRAFT_ONLY"};
  return {eligible:false,reason:"BASELINE_ONLY_INTENT"};
}

async function persist(userId:string,comparison:ShadowComparison){
  if(!env.DB)return;
  const at=comparison.createdAt;
  await env.DB.prepare("INSERT INTO nova_records(id,user_id,kind,status,data,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
    .bind(comparison.id,userId,"agent_shadow","observed",JSON.stringify(comparison),at,at).run();
  await env.DB.prepare("INSERT INTO nova_audit(id,user_id,event_type,object_id,status,metadata,created_at) VALUES(?,?,?,?,?,?,?)")
    .bind(`audit_${crypto.randomUUID()}`,userId,"agent_shadow_compared",comparison.id,"observed",JSON.stringify({intentMatch:comparison.intentMatch,entitiesMatch:comparison.entitiesMatch,toolPlanMatch:comparison.toolPlanMatch,securityMatch:comparison.securityMatch}),at).run();
}

export async function runShadowComparison(text:string,userId:string,contextGoalId?:string){
  const [baselineSettled,candidateSettled]=await Promise.allSettled([timed(()=>runLiveAgent(text,userId)),timed(()=>runCandidateAgent(text,userId,contextGoalId))]);
  if(baselineSettled.status==="rejected")throw baselineSettled.reason;
  const baseline=baselineSettled.value;
  const candidateResult=candidateSettled.status==="fulfilled"?candidateSettled.value:null;
  const candidateError=candidateSettled.status==="rejected"?(candidateSettled.reason instanceof Error?candidateSettled.reason.message:"CANDIDATE_FAILED"):null;
  if(!candidateResult)return {baseline:baseline.value,shadow:{status:"failed" as const,error:candidateError}};
  const candidate=candidateResult.value;const baselineTools=toolNames(baseline.value);const candidateTools=toolNames(candidate);
  const eligibility=phase2Eligibility(text,candidate);
  const phase3=phase3Eligibility(text,candidate);
  const phase4=phase4Eligibility(text,candidate);
  const createdAt=new Date().toISOString();const comparison:ShadowComparison={
    id:`shadow_${(await sha256({userId,text,createdAt})).slice(0,32)}`,createdAt,baselineLatencyMs:baseline.latencyMs,candidateLatencyMs:candidateResult.latencyMs,
    intentMatch:baseline.value.model.intent.intent===candidate.model.intent.intent,
    entitiesMatch:JSON.stringify(baseline.value.model.intent.entities)===JSON.stringify(candidate.model.intent.entities),
    toolPlanMatch:JSON.stringify(baselineTools)===JSON.stringify(candidateTools),
    securityMatch:baseline.value.injection.detected===candidate.injection.detected,phase2Eligible:eligibility.eligible,eligibilityReason:eligibility.reason,phase2RecommendedArchitecture:eligibility.eligible?"candidate":"baseline",phase3Eligible:phase3.eligible,phase3EligibilityReason:phase3.reason,phase3RecommendedArchitecture:phase3.eligible?"candidate":"baseline",phase4Eligible:phase4.eligible,phase4EligibilityReason:phase4.reason,phase4RecommendedArchitecture:phase4.eligible?"candidate":"baseline",
    baseline:{intent:baseline.value.model.intent.intent,tools:baselineTools,injectionDetected:baseline.value.injection.detected,evidenceCount:baseline.value.telemetry.evidenceIds.length,feasible:baseline.value.telemetry.feasibility.planFeasible,tokens:baseline.value.telemetry.usage.totalTokens},
    candidate:{intent:candidate.model.intent.intent,specialist:candidate.specialist,tools:candidateTools,injectionDetected:candidate.injection.detected,evidenceCount:candidate.telemetry.evidenceIds.length,feasible:candidate.telemetry.feasibility.planFeasible,tokens:candidate.telemetry.usage.totalTokens},
  };
  try{await persist(userId,comparison)}catch{}
  return {baseline:baseline.value,candidate,eligibility,phase3Eligibility:phase3,phase4Eligibility:phase4,shadow:{status:"recorded" as const,id:comparison.id,differences:{intent:!comparison.intentMatch,entities:!comparison.entitiesMatch,toolPlan:!comparison.toolPlanMatch,security:!comparison.securityMatch},latencyMs:{baseline:comparison.baselineLatencyMs,candidate:comparison.candidateLatencyMs}}};
}

export async function listShadowComparisons(userId:string,limit=50){
  if(!env.DB)return [];
  const rows=await env.DB.prepare("SELECT data FROM nova_records WHERE user_id=? AND kind='agent_shadow' ORDER BY created_at DESC LIMIT ?").bind(userId,Math.min(100,Math.max(1,limit))).all<{data:string}>();
  return rows.results.map(row=>JSON.parse(row.data) as ShadowComparison);
}
