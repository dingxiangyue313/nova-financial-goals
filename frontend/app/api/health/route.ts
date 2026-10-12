import { env } from "cloudflare:workers";

export async function GET(){
  const checks={database:false,rateLimitStorage:false,externalAgentSigning:String((env as unknown as Record<string,unknown>).EXTERNAL_AGENT_SIGNING_SECRET??"").length>=32};
  try{
    if(env.DB){
      await env.DB.prepare("SELECT 1 AS ok FROM nova_records LIMIT 1").first();
      checks.database=true;
      await env.DB.prepare("SELECT 1 AS ok FROM nova_rate_limits LIMIT 1").first();
      checks.rateLimitStorage=true;
    }
  }catch{}
  const ready=checks.database&&checks.rateLimitStorage&&checks.externalAgentSigning;
  return Response.json({status:ready?"ready":"degraded",service:"nova-ai-banking-agent",checks,agentProvider:env.DEEPSEEK_API_KEY?"deepseek":"deterministic_fallback",timestamp:new Date().toISOString()},{status:ready?200:503,headers:{"cache-control":"no-store"}});
}
