# NOVA Custom Plan and Stage 04 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an exact user-authored savings plan to NOVA recommendations and replace repeated active-plan selection with an inline, atomic Stage 04 replanning flow.

**Architecture:** Keep NOVA-generated plans capped at three and model the user's exact monthly amount as a separate candidate. Add read-only preview and atomic apply domain operations shared by HTTP routes and UI, then render draft and active feasibility states separately.

**Tech Stack:** React 19, TypeScript, Express, Zod, Node test runner, Playwright.

**Spec:** User-approved plan in the Codex conversation for `main@2f28ec5`.

## Global Constraints

- Money remains integer cents and dates remain ISO strings in `shared/contracts.ts`.
- Preview actions must not mutate the Financial Twin.
- Applying a plan change is atomic, version checked, audited, and never changes transfer schedules.
- Preserve NOVA layout, navigation, color system, and mobile-frame behavior.

## Review Focus

- A delayed but affordable user plan remains selectable only with explicit target-date acceptance.
- Unaffordable or protected-fund-breaking plans remain visible but cannot be applied.
- Stale previews cannot partially update the goal.
- Existing transfer schedules remain byte-for-byte unchanged after replanning.
- Draft goals retain the first-time selection flow while active goals do not repeat it.

---

### Task 1: Plan-change contracts and domain behavior

**Files:** `shared/contracts.ts`, `server/scenario.ts`, `server/scenario.test.ts`

- [ ] Add failing tests for immutable preview, delayed custom plan, blocked unsafe plan, duplicate detection, atomic apply, stale-version rejection, and unchanged schedules.
- [ ] Add `GoalPlanChangeDraft`, candidate, preview, and selection contracts.
- [ ] Implement pure preview calculation and atomic apply functions.
- [ ] Run the focused scenario tests and commit.

### Task 2: HTTP routes and conversational user candidate

**Files:** `server/index.ts`, `server/agent-runner.ts`, `server/workspace.ts`, `server/workspace.test.ts`, `shared/contracts.ts`

- [ ] Add failing tests for preview/apply HTTP behavior and an exact user candidate alongside at most three NOVA candidates.
- [ ] Add `/api/goals/current/plan-preview` and `/api/goals/current/plan-change`.
- [ ] Mark candidates as `nova`, `user`, or `both`; merge exact duplicates and keep up to four current references.
- [ ] Confirm delayed user plans with the effective target date and remove the permanent custom calculator component.
- [ ] Run focused workspace/HTTP tests and commit.

### Task 3: Active-plan Stage 04 UI

**Files:** `src/screens/FeasibilityScreen.tsx`, `src/components/goal-plan/PlanChangePanel.tsx`, `src/App.tsx`, `tests/e2e/main-flows.spec.ts`

- [ ] Add failing browser coverage for active-plan detail, accessible Stage 04 expansion, two-step preview, cancellation, validation, and confirmation.
- [ ] Split active and draft feasibility states; retain first-time selection only for drafts.
- [ ] Build the two-step inline editor and change summary with live-region feedback and focus management.
- [ ] Apply the plan atomically, preserve schedules, and show the follow-up warning.
- [ ] Run focused browser tests and commit.

### Task 4: Regression and accessibility verification

**Files:** `tests/e2e/accessibility.spec.ts`

- [ ] Add keyboard, label, focus, dynamic-result, and 44px-target checks.
- [ ] Run typecheck, full tests, accessibility tests, end-to-end tests, and production build.
- [ ] Perform final branch review and record any rulings or deferred minors.
