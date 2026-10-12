export type Decision = "execute" | "ask" | "block";

export type ExternalRequest = {
  id: string;
  merchant: string;
  category: string;
  amount: number;
  currency: string;
  requestedAt?: string;
};

export type MandateRule = {
  category: string;
  perTransactionLimit?: number;
  dailyLimit?: number;
  decisionWithinLimit?: Decision;
  decision?: Decision;
};

export type Mandate = {
  validFrom: string;
  validTo: string;
  tripTotalLimit: number;
  status: string;
  rules: MandateRule[];
};

export type ExternalAgent = { verificationState: string };

export type DecisionResult = {
  decision: Decision;
  code: string;
  explanation: string;
  checks: Array<{ label: string; status: "pass" | "ask" | "fail" }>;
};

export function forecastGoalDelay(extraSpendCents: number, recoveryPerDayCents: number) {
  if (!Number.isFinite(extraSpendCents) || extraSpendCents < 0) throw new Error("额外支出必须是非负数");
  if (!Number.isFinite(recoveryPerDayCents) || recoveryPerDayCents <= 0) throw new Error("每日补足能力必须大于 0");
  return Math.ceil(extraSpendCents / recoveryPerDayCents);
}

export function calculateSafeToSpend(input: {
  openingCheckingBalance: number;
  knownIncome: number;
  knownBills: number;
  essentialLivingSpend: number;
  safetyBuffer: number;
}) {
  return input.openingCheckingBalance + input.knownIncome - input.knownBills - input.essentialLivingSpend - input.safetyBuffer;
}

export function evaluateExternalRequest(input: {
  request: ExternalRequest;
  agent: ExternalAgent;
  mandate: Mandate;
  dailySpent?: number;
  tripSpent?: number;
}): DecisionResult {
  const { request, agent, mandate, dailySpent = 0, tripSpent = 0 } = input;
  const checks: DecisionResult["checks"] = [];

  if (agent.verificationState !== "verified") {
    return { decision:"block", code:"AGENT_UNVERIFIED", explanation:"请求方身份未通过验证，因此已阻断。", checks:[{label:"请求方身份",status:"fail"}] };
  }
  checks.push({ label:"请求方身份", status:"pass" });

  if (mandate.status !== "active") {
    return { decision:"block", code:"MANDATE_INACTIVE", explanation:"授权规则当前未生效，因此已阻断。", checks:[...checks,{label:"授权状态",status:"fail"}] };
  }
  checks.push({ label:"授权状态", status:"pass" });

  const rule = mandate.rules.find(candidate => candidate.category === request.category) ?? mandate.rules.find(candidate => candidate.category === "other");
  if (!rule || rule.decision === "block") {
    return { decision:"block", code:"CATEGORY_NOT_ALLOWED", explanation:"该消费类别不在授权范围内，因此已阻断。", checks:[...checks,{label:"消费类别",status:"fail"}] };
  }
  checks.push({ label:"消费类别", status: rule.decision === "ask" ? "ask" : "pass" });

  if (rule.decision === "ask") {
    return { decision:"ask", code:"EXPLICIT_APPROVAL_REQUIRED", explanation:"该类别要求每次获得你的明确确认，本次尚未执行。", checks };
  }
  if (rule.perTransactionLimit !== undefined && request.amount > rule.perTransactionLimit) {
    return { decision:"block", code:"PER_TRANSACTION_LIMIT_EXCEEDED", explanation:`请求金额超过该类别的单笔授权上限。`, checks:[...checks,{label:"单笔金额",status:"fail"}] };
  }
  checks.push({ label:"单笔金额", status:"pass" });
  if (rule.dailyLimit !== undefined && dailySpent + request.amount > rule.dailyLimit) {
    return { decision:"block", code:"DAILY_LIMIT_EXCEEDED", explanation:"请求将超过该类别的每日累计上限，因此已阻断。", checks:[...checks,{label:"每日累计",status:"fail"}] };
  }
  checks.push({ label:"每日累计", status:"pass" });
  if (tripSpent + request.amount > mandate.tripTotalLimit) {
    return { decision:"block", code:"TRIP_LIMIT_EXCEEDED", explanation:"请求将超过旅行全程累计上限，因此已阻断。", checks:[...checks,{label:"全程累计",status:"fail"}] };
  }
  checks.push({ label:"全程累计", status:"pass" });
  return { decision:"execute", code:"MANDATE_MATCHED", explanation:"请求方、类别、单笔、日累计和全程累计规则均已通过。", checks };
}

export function createAuditEvent(input: { eventType: string; objectId: string; status: string; timestamp?: string }) {
  return {
    id: `audit_${input.objectId}_${input.status}`,
    actor: "NOVA",
    eventType: input.eventType,
    objectId: input.objectId,
    status: input.status,
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
}
