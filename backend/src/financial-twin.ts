export type TwinEvidence = {
  id: string;
  source: "account" | "bill" | "subscription" | "goal" | "mandate" | "forecast";
  label: string;
  value: number | string;
  asOf: string;
};

export type TwinDecision = {
  decision: "execute" | "ask" | "block";
  code: string;
  headline: string;
  explanation: string;
  requestAmount: number;
  perTransactionLimit: number;
  sevenDayBalanceBefore: number;
  sevenDayBalanceAfter: number;
  safetyBuffer: number;
  availableBefore: number;
  availableAfter: number;
  remainingMandateBefore: number;
  remainingMandateAfter: number;
  goalFundingGap: number;
  checks: Array<{ label: string; status: "pass" | "fail"; detail: string }>;
  evidence: TwinEvidence[];
};

export const twinTimeline = [
  { date: "今天", label: "日常活期", kind: "balance", amount: 620000 },
  { date: "周二", label: "房租", kind: "bill", amount: -168000 },
  { date: "周三", label: "手机与云服务", kind: "subscription", amount: -18800 },
  { date: "周五", label: "基本生活支出", kind: "essential", amount: -93200 },
  { date: "第 7 天", label: "预计最低余额", kind: "forecast", amount: 340000 },
] as const;

export const twinGoals = [
  { id: "travel", name: "日本旅行", allocated: 496000, target: 800000, priority: 1 },
  { id: "emergency", name: "应急金", allocated: 1000000, target: 1200000, priority: 0 },
  { id: "learning", name: "年度学习计划", allocated: 82000, target: 180000, priority: 2 },
] as const;

export function evaluateTwinDiningRequest(requestAmount = 68000): TwinDecision {
  const perTransactionLimit = 50000;
  const sevenDayBalanceBefore = 340000;
  const safetyBuffer = 300000;
  const remainingMandateBefore = 118000;
  const sevenDayBalanceAfter = sevenDayBalanceBefore - requestAmount;
  const availableBefore = sevenDayBalanceBefore - safetyBuffer;
  const availableAfter = sevenDayBalanceAfter - safetyBuffer;
  const amountAllowed = requestAmount <= perTransactionLimit;
  const bufferPreserved = sevenDayBalanceAfter >= safetyBuffer;
  const decision = amountAllowed && bufferPreserved ? "execute" : "block";
  const goalFundingGap = Math.max(0, -availableAfter);

  const reasons = [
    !amountAllowed ? `超过餐饮单笔授权上限 ¥${perTransactionLimit / 100}` : null,
    !bufferPreserved ? `未来 7 天最低余额将降至 ¥${sevenDayBalanceAfter / 100}，低于 ¥${safetyBuffer / 100} 安全线` : null,
  ].filter(Boolean);

  return {
    decision,
    code: !amountAllowed && !bufferPreserved
      ? "MANDATE_AND_SAFETY_BUFFER_BREACH"
      : !amountAllowed
        ? "PER_TRANSACTION_LIMIT_EXCEEDED"
        : !bufferPreserved
          ? "FORECAST_SAFETY_BUFFER_BREACH"
          : "TWIN_GUARDRAILS_PASSED",
    headline: decision === "block" ? `已阻断 ¥${requestAmount / 100} 餐饮请求` : `可在授权内执行 ¥${requestAmount / 100}`,
    explanation: decision === "block"
      ? `${reasons.join("；")}，因此支付工具不会被调用。`
      : "请求同时通过授权边界和未来现金流安全检查。",
    requestAmount,
    perTransactionLimit,
    sevenDayBalanceBefore,
    sevenDayBalanceAfter,
    safetyBuffer,
    availableBefore,
    availableAfter,
    remainingMandateBefore,
    remainingMandateAfter: decision === "execute" ? remainingMandateBefore - requestAmount : remainingMandateBefore,
    goalFundingGap,
    checks: [
      { label: "餐饮单笔授权", status: amountAllowed ? "pass" : "fail", detail: `请求 ¥${requestAmount / 100} / 上限 ¥${perTransactionLimit / 100}` },
      { label: "未来 7 天安全余额", status: bufferPreserved ? "pass" : "fail", detail: `操作后 ¥${sevenDayBalanceAfter / 100} / 安全线 ¥${safetyBuffer / 100}` },
      { label: "应急金保护", status: "pass", detail: "受保护账户 ¥10,000 不参与可用资金计算" },
      { label: "旅行目标竞争", status: goalFundingGap > 0 ? "fail" : "pass", detail: goalFundingGap > 0 ? `将产生 ¥${goalFundingGap / 100} 的短期资金缺口` : "不挤占目标投入" },
    ],
    evidence: [
      { id: "ev_account", source: "account", label: "日常活期可用余额", value: 620000, asOf: "刚刚" },
      { id: "ev_bills", source: "bill", label: "未来 7 天固定账单", value: 168000, asOf: "2026-09-22" },
      { id: "ev_subscriptions", source: "subscription", label: "订阅与通讯费", value: 18800, asOf: "2026-09-22" },
      { id: "ev_essential", source: "forecast", label: "必要生活支出", value: 93200, asOf: "过去 90 天模型" },
      { id: "ev_buffer", source: "goal", label: "安全余额线", value: safetyBuffer, asOf: "用户设置" },
      { id: "ev_mandate", source: "mandate", label: "餐饮单笔授权上限", value: perTransactionLimit, asOf: "Mandate v1" },
    ],
  };
}
