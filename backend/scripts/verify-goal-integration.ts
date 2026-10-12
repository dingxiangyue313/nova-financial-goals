import assert from "node:assert/strict";
import { createInitialTwin, forecastTwin, simulateExpense, applyTwinAction } from "../src/financial-twin-engine";
import { getGoalReadiness } from "../src/goal-readiness";
import { buildLiveGoalCanvas, GeneratedCanvasSchema } from "../src/generative-ui";

const goalId = "goal_japan_001";
const initial = createInitialTwin();
const normal = getGoalReadiness(initial, goalId);
assert.equal(normal.status, "on_track");
assert.equal(normal.selectedPlan, null);
assert.equal(normal.options.length, 3);
assert.equal(GeneratedCanvasSchema.safeParse(buildLiveGoalCanvas(initial, forecastTwin(initial), goalId, "feasibility")).success, true);
assert.throws(() => applyTwinAction(initial, { type: "activate_goal", goalId }), /GOAL_PLAN_NOT_SELECTED/);

const insufficient = structuredClone(initial);
insufficient.cashflows = [];
assert.equal(getGoalReadiness(insufficient, goalId).status, "insufficient_data");

const atRisk = structuredClone(initial);
const checking = atRisk.accounts.find(account => account.type === "checking");
assert.ok(checking);
checking.balance -= normal.availableMonthly - 70_000;
assert.equal(getGoalReadiness(atRisk, goalId).status, "at_risk");

const impossible = structuredClone(initial);
const lowChecking = impossible.accounts.find(account => account.type === "checking");
assert.ok(lowChecking);
lowChecking.balance = impossible.safetyBuffer;
assert.equal(getGoalReadiness(impossible, goalId).status, "infeasible");

const small = simulateExpense(initial, 5_000, undefined, goalId);
assert.equal(small.impact.qualifies, false);
const significant = simulateExpense(initial, 500_000, undefined, goalId, "adjust_date");
assert.equal(significant.impact.qualifies, true);
assert.ok(significant.impact.completionDelayDays > 0);
assert.equal(GeneratedCanvasSchema.safeParse(buildLiveGoalCanvas(initial, forecastTwin(initial), goalId, "impact", significant.impact)).success, true);

const selected = applyTwinAction(initial, { type: "select_goal_plan", goalId, plan: "balanced" });
assert.equal(selected.goals.find(goal => goal.id === goalId)?.selectedPlan, "balanced");
const activated = applyTwinAction(selected, { type: "activate_goal", goalId });
assert.equal(activated.goals.find(goal => goal.id === goalId)?.status, "active");

console.log("Goal integration checks passed: insufficient, normal, at risk, infeasible, impact, selection, activation, schema.");
