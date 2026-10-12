import { z } from "zod";
import { GoalFlowEventSchema, NotificationPreferencesSchema } from "@backend/goal-contracts";
import { defaultNotificationPreferences } from "@backend/goal-fixtures";
import { initialGoalFlowState, transitionGoalFlow } from "@backend/goal-engine";
import { goalFlowStateMatrix } from "@backend/goal-state-matrix";
import { parseGoalWithFallback } from "@backend/goal-agent-provider";
import { enforceRateLimit, recordResponse } from "@backend/production-operations";
import { resolveFirstPartyActor, bankingAuthErrorResponse } from "@backend/banking-service-auth";
import { getTwinView } from "@backend/financial-twin-store";
import { simulateExpense } from "@backend/financial-twin-engine";
import { getGoalReadiness } from "@backend/goal-readiness";
import { buildLiveGoalCanvas } from "@backend/generative-ui";

const ContextSchema = z.enum(["home", "feasibility", "impact"]);
const PreviewSchema = z.object({
  goalId: z.string().min(1),
  amount: z.number().int().nonnegative(),
  strategy: z.enum(["adjust_contribution", "adjust_date"]),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const context = ContextSchema.safeParse(url.searchParams.get("context"));
  if (!context.success) {
    return Response.json({ permissionLevel: "recommend", initialState: initialGoalFlowState(), notificationPreferences: defaultNotificationPreferences, stateMatrix: goalFlowStateMatrix }, { headers: { "cache-control": "no-store" } });
  }
  let actor;
  try { actor = await resolveFirstPartyActor(request); }
  catch (error) { return bankingAuthErrorResponse(error); }
  try {
    const twin = await getTwinView(actor.userId);
    const goalId = url.searchParams.get("goalId") ?? twin.state.goals.find(item => item.priority > 0)?.id;
    if (!goalId || !twin.state.goals.some(item => item.id === goalId)) return Response.json({ error: "GOAL_NOT_FOUND" }, { status: 404 });
    const readiness = getGoalReadiness(twin.state, goalId, twin.forecast);
    const canvas = buildLiveGoalCanvas(twin.state, twin.forecast, goalId, context.data);
    return Response.json({ readiness, canvas, twinVersion: twin.state.version }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "GOAL_FLOW_UNAVAILABLE" }, { status: 503 });
  }
}

async function handlePost(request: Request) {
  const limited = await enforceRateLimit(request, "agent");
  if (limited) return limited;
  try {
    const body = await request.json() as { message?: string; preview?: unknown; state?: unknown; event?: unknown; preferences?: unknown };
    if (body.preview) {
      let actor;
      try { actor = await resolveFirstPartyActor(request); }
      catch (error) { return bankingAuthErrorResponse(error); }
      const parsed = PreviewSchema.safeParse(body.preview);
      if (!parsed.success) return Response.json({ error: "INVALID_PREVIEW" }, { status: 400 });
      const twin = await getTwinView(actor.userId);
      if (!twin.state.goals.some(item => item.id === parsed.data.goalId)) return Response.json({ error: "GOAL_NOT_FOUND" }, { status: 404 });
      const simulation = simulateExpense(twin.state, parsed.data.amount, undefined, parsed.data.goalId, parsed.data.strategy);
      const readiness = getGoalReadiness(twin.state, parsed.data.goalId, twin.forecast);
      const canvas = buildLiveGoalCanvas(twin.state, twin.forecast, parsed.data.goalId, "impact", simulation.impact);
      return Response.json({ readiness, canvas, impact: simulation.impact, twinVersion: twin.state.version }, { headers: { "cache-control": "no-store" } });
    }
    // Historical fixture API remains for state-matrix demos; product pages use Twin-backed mode above.
    if (body.message) {
      if (body.message.length > 800) return Response.json({ error: "目标描述不能超过 800 字。" }, { status: 400 });
      return Response.json(await parseGoalWithFallback(body.message), { headers: { "cache-control": "no-store" } });
    }
    const current = body.state ? body.state as ReturnType<typeof initialGoalFlowState> : initialGoalFlowState();
    const event = GoalFlowEventSchema.parse(body.event);
    const prefs = NotificationPreferencesSchema.parse(body.preferences ?? defaultNotificationPreferences);
    return Response.json({ state: transitionGoalFlow(current, event, prefs) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Goal Flow 请求无效" }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const started = performance.now();
  const response = await handlePost(request);
  return recordResponse(request, "goal_flow", response, started);
}
