import { env } from "cloudflare:workers";

const secretKeyPattern=/(api[_-]?key|authorization|signature|token|secret|approvalToken)/i;
export function redactForLog(value:unknown,depth=0):unknown{
  if(depth>6)return "[TRUNCATED]";
  if(Array.isArray(value))return value.slice(0,50).map(item=>redactForLog(item,depth+1));
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value as Record<string,unknown>).map(([key,item])=>[key,secretKeyPattern.test(key)?"[REDACTED]":redactForLog(item,depth+1)]));
  if(typeof value==="string"&&/^(?:Bearer\s+)?sk-[A-Za-z0-9_-]{16,}$/.test(value))return "[REDACTED]";
  return value;
}

export function positiveIntEnv(name:"NOVA_AGENT_RPM"|"NOVA_BANKING_RPM",fallback:number){const raw=(env as unknown as Record<string,unknown>)[name];const value=Number(raw);return Number.isInteger(value)&&value>0?value:fallback;}
export function requestId(request:Request){return request.headers.get("cf-ray")??`req_${crypto.randomUUID()}`;}
export function operationalHeaders(request:Request,startedAt:number){return {"cache-control":"no-store","x-nova-request-id":requestId(request),"server-timing":`app;dur=${Math.max(0,performance.now()-startedAt).toFixed(1)}`};}
