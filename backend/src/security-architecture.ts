export type SecurityDemoScenario = "valid" | "tampered_amount" | "replay" | "expired_mandate" | "invalid_signature" | "high_risk" | "timeout";

export type SecurityDemoResult = {
  scenario: SecurityDemoScenario;
  outcome: "allowed" | "blocked" | "manual_review" | "unknown";
  code: string;
  title: string;
  explanation: string;
  approvalHash: string;
  operationId: string;
  layers: Array<{ name: string; status: "pass" | "fail" | "unknown"; evidence: string }>;
  audit: string[];
};

export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function sha256(value: unknown) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalize(value)));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256(secret: string, value: unknown) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonicalize(value)));
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyHmacSignature(secret: string, value: unknown, signature: string) {
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = await hmacSha256(secret, value);
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ signature.toLowerCase().charCodeAt(index);
  return difference === 0;
}

const demoHash = "sha256:8cb1f9d4…f842";
const demoOperation = "op_security_demo_001";

export function runSecurityDemo(scenario: SecurityDemoScenario): SecurityDemoResult {
  const base = {
    scenario,
    approvalHash: demoHash,
    operationId: demoOperation,
    layers: [
      { name: "Agent Identity", status: "pass" as const, evidence: "HMAC-SHA256 签名有效 · agent_wandermate_001" },
      { name: "Approval Snapshot", status: "pass" as const, evidence: "金额、账户、日期与确认时哈希一致" },
      { name: "Permission", status: "pass" as const, evidence: "Mandate v3 有效且未撤销" },
      { name: "Risk", status: "pass" as const, evidence: "安全余额、频率与额度检查通过" },
      { name: "Idempotency", status: "pass" as const, evidence: "首次使用 idem_security_001" },
    ],
    audit: ["request_received", "signature_verified", "approval_hash_verified", "permission_passed", "risk_passed"],
  };
  if (scenario === "tampered_amount") return { ...base, outcome:"blocked", code:"APPROVAL_SNAPSHOT_CHANGED", title:"篡改攻击已拒绝", explanation:"用户确认的是 ¥280，攻击请求把金额改为 ¥2,800。服务端重新计算 SHA-256 后不匹配，原授权立即失效，工具未调用。", layers:base.layers.map(layer=>layer.name==="Approval Snapshot"?{...layer,status:"fail",evidence:"expected 8cb1…f842 / received 2f91…a107"}:layer), audit:[...base.audit.slice(0,2),"approval_hash_mismatch","request_blocked"] };
  if (scenario === "replay") return { ...base, outcome:"blocked", code:"REPLAY_DETECTED", title:"重放攻击已拒绝", explanation:"相同 nonce 与幂等键已绑定原 Operation。系统返回原凭证，不会再次扣款。", layers:base.layers.map(layer=>layer.name==="Idempotency"?{...layer,status:"fail",evidence:"nonce 已使用 · 返回 op_security_demo_001"}:layer), audit:["request_received","replay_detected","original_operation_returned"] };
  if (scenario === "expired_mandate") return { ...base, outcome:"blocked", code:"MANDATE_EXPIRED", title:"过期授权已拒绝", explanation:"Mandate v2 已过期，且当前有效版本为 v3。旧版本不能继续授权任何操作。", layers:base.layers.map(layer=>layer.name==="Permission"?{...layer,status:"fail",evidence:"v2 expired / active version v3"}:layer), audit:["request_received","mandate_version_checked","request_blocked"] };
  if (scenario === "invalid_signature") return { ...base, outcome:"blocked", code:"AGENT_SIGNATURE_INVALID", title:"伪造 Agent 请求已拒绝", explanation:"请求正文与 HMAC-SHA256 签名不一致，身份校验在 Permission 之前失败。", layers:base.layers.map(layer=>layer.name==="Agent Identity"?{...layer,status:"fail",evidence:"签名校验失败 · 未进入资金工具"}:layer), audit:["request_received","signature_verification_failed","request_blocked"] };
  if (scenario === "high_risk") return { ...base, outcome:"manual_review", code:"MANUAL_REVIEW_REQUIRED", title:"已转人工复核", explanation:"大额、异常设备或受保护资金影响使风险升级。操作被冻结，客服只能复核，不能替用户确认。", layers:base.layers.map(layer=>layer.name==="Risk"?{...layer,status:"unknown",evidence:"风险分 92 / 阈值 80 · case review_001"}:layer), audit:[...base.audit.slice(0,4),"manual_review_created"] };
  if (scenario === "timeout") return { ...base, outcome:"unknown", code:"OPERATION_STATUS_UNKNOWN", title:"状态未知，不自动重试", explanation:"工具超时后保留原 Operation ID，只允许查询最新状态，禁止生成新幂等键重复执行。", layers:base.layers.map(layer=>layer.name==="Idempotency"?{...layer,status:"unknown",evidence:"锁定 op_security_demo_001，等待状态查询"}:layer), audit:[...base.audit,"tool_timeout","status_query_required"] };
  return { ...base, outcome:"allowed", code:"ALL_GUARDS_PASSED", title:"服务端守卫全部通过", explanation:"签名、快照、权限、风险和幂等检查全部通过后，工具才获得执行权限。", audit:[...base.audit,"tool_executed","receipt_sealed"] };
}

