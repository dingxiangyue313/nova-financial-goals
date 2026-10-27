import test from 'node:test';
import assert from 'node:assert/strict';
import { activatePlan } from './domain.ts';
import { createFixture } from './fixtures.ts';
import { bankingToolDefinitions, runBankingTool } from './banking.ts';
import { createJapanMoneyMissionFixture } from './money-mission-fixture.ts';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { verifyAuditChain } from './governance.ts';
import { buildDatedCashflowForecast } from './cashflow-forecast.ts';
import { buildMoneyMissionPlans } from './money-mission-plans.ts';

test('schedule banking tools separate read-only simulation and status from governed preparation and lifecycle', () => {
  const state = createJapanMoneyMissionFixture();
  for (const name of ['simulate_transfer_schedule', 'prepare_recurring_transfer', 'get_transfer_schedule_status',
    'pause_transfer_schedule', 'cancel_transfer_schedule']) assert.ok(bankingToolDefinitions.some(tool => tool.name === name));
  assert.equal(bankingToolDefinitions.find(tool => tool.name === 'simulate_transfer_schedule')?.annotations.readOnlyHint, true);
  assert.equal(bankingToolDefinitions.find(tool => tool.name === 'get_transfer_schedule_status')?.annotations.readOnlyHint, true);
  const forecast = buildDatedCashflowForecast(state, { accountId: 'checking', horizonEnd: state.goal.targetDate, scenario: 'baseline' });
  const plan = buildMoneyMissionPlans(state, forecast)[1];
  state.goal = { ...state.goal, selectedPlanId: plan.id, status: 'active', firstMonthContributionCents: 100000 };
  state.goals = [state.goal];
  const input = { goalId: state.goal.id, planOptionId: plan.id, forecastId: forecast.id, twinVersion: 1,
    sourceAccountId: 'checking', destinationAccountId: 'goal-wallet', amountCents: 100000, currency: 'CNY',
    recurrence: 'monthly', startDate: '2026-11-26', endDate: '2027-04-26', stopAtGoal: true,
    trigger: { type: 'salary_event', accountId: 'checking', sourceKind: 'bank', category: 'income', classification: 'salary',
      expectedAmountCents: 850000, toleranceBps: 1000, expectedDay: 25, windowStartDay: 23, graceEndDay: 27,
      graceEndTime: '23:59', executeOffsetDays: 1, executeTime: '09:00', missingEventPolicy: 'skip_no_catchup' } };
  const simulated = runBankingTool(state, 'simulate_transfer_schedule' as never, input);
  assert.deepEqual(simulated.state, state);
  const prepared = runBankingTool(state, 'prepare_recurring_transfer' as never, input);
  assert.equal(prepared.state.transferSchedulePreviews.length, 1);
  assert.equal(prepared.state.transferSchedules.length, 0);
  assert.ok(prepared.result.approvalParameters);
  assert.deepEqual(prepared.state.accounts, state.accounts);
  assert.throws(() => runBankingTool(prepared.state, 'pause_transfer_schedule' as never, { scheduleId: 'missing', approvalToken: 'no' }));
  assert.throws(() => runBankingTool(prepared.state, 'get_transfer_schedule_status' as never, { scheduleId: 'missing' }));
});

test('legacy and dated cashflow tools share the authoritative ledger and preserve compatibility fields', () => {
  const base = createJapanMoneyMissionFixture();
  const legacy = runBankingTool(base, 'forecast_cashflow', { horizonDays: 35 });
  assert.equal(legacy.result.minimumBalanceCents, 317200);
  assert.equal(legacy.result.precision, 'exact'); assert.ok(legacy.result.forecastId);
  assert.equal(legacy.result.horizonDays, 35); assert.equal(legacy.result.protectedCents, 2000000);
  assert.equal(legacy.result.projectedCheckingCents, 1167200);
  assert.equal(legacy.result.safeToSpendCents, 450000);
  const dated = runBankingTool(base, 'dated_cashflow_forecast', {
    accountId: 'checking', horizonEnd: '2026-11-30', scenario: 'baseline',
  });
  assert.equal(dated.result.id, legacy.result.id);
  assert.deepEqual(dated.state, base); assert.deepEqual(legacy.state, base);
  assert.equal(bankingToolDefinitions.find(tool => tool.name === 'dated_cashflow_forecast')?.annotations.readOnlyHint, true);
  const range = runBankingTool({ ...base, accountSnapshots: [] }, 'forecast_cashflow', { horizonDays: 35 });
  assert.equal(range.result.precision, 'range'); assert.equal(range.result.forecastId, null);
  assert.equal(range.result.projectedCheckingCents, null);
});

