# GoalGuard Risk Repair Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route GoalGuard risk repairs through the same deterministic preview, protection, confirmation, versioning, and schedule-review rules used by manual plan changes.

**Architecture:** Add a risk-repair orchestration service over `previewGoalPlanChange()` and `applyGoalPlanChange()`, with immutable previews and atomic application plus risk resolution. The impact page and NOVA risk conversations remain separate entry experiences but converge on the same service and confirmation UI.

**Tech Stack:** TypeScript 7, Express, Zod, React 19, SQLite, Node test runner, Playwright.

**Spec:** User-approved GoalGuard risk repair plan in the current Codex conversation; baseline `main@226cde946bc15f639925cc041835f668e5bd4da1`.

## Global Constraints

- Use integer cents and ISO dates in shared contracts.
- Preserve current NOVA layout, palette, Stage 04 entry, and simulation-only boundary.
- Never create, modify, cancel, or execute a transfer when changing a goal plan.
- Support risk repair only for the primary goal; reject unsupported goal scope explicitly.
- Do not add third-party dependencies or push/merge to `main` without explicit approval.

## Review Focus

- A preview produced before a Twin change must never apply afterward.
- A repeated or uncertain apply must resolve once and return the original receipt.
- A later/dismissed/resolved/stale signal must not remain executable from old UI or Agent actions.
- A changed plan must leave active and paused transfer schedules byte-for-byte unchanged.
- A risk tied to another goal must never mutate the primary goal.

---

### Task 1: Shared contracts and deterministic risk-repair service

**Files:**
- Modify: `shared/contracts.ts`
- Create: `server/risk-repair.ts`
- Create: `server/risk-repair.test.ts`

**Interfaces:**
- Produce `RiskRepairStrategy`, preview/apply/status contracts, `RiskRepairReceipt`, `previewRiskRepair()`, `applyRiskRepair()`, and risk disposition/invalidation helpers.
- Consume existing goal plan preview/application and audit/hash helpers.

- [ ] Write failing domain tests for A/B preview, blocked candidates, immutability, stale versions, date confirmation, idempotency, atomic risk resolution, schedule preservation, protected funds, and unsupported goals.
- [ ] Run the new test file and verify failures are due to missing contracts/service.
- [ ] Implement contracts and the minimal orchestration service.
- [ ] Run scenario, risk, and risk-repair tests to green.
- [ ] Commit the domain implementation.

### Task 2: HTTP API and legacy-write closure

**Files:**
- Modify: `server/index.ts`, `server/domain.ts`, `server/workspace.ts`
- Test: `server/http.test.ts`, `server/workspace.test.ts`

**Interfaces:**
- Produce `POST /api/impact/plan-preview`, `/plan-apply`, `/plan-status`.
- Restrict `/api/impact/decision` to `later|dismiss`; reject legacy A/B and Agent `resolve_impact` writes.

- [ ] Write failing HTTP/workspace tests for the new routes, replay/status lookup, later/dismiss lifecycle, and legacy bypass rejection.
- [ ] Run focused tests and verify RED.
- [ ] Implement routes and legacy-path closure using one `mutateState()` transaction per write.
- [ ] Run focused HTTP/workspace tests to green.
- [ ] Commit the API integration.

### Task 3: Impact page, home entry, and shared confirmation UI

**Files:**
- Modify: `src/App.tsx`, `src/screens/GoalImpactScreen.tsx`, `src/components/PlanChangePanel.tsx`
- Create: `src/components/PlanChangeConfirmation.tsx`
- Test: `tests/e2e/goalguard-risk-repair.spec.ts`

**Interfaces:**
- Consume risk preview/apply/status APIs.
- Produce the explanation → A/B comparison → explicit confirmation → success flow, with transfer-review and manual-adjustment exits.

- [ ] Write failing E2E tests for normal silence, A/B repair, cancellation, stale preview, later/dismiss, schedule review, and unknown-result recovery.
- [ ] Run the focused E2E file and verify RED.
- [ ] Extract shared candidate/diff/date confirmation UI and implement the impact flow.
- [ ] Filter Home to active risks; keep later risks reachable from NOVA only; retain Stage 04.
- [ ] Run focused E2E and accessibility checks to green.
- [ ] Commit the consumer flow.

### Task 4: NOVA workspace and monitor convergence

**Files:**
- Modify: `server/monitor-worker.ts`, `server/workspace.ts`, `shared/contracts.ts`
- Modify: `src/components/AgentComponentRenderer.tsx`, `src/screens/AgentWorkspaceScreen.tsx`
- Test: `server/monitor-worker.test.ts`, `server/workspace.test.ts`, `tests/e2e/workspace.spec.ts`

**Interfaces:**
- Produce a read-only risk-repair entry component whose CTA opens the common impact flow.
- Remove executable risk candidates from monitor/workspace output and dynamically disable historical entries by current risk status.

- [ ] Write failing tests proving Agent/monitor risk entries cannot apply plans directly and resolved/stale entries are not executable.
- [ ] Run focused tests and verify RED.
- [ ] Implement shared risk entry rendering and navigation.
- [ ] Run monitor/workspace/E2E tests to green.
- [ ] Commit the Agent convergence.

### Task 5: Full verification and delivery

- [ ] Add 360/390/768/1440 overflow, keyboard, focus, ARIA, and bottom-navigation coverage.
- [ ] Run `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e`, and `npm run test:a11y`.
- [ ] Restore generated report timestamps so no unrelated tracked output remains.
- [ ] Perform a fresh whole-branch code review and address all Critical/Important findings with RED→GREEN tests.
- [ ] Document the final user flow, API/state changes, manual demo steps, test results, and remaining limitations.
