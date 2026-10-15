# NOVA Generative UI Risk Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete NOVA's governed goal canvas, safe scenario preview flow, risk preferences, and quiet weekly summaries.

**Architecture:** Extend the additive Zod contracts first, then implement pure deterministic preview and weekly-summary services, persist new artifacts in SQLite, expose narrow Express endpoints, and render them in the existing React workspace. Existing component variants and persisted messages remain valid.

**Tech Stack:** TypeScript, React 19, Express, SQLite, Zod, Node test runner, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-14-generative-ui-risk-completion.md`

## Global Constraints

- Preserve existing NOVA branding, home screen, navigation, mobile frame, API compatibility, and historical SQLite data.
- Integer cents and ISO dates only; deterministic services own all financial and risk calculations.
- DeepSeek may interpret and explain but cannot calculate, authorize, or execute.
- Every persistent write uses a server-bound action or an idempotent summary generator.
- Weekly summaries are in-app only and distinct from immediate `GoalImpactSignal` records.

## Review Focus

- A preview created on one Twin Version must fail safely after the Twin changes.
- Existing stored messages using legacy component variants must still parse and render.
- A weekly summary must not become an urgent unread risk thread or duplicate within one week.
- Quiet hours and pause settings must not suppress authorization or protected-fund safety decisions.
- Two sessions must not access each other's previews, summaries, actions, or conversations.

---

### Task 1: Shared contracts and deterministic goal preview

**Files:**
- Modify: `shared/contracts.ts`
- Create: `server/scenario.ts`
- Test: `server/scenario.test.ts`

**Interfaces:**
- Produces: `previewGoalScenario(state: DemoState, assumptions: GoalAssumptions): GoalScenarioPreview`
- Produces additive schemas for `GoalAssumptions`, `GoalScenarioPreview`, `PlanStep`, `WeeklyRiskSummary`, and `NotificationDelivery`.

- [ ] Write failing tests for preview immutability, integer amounts, at most three plans, and derived plan steps.
- [ ] Run `node --import tsx --test server/scenario.test.ts`; expect failures because contracts and service do not exist.
- [ ] Implement the additive contracts and pure preview service.
- [ ] Run the focused test and `npm test`; expect all tests to pass.
- [ ] Commit `feat: add deterministic goal scenario preview`.

### Task 2: Governed preview action and API

**Files:**
- Modify: `server/workspace.ts`, `server/index.ts`
- Test: `server/workspace.test.ts`, `server/http.test.ts`

**Interfaces:**
- Consumes: `previewGoalScenario` and `GoalAssumptions` from Task 1.
- Produces: `POST /api/agent/preview` returning validated components and a bound `actionId`.
- Extends: `POST /api/agent/action` with `apply_goal_scenario`.

- [ ] Write failing tests for preview no-write behavior, confirmation, expiry, Twin conflict, replay, and cross-session rejection.
- [ ] Run focused workspace and HTTP tests; expect endpoint/action failures.
- [ ] Implement preview orchestration and exact-parameter confirmation.
- [ ] Run focused tests and `npm test`; expect all tests to pass.
- [ ] Commit `feat: add governed what-if preview actions`.

### Task 3: Weekly summary model, persistence, and delivery policy

**Files:**
- Modify: `server/risk.ts`, `server/store.ts`, `server/index.ts`, `shared/contracts.ts`
- Test: `server/risk.test.ts`, `server/http.test.ts`, `server/workspace.test.ts`

**Interfaces:**
- Produces: `ensureWeeklyRiskSummary(sessionId, state)` with Monday-Sunday Asia/Shanghai dedupe.
- Produces: `GET /api/risk/summaries`, `POST /api/risk/summaries/ensure`, `POST /api/demo/weekly-summary`.
- Extends: `AgentThread.kind` with `summary` and `Snapshot.weeklyRiskSummaries`.

- [ ] Write failing tests for stable/trend summaries, weekly dedupe, disabled summaries, pause, quiet delivery, session isolation, and immediate-signal separation.
- [ ] Run focused tests; expect missing summary schema/store/service failures.
- [ ] Add additive SQLite migration, summary service, quiet thread creation, and endpoints.
- [ ] Run focused tests and `npm test`; expect all tests to pass.
- [ ] Commit `feat: add quiet weekly goal risk summaries`.

### Task 4: Governed canvas and editable components

**Files:**
- Modify: `src/screens/AgentWorkspaceScreen.tsx`, `src/components/AgentComponentRenderer.tsx`, `src/api.ts`
- Test: `tests/e2e/workspace.spec.ts`

**Interfaces:**
- Consumes: preview and summary APIs from Tasks 2-3.
- Produces: desktop 32/68 canvas layout, inline mobile layout, editable assumption and What-if components.

- [ ] Write failing Playwright tests for desktop canvas, mobile inline cards, assumption editing, preview, confirm, and historical component rendering.
- [ ] Run the focused Playwright spec; expect missing controls/layout failures.
- [ ] Implement the conversation drawer, Governed Canvas, editable cards, loading, conflict, and recovery states.
- [ ] Run focused Playwright and accessibility tests; expect all to pass.
- [ ] Commit `feat: complete governed goal planning canvas`.

### Task 5: Risk preference card and weekly-summary experience

**Files:**
- Modify: `src/components/AgentComponentRenderer.tsx`, `src/screens/AgentWorkspaceScreen.tsx`, `src/screens/FeasibilityScreen.tsx`, `src/App.tsx`
- Test: `tests/e2e/workspace.spec.ts`, `tests/e2e/main-flows.spec.ts`

**Interfaces:**
- Consumes: existing risk preferences API and Task 3 summaries.
- Produces: editable `notification_preference_card`, quiet summary thread UI, and fixed demo trigger.

- [ ] Write failing E2E tests for all preference fields, quiet summary behavior, dedupe, and immediate risk remaining urgent.
- [ ] Run focused E2E tests; expect missing card/summary failures.
- [ ] Implement preference editing, validation feedback, summary rendering, and demo controls.
- [ ] Run focused E2E and `npm run test:a11y`; expect all to pass.
- [ ] Commit `feat: complete goal-aware notification preferences`.

### Task 6: Documentation and complete verification

**Files:**
- Modify: `README.md`, `PRODUCT.md`
- Test: existing complete suite

**Interfaces:**
- Documents new APIs, deterministic boundaries, weekly-summary behavior, and demo flow.

- [ ] Update documentation and add final E2E coverage for the four complete stories at 360, 768, and 1440 pixels.
- [ ] Run `npm run lint`, `npm test`, `npm run test:properties`, `npm run eval:promptfoo`, `npm run build`, `npm run test:a11y`, and `npm run test:e2e`.
- [ ] Inspect `git diff --check` and tracked files for secret-like values.
- [ ] Commit `docs: document completed generative risk flows`.