test('local subscription choices record all governance stages with explicit choice and stable status replay', () => {
  for (const [action, label] of [['keep', '保留'], ['remind', '提醒'], ['not_subscription', '不是订阅']]) {
    const base = createJapanMoneyMissionFixture();
    const result = runBankingTool(base, 'prepare_subscription_action', { subscriptionId: 'cloudbox-plus', action });
    assert.deepEqual(result.state.audit.map(event => event.action), ['permission', 'risk', 'execute', 'verify', 'audit']);
    assert.ok(result.state.audit.every(event => event.operationId === result.result.action.id));
    assert.match(result.state.audit[0].detail, new RegExp(`用户.*${label}`));
    assert.equal(result.state.twinVersion, base.twinVersion + 1);
    assert.ok(verifyAuditChain(result.state.audit));
    assert.deepEqual(result.state.subscriptionMerchants, base.subscriptionMerchants);
    assert.deepEqual(result.state.approvals, base.approvals);
    assert.deepEqual(result.state.receipts, base.receipts);
    assert.deepEqual(result.state.finance, base.finance);
    const queried = runBankingTool(result.state, 'get_subscription_action_status', { actionId: result.result.action.id });
    assert.deepEqual(queried.state, result.state);
    assert.deepEqual(runBankingTool(queried.state, 'get_subscription_action_status', {
      actionId: result.result.action.id }).state, result.state);
  }
});

test('subscription banking tools expose a prepared action and require user-bound cancellation approval', () => {
  const base = createJapanMoneyMissionFixture();
  const prepared = runBankingTool(base, 'prepare_subscription_action', { subscriptionId: 'cloudbox-plus', action: 'cancel' });
  assert.equal(prepared.state.subscriptionActions.length, 1);
  assert.equal(prepared.state.subscriptions[0].status, 'active');
  const approval = runBankingTool(prepared.state, 'create_approval_snapshot', {
    action: 'execute_subscription_cancellation', parameters: prepared.result.approvalParameters,
  });
  assert.throws(() => runBankingTool(approval.state, 'confirm_approval', {
    approvalId: approval.result.approvalId, snapshotHash: approval.result.snapshotHash, confirmed: true,
  }), /USER_CONFIRMATION_REQUIRED/);
  const confirmed = runBankingTool(approval.state, 'confirm_approval', {
    approvalId: approval.result.approvalId, snapshotHash: approval.result.snapshotHash, confirmed: true,
  }, { userConfirmed: true });
  const executed = runBankingTool(confirmed.state, 'execute_subscription_cancellation', {
    actionId: prepared.result.action.id, approvalToken: confirmed.result.approvalToken,
  });
  assert.equal(executed.result.action.status, 'succeeded');
  assert.equal(executed.result.receipt.nextChargeSuppressed, true);
  const status = runBankingTool(executed.state, 'get_subscription_action_status', { actionId: prepared.result.action.id });
  assert.equal(status.result.action.status, 'succeeded');
  assert.deepEqual(status.state, executed.state);
  for (const name of ['prepare_subscription_action', 'execute_subscription_cancellation', 'get_subscription_action_status'])
    assert.ok(bankingToolDefinitions.some(tool => tool.name === name));
  assert.equal(bankingToolDefinitions.find(tool => tool.name === 'get_subscription_action_status')?.annotations.readOnlyHint, false);
});

