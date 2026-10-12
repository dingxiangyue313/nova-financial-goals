import { env } from "cloudflare:workers";
import { hmacSha256,verifyHmacSignature } from "@backend/security-architecture";

export type BankingActor={type:"user"|"external_agent"|"sandbox";id:string;userId:string};

export class BankingAuthError extends Error{
  constructor(public code:string,message:string,public status=401){super(message)}
}

const clean=(value:string|null,max=128)=>value?.trim().slice(0,max)??"";

export async function resolveFirstPartyActor(request:Request):Promise<BankingActor>{
  const authenticated=clean(request.headers.get("oai-authenticated-user-id"));
  if(authenticated)return {type:"user",id:authenticated,userId:authenticated};
  const sandboxSession=clean(request.headers.get("x-nova-sandbox-session"));
  if(!sandboxSession)throw new BankingAuthError("AUTH_REQUIRED","缺少可信用户会话；概念测试请提供 x-nova-sandbox-session。",401);
  const sessionHash=(await hmacSha256("nova-sandbox-namespace",sandboxSession)).slice(0,32);
  return {type:"sandbox",id:`sandbox_${sessionHash}`,userId:`sandbox_${sessionHash}`};
}

type McpEnvelope={agentId:string;resourceOwner:string;timestamp:string;nonce:string;body:unknown};

export async function resolveExternalAgentActor(request:Request,body:unknown):Promise<BankingActor>{
  const agentId=clean(request.headers.get("x-nova-agent-id"));
  const resourceOwner=clean(request.headers.get("x-nova-resource-owner"));
  const timestamp=clean(request.headers.get("x-nova-timestamp"));
  const nonce=clean(request.headers.get("x-nova-nonce"));
  const signature=clean(request.headers.get("x-nova-signature"));
  if(!agentId||!resourceOwner||!timestamp||!nonce||!signature)throw new BankingAuthError("AGENT_AUTH_REQUIRED","MCP tools/call 缺少签名身份头。",401);
  if(nonce.length<16)throw new BankingAuthError("AGENT_NONCE_INVALID","Agent nonce 至少需要 16 个字符。",400);
  const requestTime=Date.parse(timestamp);
  if(!Number.isFinite(requestTime)||Math.abs(Date.now()-requestTime)>300_000)throw new BankingAuthError("AGENT_REQUEST_EXPIRED","Agent 请求时间戳超过 5 分钟。",401);
  const secret=String((env as unknown as Record<string,unknown>).EXTERNAL_AGENT_SIGNING_SECRET??"");
  if(secret.length<32)throw new BankingAuthError("AGENT_AUTH_NOT_CONFIGURED","服务端尚未配置有效的外部 Agent 签名密钥。",503);
  const envelope: McpEnvelope={agentId,resourceOwner,timestamp,nonce,body};
  if(!await verifyHmacSignature(secret,envelope,signature))throw new BankingAuthError("AGENT_SIGNATURE_INVALID","外部 Agent 请求签名无效。",403);
  if(!env.DB)throw new BankingAuthError("DATABASE_UNAVAILABLE","无法验证请求重放状态。",503);
  const nonceId=`mcp_nonce_${await hmacSha256(secret,{agentId,nonce})}`;
  try{
    const at=new Date().toISOString();
    await env.DB.prepare("INSERT INTO nova_records(id,user_id,kind,status,data,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
      .bind(nonceId,resourceOwner,"mcp_nonce","consumed",JSON.stringify({agentId,nonce,timestamp}),at,at).run();
  }catch{
    throw new BankingAuthError("AGENT_REPLAY_DETECTED","检测到重复的 MCP nonce；不会再次调用工具。",409);
  }
  return {type:"external_agent",id:agentId,userId:resourceOwner};
}

export function bankingAuthErrorResponse(error:unknown){
  if(error instanceof BankingAuthError)return Response.json({error:{code:error.code,message:error.message,retryable:false}},{status:error.status,headers:{"cache-control":"no-store"}});
  return Response.json({error:{code:"AUTH_INTERNAL_ERROR",message:"身份校验失败。",retryable:true}},{status:500,headers:{"cache-control":"no-store"}});
}
