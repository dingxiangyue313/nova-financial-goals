import { z } from "zod";
import { runCandidateAgent } from "@backend/candidate-agent-runtime";
import { listShadowComparisons,runShadowComparison } from "@backend/agent-shadow-runtime";
import { bankingAuthErrorResponse,resolveFirstPartyActor } from "@backend/banking-service-auth";
import { env } from "cloudflare:workers";
import { enforceRateLimit,recordResponse } from "@backend/production-operations";

const RequestSchema=z.object({message:z.string().trim().min(2).max(800),architecture:z.enum(["baseline","candidate"]).optional(),contextGoalId:z.string().min(1).max(120).optional()}).strict();
async function handlePost(request:Request){
  const limited=await enforceRateLimit(request,"agent");if(limited)return limited;
  const parsed=RequestSchema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return Response.json({error:"请输入有效且不超过 800 字的财务目标。"},{status:400});
  let actor;try{actor=await resolveFirstPartyActor(request)}catch(error){return bankingAuthErrorResponse(error)}
  const userId=actor.userId;
  try{
    const evaluationMode=String((env as unknown as Record<string,unknown>).NOVA_EVALUATION_MODE??"disabled")==="enabled"&&request.headers.get("x-nova-evaluation-mode")==="true";
    if(parsed.data.architecture&&evaluationMode){const runtime=parsed.data.architecture==="candidate"?await runCandidateAgent(parsed.data.message,userId,parsed.data.contextGoalId):(await runShadowComparison(parsed.data.message,userId,parsed.data.contextGoalId)).baseline;return Response.json({architecture:parsed.data.architecture,rollout:{stage:"evaluation",reason:"CONTROLLED_EVALUATION"},intent:runtime.model.intent,message:runtime.model.summary,mode:runtime.fallback?"deterministic":"live",provider:runtime.provider,fallback:runtime.fallback,fallbackReason:runtime.fallbackReason,plan:{assumptions:runtime.model.assumptions,toolCalls:runtime.model.toolCalls},toolResults:runtime.toolResults,security:runtime.injection,telemetry:runtime.telemetry,...("specialist" in runtime?{specialist:runtime.specialist,router:(runtime as {router?:unknown}).router}:{})},{headers:{"cache-control":"no-store"}})}
    const rolloutMode=String((env as unknown as Record<string,unknown>).NOVA_AGENT_ROLLOUT??"phase4");
    const shadowRun=await runShadowComparison(parsed.data.message,userId,parsed.data.contextGoalId);
    const selectedEligibility=rolloutMode==="phase4"?shadowRun.phase4Eligibility:rolloutMode==="phase3"?shadowRun.phase3Eligibility:shadowRun.eligibility;
    const candidateEligible=["phase2","phase3","phase4"].includes(rolloutMode)&&selectedEligibility?.eligible===true&&Boolean(shadowRun.candidate);
    const runtime=candidateEligible?shadowRun.candidate!:shadowRun.baseline;const architecture=candidateEligible?"candidate":"baseline";
    return Response.json({architecture,rollout:{stage:["phase2","phase3","phase4"].includes(rolloutMode)?rolloutMode:"shadow",reason:candidateEligible?selectedEligibility?.reason:["phase2","phase3","phase4"].includes(rolloutMode)?selectedEligibility?.reason:"ROLLOUT_DISABLED"},intent:runtime.model.intent,message:runtime.model.summary,mode:runtime.fallback?"deterministic":"live",provider:runtime.provider,fallback:runtime.fallback,fallbackReason:runtime.fallbackReason,plan:{assumptions:runtime.model.assumptions,toolCalls:runtime.model.toolCalls},toolResults:runtime.toolResults,security:runtime.injection,telemetry:runtime.telemetry,shadow:shadowRun.shadow,...("specialist" in runtime?{specialist:runtime.specialist,router:(runtime as {router?:unknown}).router}:{})},{headers:{"cache-control":"no-store"}});
  }catch{return Response.json({error:"Agent Runtime 无法安全生成计划。",fallback:true},{status:502});}
}

export async function POST(request:Request){const started=performance.now();const response=await handlePost(request);return recordResponse(request,"agent",response,started);}

export async function GET(request:Request){
  let actor;try{actor=await resolveFirstPartyActor(request)}catch(error){return bankingAuthErrorResponse(error)}
  const url=new URL(request.url);const limit=Number(url.searchParams.get("limit")??20);
  const comparisons=await listShadowComparisons(actor.userId,limit);
  const summary={total:comparisons.length,candidateEligible:comparisons.filter(item=>item.phase4Eligible).length,intentDifferences:comparisons.filter(item=>!item.intentMatch).length,entityDifferences:comparisons.filter(item=>!item.entitiesMatch).length,toolPlanDifferences:comparisons.filter(item=>!item.toolPlanMatch).length,securityDifferences:comparisons.filter(item=>!item.securityMatch).length};
  return Response.json({mode:"phase4",productionArchitecture:"intent_based",candidateExecution:"read_and_goal_change_drafts",summary,comparisons},{headers:{"cache-control":"no-store"}});
}