test('subscription keep, reminder and rejected classification persist without merchant calls or savings', () => {
  for (const action of ['keep', 'remind', 'not_subscription']) {
    const base = createJapanMoneyMissionFixture();
    const result = runBankingTool(base, 'prepare_subscription_action', { subscriptionId: 'cloudbox-plus', action });
    assert.equal(result.state.subscriptionActions[0].action, action);
    assert.equal(result.state.subscriptionActions[0].nextChargeSuppressed, false);
    assert.deepEqual(result.state.subscriptionMerchants, []);
    assert.equal(result.state.subscriptions[0].status, 'active');
    assert.equal(result.result.approvalParameters, null);
    const status = runBankingTool(result.state, 'get_subscription_action_status', { actionId: result.result.action.id });
    assert.equal(status.result.action.action, action);
    assert.deepEqual(status.state, result.state);
  }
});

test('HTTP subscription preparation isolates sessions, validates choices and hands cancellation to workspace confirmation',
  { timeout: 90_000 }, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nova-subscription-http-'));
    const listener = createServer();
    await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
    const address = listener.address(); assert.ok(address && typeof address !== 'string');
    const port = address.port;
    await new Promise<void>(resolve => listener.close(() => resolve()));
    const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: process.cwd(), stdio: 'ignore',
      env: { ...process.env, PORT: String(port), NODE_ENV: 'production', DEEPSEEK_API_KEY: '',
        NOVA_DB_PATH: join(directory, 'demo.sqlite'), NOVA_SESSION_SECRET: 'subscription-http-test-secret-with-enough-characters' } });
    try {
      let ready = false;
      for (let i = 0; i < 120; i++) {
        try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) { ready = true; break; } }
        catch { await new Promise(resolve => setTimeout(resolve, 250)); }
      }
      assert.equal(ready, true);
      let cookie = '';
      const call = async (path: string, body: unknown, isolated = false) => {
        const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST',
          headers: { ...(!isolated && cookie ? { Cookie: cookie } : {}), 'Content-Type': 'application/json' },
          body: JSON.stringify(body) });
        const newCookie = response.headers.get('set-cookie');
        if (!isolated && newCookie) cookie = newCookie.split(';')[0];
        return { status: response.status, cache: response.headers.get('cache-control'),
          data: response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text() };
      };
      const thread = await call('/api/agent/threads', { title: '订阅管理' });
      const schedulePreview = await call('/api/money-mission/transfer-schedules/preview', { recurrence: 'weekly' });
      assert.equal(schedulePreview.status, 400); assert.equal(schedulePreview.cache, 'no-store');
      const scheduleAction = await call('/api/money-mission/transfer-schedules/missing/action', { action: 'pause', threadId: thread.data.thread.id });
      assert.equal(scheduleAction.status, 400); assert.equal(scheduleAction.cache, 'no-store');
      const scheduleStatus = await fetch(`http://127.0.0.1:${port}/api/money-mission/transfer-schedules/missing/status`, { headers: { Cookie: cookie } });
      assert.equal(scheduleStatus.status, 400); assert.equal(scheduleStatus.headers.get('cache-control'), 'no-store');
      const prepared = await call('/api/subscriptions/sub-stream/prepare', { action: 'cancel', threadId: thread.data.thread.id });
      assert.equal(prepared.status, 200);
      assert.equal(prepared.cache, 'no-store');
      assert.equal(prepared.data.preview.action.status, 'awaiting_confirmation');
      assert.ok(prepared.data.actionId);
      assert.equal((await call('/api/subscriptions/sub-stream/prepare', { action: 'cancel', threadId: thread.data.thread.id }, true)).status, 400);
      assert.equal((await call('/api/subscriptions/missing/prepare', { action: 'keep' })).status, 400);
      assert.equal((await call('/api/subscriptions/sub-stream/prepare', { action: 'cancel' })).status, 400);
      assert.equal((await call('/api/subscriptions/sub-stream/prepare', { action: 'do-whatever' })).status, 400);
      assert.equal((await call('/api/subscriptions/sub-stream/prepare', { action: 'cancel', threadId: thread.data.thread.id,
        monthlyCents: 1 })).status, 400);
      const result = await call('/api/agent/action', { actionId: prepared.data.actionId, decision: 'confirm' });
      assert.equal(result.status, 200);
      assert.ok(result.data.message.components.some((c: { type: string; status: string }) => c.type === 'receipt' && c.status === 'failed'));
      const status = await call(`/api/subscriptions/actions/${prepared.data.preview.action.id}/status`, {});
      assert.equal(status.status, 200);
      assert.equal(status.data.action.status, 'requires_merchant');
      assert.equal(status.cache, 'no-store');
      assert.equal((await call(`/api/subscriptions/actions/${prepared.data.preview.action.id}/status`, {}, true)).status, 400);
      const fixtureScript = `import { mutateState } from './server/store.ts';
        import { createJapanMoneyMissionFixture } from './server/money-mission-fixture.ts';
        import { buildDatedCashflowForecast } from './server/cashflow-forecast.ts';
        import { buildMoneyMissionPlans } from './server/money-mission-plans.ts';
        const state = createJapanMoneyMissionFixture();
        const forecast = buildDatedCashflowForecast(state, { accountId: 'checking', horizonEnd: state.goal.targetDate, scenario: 'baseline' });
        const plan = buildMoneyMissionPlans(state, forecast)[1];
        state.goal = { ...state.goal, status: 'active', selectedPlanId: plan.id, firstMonthContributionCents: 100000 };
        state.goals = [state.goal];
        mutateState(process.env.NOVA_TEST_SESSION, () => state);
        process.stdout.write(JSON.stringify({ planId: plan.id, forecastId: forecast.id }));`;
      const seeded = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', fixtureScript], {
        cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, NOVA_DB_PATH: join(directory, 'demo.sqlite'),
          NOVA_TEST_SESSION: cookie.slice('nova_demo_sid='.length).split('.')[0] } }));
      const scheduleInput = { goalId: 'goal-japan-2027', planOptionId: seeded.planId, forecastId: seeded.forecastId, twinVersion: 1,
        sourceAccountId: 'checking', destinationAccountId: 'goal-wallet', amountCents: 100000, currency: 'CNY',
        recurrence: 'monthly', startDate: '2026-11-26', endDate: '2027-04-26', stopAtGoal: true,
        trigger: { type: 'salary_event', accountId: 'checking', sourceKind: 'bank', category: 'income', classification: 'salary',
          expectedAmountCents: 850000, toleranceBps: 1000, expectedDay: 25, windowStartDay: 23, graceEndDay: 27,
          graceEndTime: '23:59', executeOffsetDays: 1, executeTime: '09:00', missingEventPolicy: 'skip_no_catchup' } };
      const previewed = await call('/api/money-mission/transfer-schedules/preview', scheduleInput);
      assert.equal(previewed.status, 200); assert.equal(previewed.cache, 'no-store');
      const previewId = previewed.data.preview.id;
      assert.equal((await call(`/api/money-mission/transfer-schedules/${previewId}/action`, { action: 'activate' })).status, 400);
      assert.equal((await call(`/api/money-mission/transfer-schedules/${previewId}/action`, {
        action: 'activate', threadId: thread.data.thread.id }, true)).status, 400);
      const activation = await call(`/api/money-mission/transfer-schedules/${previewId}/action`, {
        action: 'activate', threadId: thread.data.thread.id });
      assert.equal(activation.status, 200);
      const activated = await call('/api/agent/action', { actionId: activation.data.actionId, decision: 'confirm' });
      assert.equal(activated.status, 200);
      const schedule = activated.data.snapshot.transferSchedules[0];
      assert.equal(schedule.status, 'active'); assert.equal(activated.data.snapshot.goal.savedCents, 200000);
      assert.equal(activated.data.snapshot.transferExecutions.length, 0);
      const replay = await call('/api/agent/action', { actionId: activation.data.actionId, decision: 'confirm' });
      assert.equal(replay.data.replayed, true); assert.deepEqual(replay.data.snapshot.receipts, activated.data.snapshot.receipts);
      const statusUrl = `http://127.0.0.1:${port}/api/money-mission/transfer-schedules/${schedule.id}/status`;
      const statusResponse = await fetch(statusUrl, { headers: { Cookie: cookie } });
      assert.equal(statusResponse.status, 200); assert.equal(statusResponse.headers.get('cache-control'), 'no-store');
      assert.deepEqual((await statusResponse.json()).schedule, schedule);
      assert.equal((await fetch(statusUrl)).status, 400);
      const pause = await call(`/api/money-mission/transfer-schedules/${schedule.id}/action`, { action: 'pause', threadId: thread.data.thread.id });
      assert.equal((await (await fetch(statusUrl, { headers: { Cookie: cookie } })).json()).schedule.status, 'active');
      const paused = await call('/api/agent/action', { actionId: pause.data.actionId, decision: 'confirm' });
      assert.equal(paused.data.snapshot.transferSchedules[0].status, 'paused');
      const resumed = await call(`/api/money-mission/transfer-schedules/${schedule.id}/action`, { action: 'resume' });
      assert.equal(resumed.status, 200); assert.equal(resumed.data.schedule.status, 'active');
      const cancel = await call(`/api/money-mission/transfer-schedules/${schedule.id}/action`, { action: 'cancel', threadId: thread.data.thread.id });
      const cancelled = await call('/api/agent/action', { actionId: cancel.data.actionId, decision: 'confirm' });
      assert.equal(cancelled.data.snapshot.transferSchedules[0].status, 'cancelled');
    } finally {
      child.kill('SIGTERM');
      await new Promise<void>(resolve => { if (child.exitCode !== null || child.signalCode) resolve(); else child.once('exit', () => resolve()); });
      rmSync(directory, { recursive: true, force: true });
    }
  });

