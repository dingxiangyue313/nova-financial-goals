import { GoalFlowEventSchema,NotificationPreferencesSchema } from "@backend/goal-contracts";
import { defaultNotificationPreferences } from "@backend/goal-fixtures";
import { initialGoalFlowState,transitionGoalFlow } from "@backend/goal-engine";
import { goalFlowStateMatrix } from "@backend/goal-state-matrix";
import { parseGoalWithFallback } from "@backend/goal-agent-provider";
import { enforceRateLimit,recordResponse } from "@backend/production-operations";

export async function GET(){return Response.json({permissionLevel:"recommend",initialState:initialGoalFlowState(),notificationPreferences:defaultNotificationPreferences,stateMatrix:goalFlowStateMatrix},{headers:{"cache-control":"no-store"}})}
async function handlePost(request:Request){const limited=await enforceRateLimit(request,"agent");if(limited)return limited;try{const body=await request.json() as {message?:string;state?:unknown;event?:unknown;preferences?:unknown};if(body.message){if(body.message.length>800)return Response.json({error:"目标描述不能超过 800 字。"},{status:400});return Response.json(await parseGoalWithFallback(body.message),{headers:{"cache-control":"no-store"}})}const current=body.state?body.state as ReturnType<typeof initialGoalFlowState>:initialGoalFlowState();const event=GoalFlowEventSchema.parse(body.event);const prefs=NotificationPreferencesSchema.parse(body.preferences??defaultNotificationPreferences);return Response.json({state:transitionGoalFlow(current,event,prefs)},{headers:{"cache-control":"no-store"}})}catch(error){return Response.json({error:error instanceof Error?error.message:"Goal Flow 请求无效"},{status:400})}}
export async function POST(request:Request){const started=performance.now();const response=await handlePost(request);return recordResponse(request,"goal_flow",response,started);}
