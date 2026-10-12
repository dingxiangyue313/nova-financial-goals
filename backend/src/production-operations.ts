import { env } from "cloudflare:workers";
import { hmacSha256 } from "./security-architecture";
import { redactForLog,requestId } from "./operational-security";

type LimitName="agent"|"banking"|"mcp";
const limits:Record<LimitName,{variable:string;fallback:number}>={agent:{variable:"NOVA_AGENT_RPM",fallback:8},banking:{variable:"NOVA_BANKING_RPM",fallback:60},mcp:{variable:"NOVA_MCP_RPM",fallback:30}};

export async function enforceRateLimit(request:Request,name:LimitName):Promise<Response|null>{
  const db=env.DB;
  if(!db)return unavailable(request,"RATE_LIMIT_STORAGE_UNAVAILABLE");
  const {variable,fallback}=limits[name];
  const configured=Number((env as unknown as Record<string,unknown>)[variable]);
  const maximum=Number.isInteger(configured)&&configured>0?configured:fallback;
  const now=Date.now();
  const windowStart=Math.floor(now/60_000)*60_000;
  const identity=request.headers.get("cf-connecting-ip")??"unknown";
  const key=await hmacSha256("nova-rate-limit-v1",`${name}:${identity}`);
  try{
    const result=await db.prepare("INSERT INTO nova_rate_limits(key,window_start,count) VALUES(?,?,1) ON CONFLICT(key,window_start) DO UPDATE SET count=count+1 WHERE count<? RETURNING count")
      .bind(key,windowStart,maximum).first<{count:number}>();
    if(Math.random()<0.01)await db.prepare("DELETE FROM nova_rate_limits WHERE window_start<?").bind(windowStart-3_600_000).run().catch(()=>{});
    if(result)return null;
    logOperation(request,name,429,0,"rate_limited");
    return Response.json({error:{code:"RATE_LIMITED",message:"请求过于频繁，请稍后重试。",retryable:true}},{status:429,headers:{"cache-control":"no-store","retry-after":String(Math.ceil((windowStart+60_000-now)/1000)),"x-nova-request-id":requestId(request)}});
  }catch{
    logOperation(request,name,503,0,"rate_limit_storage_error");
    return unavailable(request,"RATE_LIMIT_STORAGE_UNAVAILABLE");
  }
}

function unavailable(request:Request,code:string){return Response.json({error:{code,message:"服务暂时不可用。",retryable:true}},{status:503,headers:{"cache-control":"no-store","retry-after":"30","x-nova-request-id":requestId(request)}})}

export function logOperation(request:Request,operation:string,status:number,durationMs:number,outcome="completed"){
  console.log(JSON.stringify(redactForLog({event:"http_request",requestId:requestId(request),operation,status,durationMs:Math.round(durationMs),outcome,timestamp:new Date().toISOString()})));
}

export function recordResponse(request:Request,operation:string,response:Response,startedAt:number){
  response.headers.set("x-nova-request-id",requestId(request));
  response.headers.set("cache-control","no-store");
  logOperation(request,operation,response.status,performance.now()-startedAt);
  return response;
}