test('tool discovery and read tools expose the same financial twin', () => {
  const names = new Set<string>(bankingToolDefinitions.map(tool => tool.name));
  for (const name of ['get_financial_snapshot', 'forecast_cashflow', 'prepare_transfer',
    'execute_transfer', 'quote_fx', 'create_mandate', 'export_audit_report']) assert.ok(names.has(name));
  const base = createFixture();
  const snapshot = runBankingTool(base, 'get_financial_snapshot', {});
  assert.equal(snapshot.result.version, 1);
  assert.equal(snapshot.result.accounts.length, 4);
  const forecast = runBankingTool(base, 'forecast_cashflow', { horizonDays: 30 });
  assert.equal(forecast.result.safeToSpendCents, 200000);
  assert.equal(forecast.result.protectedCents, 2000000);
});

test('transfer requires an immutable approval and is idempotent', () => {
  const base = activatePlan(createFixture(), 'balanced');
  const prepared = runBankingTool(base, 'prepare_transfer', {
    sourceAccountId: 'checking', destinationAccountId: 'goal-wallet', amountCents: 30000,
  });
  const draft = prepared.result;
  const snapshot = runBankingTool(prepared.state, 'create_approval_snapshot', {
    action: 'execute_transfer', parameters: { draftId: draft.draftId, snapshotId: draft.snapshotId },
  });
  const confirmed = runBankingTool(snapshot.state, 'confirm_approval', {
    approvalId: snapshot.result.approvalId, snapshotHash: snapshot.result.snapshotHash, confirmed: true,
  }, { userConfirmed: true });
  const executed = runBankingTool(confirmed.state, 'execute_transfer', {
    draftId: draft.draftId, snapshotId: draft.snapshotId,
    approvalToken: confirmed.result.approvalToken, idempotencyKey: 'transfer-1',
  });
  assert.equal(executed.result.status, 'succeeded');
  assert.equal(executed.state.finance.checkingCents, 470000);
  assert.equal(executed.state.accounts.find(account => account.id === 'goal-wallet')?.balanceCents, 380000);
  assert.equal(executed.state.twinVersion, 2);
  const replay = runBankingTool(executed.state, 'execute_transfer', {
    draftId: draft.draftId, snapshotId: draft.snapshotId,
    approvalToken: confirmed.result.approvalToken, idempotencyKey: 'transfer-1',
  });
  assert.equal(replay.state.finance.checkingCents, 470000);
  assert.equal(replay.result.operationId, executed.result.operationId);
});

