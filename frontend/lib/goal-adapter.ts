import type { TwinView } from "@/hooks/use-financial-twin";

/** Presentation boundary: service values are integer cents and ISO dates. */
export const formatYuan = (cents: number, hidden = false) => hidden
  ? "¥••••"
  : new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);

export const goalProgress = (view: TwinView | null, goalId: string | undefined) =>
  goalId ? view?.derived.goalProgress[goalId] ?? 0 : 0;
