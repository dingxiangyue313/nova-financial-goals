import { env } from "cloudflare:workers";

export async function GET(){
  const checks={database:false,externalAgentSigning:String((env as unknown as Record<string,unknown>).EXTERNAL_AGENT_SIGNING_SECRET??"").length>=32,contracts:true};
  try{if(env.DB){await env.DB.prepare("SELECT 1 AS ok").first();checks.database=true}}catch{}
  const coreReady=checks.database&&checks.contracts;
  const status=coreReady?(checks.externalAgentSigning?"ready":"core_ready_mcp_locked"):"degraded";
  return Response.json({service:"nova-banking-sandbox",version:"1.3.0",status,checks,timestamp:new Date().toISOString()},{status:coreReady?200:503,headers:{"cache-control":"no-store"}});
}