test('transfer blocks stale twin snapshots and protected funds', () => {
  const base = activatePlan(createFixture(), 'balanced');
  const prepared = runBankingTool(base, 'prepare_transfer', {
    sourceAccountId: 'checking', destinationAccountId: 'goal-wallet', amountCents: 30000,
  });
  const changed = { ...prepared.state, twinVersion: 2 };
  assert.throws(() => runBankingTool(changed, 'execute_transfer', {
    draftId: prepared.result.draftId, snapshotId: prepared.result.snapshotId,
    approvalToken: 'missing', idempotencyKey: 'stale',
  }), /TWIN_VERSION_CHANGED/);
  assert.throws(() => runBankingTool(base, 'prepare_transfer', {
    sourceAccountId: 'emergency', destinationAccountId: 'checking', amountCents: 10000,
  }), /PROTECTED_ACCOUNT/);
});

test('FX quote expires and an approved quote can execute', () => {
  const base = createFixture();
  const quoted = runBankingTool(base, 'quote_fx', { fromCurrency: 'CNY', toCurrency: 'JPY', amountCents: 10000 });
  const prepared = runBankingTool(quoted.state, 'prepare_fx_order', {
    quoteId: quoted.result.quoteId, sourceAccountId: 'checking', destinationAccountId: 'jpy-wallet',
  });
  const approval = runBankingTool(prepared.state, 'create_approval_snapshot', {
    action: 'execute_fx_order', parameters: { draftId: prepared.result.draftId, quoteId: quoted.result.quoteId },
  });
  const confirmed = runBankingTool(approval.state, 'confirm_approval', {
    approvalId: approval.result.approvalId, snapshotHash: approval.result.snapshotHash, confirmed: true,
  }, { userConfirmed: true });
  const executed = runBankingTool(confirmed.state, 'execute_fx_order', {
    draftId: prepared.result.draftId, quoteId: quoted.result.quoteId,
    approvalToken: confirmed.result.approvalToken, idempotencyKey: 'fx-1',
  });
  assert.equal(executed.result.status, 'succeeded');
  assert.equal(executed.state.finance.checkingCents, 490000);
  const expired = { ...quoted.state, clock: '2026-09-22' };
  assert.throws(() => runBankingTool(expired, 'prepare_fx_order', {
    quoteId: quoted.result.quoteId, sourceAccountId: 'checking', destinationAccountId: 'jpy-wallet',
  }), /FX_QUOTE_EXPIRED/);
});

