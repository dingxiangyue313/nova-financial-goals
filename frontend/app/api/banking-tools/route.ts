import { bankingToolDefinitions,bankingToolSchemas,type BankingToolName } from "@backend/banking-tool-contracts";
import { runBankingTool,toolErrorResponse } from "@backend/banking-tool-runtime";
import { bankingAuthErrorResponse,resolveFirstPartyActor } from "@backend/banking-service-auth";
import { enforceRateLimit,recordResponse } from "@backend/production-operations";

async function context(request:Request){const actor=await resolveFirstPartyActor(request);const userConfirmed=request.headers.get("x-nova-user-confirmed")==="true";return {userId:actor.userId,userConfirmed,actorType:actor.type};}
export async function GET(){return Response.json({name:"NOVA · WeBank Capability Sandbox",version:"1.2.0",status:"ready",isolation:"authenticated user or hashed sandbox session",idempotency:"per-user idempotency key + input hash",governance:["approval_snapshot","permission","risk","audit"],protocols:["REST","MCP JSON-RPC 2.0"],disclaimer:"微众银行挑战赛概念接口；不连接真实银行产品或资金。",platformPrinciple:"用户授权的数据范围与执行边界优先于模型能力。",tools:bankingToolDefinitions},{headers:{"cache-control":"no-store"}})}
async function handlePost(request:Request){
 const limited=await enforceRateLimit(request,"banking");if(limited)return limited;
 let ctx;try{ctx=await context(request)}catch(error){return bankingAuthErrorResponse(error)}
 try{const body=await request.json() as {tool?:BankingToolName;input?:unknown};if(!body.tool||!bankingToolSchemas[body.tool])return Response.json({error:{code:"UNKNOWN_TOOL",message:"未知工具。",retryable:false,nextSafeAction:"先读取工具清单。"}},{status:404});const result=await runBankingTool(body.tool,body.input??{},ctx);return Response.json({tool:body.tool,result},{headers:{"cache-control":"no-store"}})}catch(error){const e=toolErrorResponse(error);return Response.json(e.body,{status:e.status,headers:{"cache-control":"no-store"}})}
}
export async function POST(request:Request){const started=performance.now();const response=await handlePost(request);return recordResponse(request,"banking",response,started);}
