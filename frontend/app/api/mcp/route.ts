import { bankingToolDefinitions,bankingToolSchemas,type BankingToolName } from "@backend/banking-tool-contracts";
import { runBankingTool,toolErrorResponse } from "@backend/banking-tool-runtime";
import { BankingAuthError,resolveExternalAgentActor } from "@backend/banking-service-auth";
import { externalAgentTools } from "@backend/banking-tool-policy";
import { enforceRateLimit,recordResponse } from "@backend/production-operations";

type Rpc={jsonrpc?:string;id?:string|number|null;method?:string;params?:{name?:BankingToolName;arguments?:unknown}};
const rpc=(id:Rpc["id"],result:unknown)=>Response.json({jsonrpc:"2.0",id,result});
const externalDefinitions=bankingToolDefinitions.filter(tool=>externalAgentTools.has(tool.name));
const rpcError=(id:Rpc["id"],code:number,message:string,data?:unknown,status=400)=>Response.json({jsonrpc:"2.0",id,error:{code,message,data}},{status,headers:{"cache-control":"no-store"}});
export async function GET(){return Response.json({name:"NOVA · WeBank Capability Sandbox MCP",description:"面向第三方旅行、出行与电商 Agent 的受控金融工具概念层。",disclaimer:"不连接真实银行产品或资金。",protocolVersion:"2025-03-26",capabilities:{tools:{listChanged:false}}})}
async function handlePost(request:Request){
 const limited=await enforceRateLimit(request,"mcp");if(limited)return limited;
 let body:Rpc;try{body=await request.json() as Rpc}catch{return Response.json({jsonrpc:"2.0",id:null,error:{code:-32700,message:"Parse error"}},{status:400})}
 if(body.method==="initialize")return rpc(body.id,{protocolVersion:"2025-03-26",capabilities:{tools:{listChanged:false}},serverInfo:{name:"nova-webank-capability-sandbox",version:"1.1.0"}});
 if(body.method==="notifications/initialized")return new Response(null,{status:202});
 if(body.method==="tools/list")return rpc(body.id,{tools:externalDefinitions});
 if(body.method==="tools/call"){
  const name=body.params?.name;if(!name||!bankingToolSchemas[name]||!externalAgentTools.has(name))return rpcError(body.id,-32602,"Unknown or out-of-scope tool",{allowedTools:[...externalAgentTools]});
  let actor;try{actor=await resolveExternalAgentActor(request,body)}catch(error){if(error instanceof BankingAuthError)return rpcError(body.id,-32001,error.message,{code:error.code},error.status);return rpcError(body.id,-32603,"Agent authentication failed",undefined,500)}
  try{const result=await runBankingTool(name,body.params?.arguments??{},{userId:actor.userId,userConfirmed:false,actorType:"external_agent"});return rpc(body.id,{content:[{type:"text",text:JSON.stringify(result)}],structuredContent:result,isError:false,_meta:{actor:{type:actor.type,id:actor.id}}})}catch(error){const e=toolErrorResponse(error);return rpc(body.id,{content:[{type:"text",text:JSON.stringify(e.body)}],structuredContent:e.body,isError:true})}
 }
 return Response.json({jsonrpc:"2.0",id:body.id,error:{code:-32601,message:"Method not found"}},{status:404});
}
export async function POST(request:Request){const started=performance.now();const response=await handlePost(request);return recordResponse(request,"mcp",response,started);}