test('mandate lifecycle and audit export remain verifiable', () => {
  const base = activatePlan(createFixture(), 'balanced');
  const approval = runBankingTool(base, 'create_approval_snapshot', {
    action: 'create_mandate', parameters: {
      agentId: 'travel-agent-demo', category: 'transport', maxPerOperationCents: 50000,
      totalLimitCents: 120000, expiresAt: '2026-12-31',
    },
  });
  const confirmed = runBankingTool(approval.state, 'confirm_approval', {
    approvalId: approval.result.approvalId, snapshotHash: approval.result.snapshotHash, confirmed: true,
  }, { userConfirmed: true });
  const created = runBankingTool(confirmed.state, 'create_mandate', {
    agentId: 'travel-agent-demo', category: 'transport', maxPerOperationCents: 50000,
    totalLimitCents: 120000, expiresAt: '2026-12-31', approvalToken: confirmed.result.approvalToken,
  });
  assert.equal(created.state.mandate?.active, true);
  const updateParameters = { mandateId: created.result.mandateId, category: 'transport', maxPerOperationCents: 45000,
    totalLimitCents: 100000, expiresAt: '2026-12-20' };
  const updateApproval = runBankingTool(created.state, 'create_approval_snapshot', {
    action: 'update_mandate', parameters: updateParameters, expiresInSeconds: 300,
  });
  const updateConfirmed = runBankingTool(updateApproval.state, 'confirm_approval', {
    approvalId: updateApproval.result.approvalId, snapshotHash: updateApproval.result.snapshotHash, confirmed: true,
  }, { userConfirmed: true });
  const updated = runBankingTool(updateConfirmed.state, 'update_mandate', {
    ...updateParameters, approvalToken: updateConfirmed.result.approvalToken,
  });
  assert.equal(updated.state.mandate?.version, 2);
  const pauseApproval = runBankingTool(updated.state, 'create_approval_snapshot', {
    action: 'pause_mandate', parameters: { mandateId: created.result.mandateId }, expiresInSeconds: 300,
  });
  const pauseConfirmed = runBankingTool(pauseApproval.state, 'confirm_approval', {
    approvalId: pauseApproval.result.approvalId, snapshotHash: pauseApproval.result.snapshotHash, confirmed: true,
  }, { userConfirmed: true });
  const paused = runBankingTool(pauseConfirmed.state, 'pause_mandate', {
    mandateId: created.result.mandateId, approvalToken: pauseConfirmed.result.approvalToken,
  });
  assert.equal(paused.state.mandate?.active, false);
  assert.equal(paused.state.mandate?.version, 3);
  const report = runBankingTool(paused.state, 'export_audit_report', { format: 'json' });
  assert.equal(report.result.chainValid, true);
  assert.ok(report.result.content.includes('mandate_paused'));
});

