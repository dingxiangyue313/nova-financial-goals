# NOVA Custom Plan and Stage 04 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an exact user-authored savings plan to NOVA recommendations and replace repeated active-plan selection with a dedicated, atomic Stage 04 replanning page.

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

- [x] Add failing tests for immutable preview, delayed custom plan, blocked unsafe plan, duplicate detection, atomic apply, stale-version rejection, and unchanged schedules.
- [x] Add `GoalPlanChangeDraft`, candidate, preview, and selection contracts.
- [x] Implement pure preview calculation and atomic apply functions.
- [x] Run the focused scenario tests and commit.

### Task 2: HTTP routes and conversational user candidate

**Files:** `server/index.ts`, `server/agent-runner.ts`, `server/workspace.ts`, `server/workspace.test.ts`, `shared/contracts.ts`

- [x] Add failing tests for preview/apply HTTP behavior and an exact user candidate alongside at most three NOVA candidates.
- [x] Add `/api/goals/current/plan-preview` and `/api/goals/current/plan-change`.
- [x] Mark candidates as `nova`, `user`, or `both`; merge exact duplicates and keep up to four current references.
- [x] Confirm delayed user plans with the effective target date and remove the permanent custom calculator component.
- [x] Run focused workspace/HTTP tests and commit.

### Task 3: Active-plan Stage 04 UI

**Files:** `src/screens/FeasibilityScreen.tsx`, `src/screens/PlanChangeScreen.tsx`, `src/components/PlanChangePanel.tsx`, `src/App.tsx`, `tests/e2e/plan-change.spec.ts`

- [x] Add failing browser coverage for active-plan detail, accessible Stage 04 navigation, two-step preview, cancellation, validation, and confirmation.
- [x] Split active and draft feasibility states; retain first-time selection only for drafts.
- [x] Make Stage 04 visually match stages 01–03 while navigating to a dedicated next-level page; build the two-step editor and change summary with live-region feedback and focus management.
- [x] Apply the plan atomically, preserve schedules, and show the follow-up warning.
- [x] Run focused browser tests and commit.

### Task 4: Regression and accessibility verification

**Files:** `tests/e2e/accessibility.spec.ts`

- [x] Add keyboard, label, focus, dynamic-result, and 44px-target checks.
- [x] Run typecheck, full tests, accessibility tests, end-to-end tests, and production build.
- [x] Perform final branch review and record any rulings or deferred minors.