test('goal writes share the same twin version and require explicit activation approval', () => {
  const base = createFixture();
  const created = runBankingTool(base, 'create_goal', {
    title: '冰岛旅行', targetCents: 1_200_000, targetDate: '2027-03-01', protectedCents: 2_000_000,
    quote: '我想去冰岛', flexibilityWeeks: 2,
  });
  assert.equal(created.result.twinVersion, base.twinVersion + 1);
  assert.equal(created.state.goal.status, 'draft');

  const selected = runBankingTool(created.state, 'select_goal_plan', { planId: 'balanced' });
  const approval = runBankingTool(selected.state, 'create_approval_snapshot', {
    action: 'activate_goal', parameters: { planId: 'balanced' }, expiresInSeconds: 300,
  });
  const confirmed = runBankingTool(approval.state, 'confirm_approval', {
    approvalId: approval.result.approvalId, snapshotHash: approval.result.snapshotHash, confirmed: true,
  }, { userConfirmed: true });
  const active = runBankingTool(confirmed.state, 'activate_goal', {
    planId: 'balanced', approvalToken: confirmed.result.approvalToken,
  });
  assert.equal(active.state.goal.status, 'active');
  assert.equal(active.state.goal.selectedPlanId, 'balanced');
  assert.ok(active.state.twinVersion > selected.state.twinVersion);
});

test('permission checks bind approval action and parameters without consuming the token', () => {
  const base = createFixture();
  const parameters = { draftId: 'draft-1', snapshotId: 'twin-1-2026-09-21' };
  const approval = runBankingTool(base, 'create_approval_snapshot', {
    action: 'execute_transfer', parameters, expiresInSeconds: 300,
  });
  const confirmed = runBankingTool(approval.state, 'confirm_approval', {
    approvalId: approval.result.approvalId, snapshotHash: approval.result.snapshotHash, confirmed: true,
  }, { userConfirmed: true });
  assert.equal(runBankingTool(confirmed.state, 'permission_check', {
    action: 'execute_transfer', parameters, approvalToken: confirmed.result.approvalToken,
  }).result.allowed, true);
  assert.equal(runBankingTool(confirmed.state, 'permission_check', {
    action: 'execute_fx_order', parameters, approvalToken: confirmed.result.approvalToken,
  }).result.allowed, false);
});
