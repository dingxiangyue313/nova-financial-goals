import { createHash } from 'node:crypto';
import { isRefundRow, refundMatches } from './refund-links.ts';
import { BillInvestigationBriefSchema, BillEvidenceDetailSchema, BillPeriodInputSchema, type BillBrief, type DemoState,
  type BillEvidenceDetail, type BillInvestigationBrief, type EvidenceRef, type NormalizedStatementRow } from '../shared/contracts.ts';

const calculationVersion = 'bill-investigation-v2' as const;

const categories = new Set(['dining', 'dining_delivery', 'housing', 'transport', 'subscriptions',
  'utilities', 'insurance', 'shopping', 'health', 'education', 'entertainment', 'income', 'transfer']);
const merchants: Record<string, { id: string; label: string }> = {
  cloudbox: { id: 'cloudbox-plus', label: 'CloudBox Plus' },
  'cloudbox-plus': { id: 'cloudbox-plus', label: 'CloudBox Plus' },
  cafe: { id: 'cafe', label: '餐饮商户' }, rent: { id: 'rent', label: '房租' },
  transport: { id: 'transport', label: '交通商户' },
};
const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
const monthName = (index: number) => `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}`;
const ref = (row: NormalizedStatementRow) => `evidence-${row.id}`;
const unique = <T>(values: T[]) => [...new Set(values)];
const commonLimitations = ['账单只反映已提供的交易，不证明全部账户和交易均已覆盖',
  '付款频率不能证明产品使用情况；是否仍需服务须由用户确认',
  '支出变化是待核实的关注项；不能据此判断交易性质或计算目标完成日期'];
const safeCategory = (row: NormalizedStatementRow) => categories.has(row.category) ? row.category : 'unclassified';
const safeMerchant = (row: NormalizedStatementRow) => row.merchantId && Object.hasOwn(merchants, row.merchantId)
  ? merchants[row.merchantId] : null;

/** Reconstruct retained reconciliation pairs server-side; descriptions are never returned. */
function refundPairs(rows: NormalizedStatementRow[]) {
  const pairs = new Map<string, NormalizedStatementRow>();
  for (const refund of rows) {
    if (refund.excludedReason !== 'refund_match' || !isRefundRow(refund)) continue;
    const debit = rows.find(row => row.excludedReason === 'refund_match' && !pairs.has(row.id) &&
      row.accountId === refund.accountId && row.currency === refund.currency && row.date <= refund.date &&
      refundMatches(refund, row) && row.amountCents === -refund.amountCents);
    if (debit) { pairs.set(refund.id, debit); pairs.set(debit.id, refund); }
  }
  return pairs;
}

function committedRows(state: DemoState) {
  const batches = new Set(state.statementImportBatches.filter(batch => batch.status === 'committed').map(batch => batch.id));
  const ids = new Set(state.evidenceRefs.map(item => item.id));
  return state.normalizedStatementRows.filter(row => batches.has(row.batchId) && ids.has(ref(row)) && row.date <= state.clock);
}

/** No raw labels, descriptions, original values or corrections cross this evidence boundary. */
export function inspectEvidence(state: DemoState, evidenceId: string): BillEvidenceDetail {
  const rows = committedRows(state);
  const row = rows.find(item => ref(item) === evidenceId);
  const batch = state.statementImportBatches.find(item => item.status === 'committed' && `evidence-${item.id}` === evidenceId);
  if (!row && !batch) throw new Error('EVIDENCE_NOT_FOUND');
  const pair = row ? refundPairs(rows).get(row.id) : undefined;
  const classification = row && row.amountCents > 0 && pair ? pair : row;
  return BillEvidenceDetailSchema.parse({ id: evidenceId, claimType: 'fact', sourceKind: 'import_batch',
    sourceId: row?.batchId ?? batch!.id, dataAsOf: row?.date ?? batch!.coverageEnd,
    label: row ? row.excludedReason === 'refund_match' ? '已确认账单交易（退款按各自发生日期计入）'
      : row.excludedReason ? '已确认账单交易（不计入支出）' : '已确认账单交易' : '已确认账单批次',
    confidence: row?.confidence ?? 1, sourceRefs: [evidenceId, ...(pair ? [ref(pair)] : [])],
    twinVersion: state.twinVersion, calculationVersion,
    transaction: row ? { id: row.id, rowId: row.id, batchId: row.batchId, rowNumber: row.rowNumber,
      accountId: row.accountId, date: row.date, amountCents: row.amountCents, currency: row.currency,
      merchantId: classification ? safeMerchant(classification)?.id ?? null : null,
      category: classification ? safeCategory(classification) : 'unclassified', excludedReason: row.excludedReason,
      refundPairEvidenceId: pair ? ref(pair) : null } : null,
    limitations: [...commonLimitations.slice(0, 1), ...(row?.excludedReason === 'refund_match' ? ['退款与原扣款按各自发生日期计入；不回溯抹去原期支出']
      : row?.excludedReason ? ['已按对账规则排除'] : []),
      ...(row && Object.keys(row.correctedValues).length ? ['含用户确认的修正值'] : [])] });
}

/** Pure investigation over confirmed normalized history; never changes financial authority. */
export function buildBillBrief(state: DemoState, input: { periodStart: string; periodEnd: string }): BillInvestigationBrief {
  const parsed = BillPeriodInputSchema.safeParse(input);
  if (!parsed.success) throw new Error('BILL_INVALID_PERIOD');
  const { periodStart, periodEnd } = parsed.data;
  const all = committedRows(state).filter(row => row.date <= periodEnd && row.currency === 'CNY');
  const pairs = refundPairs(all);
  const usable = all.filter(row => !row.excludedReason || row.excludedReason === 'refund_match');
  const windowRows = all.filter(row => row.date >= periodStart);
  const current = usable.filter(row => row.date >= periodStart);
  const expenses = current.filter(row => row.amountCents < 0);
  const refunds = current.filter(row => row.amountCents > 0 && row.excludedReason === 'refund_match');
  const accounting = (rows: NormalizedStatementRow[]) => rows.filter(row => row.amountCents < 0 ||
    row.excludedReason === 'refund_match' && row.amountCents > 0);
  const net = (rows: NormalizedStatementRow[]) => accounting(rows).reduce((sum, row) => sum - row.amountCents, 0);
  const categoryOf = (row: NormalizedStatementRow) => safeCategory(row.amountCents > 0 && pairs.has(row.id) ? pairs.get(row.id)! : row);
  // Only refund credits need the earlier debit to substantiate their classification. A debit never cites a later refund.
  const withPairs = (rows: NormalizedStatementRow[]) => unique(rows.flatMap(row =>
    row.amountCents > 0 && pairs.has(row.id) ? [row, pairs.get(row.id)!] : [row]));
  const start = monthIndex(periodStart); const end = monthIndex(periodEnd); const width = end - start + 1;
  const present = new Set(usable.map(row => monthIndex(row.date)));
  const missing = Array.from({ length: width }, (_, i) => start + i).filter(index => !present.has(index));
  const historyStart = width === 1 ? Math.max(start - 3, Math.min(start, ...usable.map(row => monthIndex(row.date)))) : start - width;
  const baselineMonths = Array.from({ length: start - historyStart }, (_, i) => historyStart + i);
  const baselineMissing = baselineMonths.filter(index => !present.has(index));
  const prior = accounting(usable.filter(row => monthIndex(row.date) >= historyStart && monthIndex(row.date) < start));
  const dataAsOf = all.map(row => row.date).sort().at(-1) ?? state.clock;
  const limitations = [...commonLimitations, '原扣款和匹配退款按各自发生日期计入；总支出和类别支出最低为零，退款超过支出的部分保留在有符号净支出中'];
  if (missing.length || baselineMissing.length) limitations.push(`缺失月份：${unique([...baselineMissing, ...missing]).map(monthName).join('、')}；不将缺失数据当作零支出`);
  if (!baselineMonths.length) limitations.push('缺少可比较的历史月份，无法建立支出基线');
  if (periodEnd > state.clock) limitations.push('报告截止日晚于当前模拟日期，只汇总已发生的交易');
  if (periodStart.slice(8) !== '01' || Number(periodEnd.slice(8)) !== new Date(Date.UTC(Number(periodEnd.slice(0, 4)), Number(periodEnd.slice(5, 7)), 0)).getUTCDate())
    limitations.push('报告包含不完整月份，与完整历史月份的比较不代表最终月支出');
  if (!windowRows.length) limitations.push('当前窗口没有已确认的交易证据');
  const sources = unique(all.map(ref));
  const confidence = (rows: NormalizedStatementRow[]) => rows.length ? Math.min(...rows.map(row => row.confidence)) : 0;
  const metadata = (rows: NormalizedStatementRow[], extra: string[] = []) => ({ dataAsOf,
    sourceRefs: unique(withPairs(rows).map(ref)), confidence: confidence(withPairs(rows)), limitations: [...limitations, ...extra] });
  const categoryNames = unique(accounting(current).map(categoryOf));
  const categoryResults = categoryNames.map(category => {
    const rows = accounting(current).filter(row => categoryOf(row) === category);
    return { category, amountCents: Math.max(0, net(rows)),
      transactionCount: rows.filter(row => row.amountCents < 0).length, ...metadata(rows) };
  }).sort((left, right) => right.amountCents - left.amountCents || left.category.localeCompare(right.category));
  const changes: BillBrief['changes'] = [];
  if (baselineMonths.length && !missing.length && !baselineMissing.length) {
    for (const category of unique([...prior, ...accounting(current)].map(categoryOf))) {
      const baseline = prior.filter(row => categoryOf(row) === category);
      const now = accounting(current).filter(row => categoryOf(row) === category);
      const baselineCents = Math.max(0, Math.round(net(baseline) / baselineMonths.length * width));
      const currentCents = Math.max(0, net(now));
      changes.push({ category, baselineStart:monthName(historyStart)+'-01',baselineEnd:new Date(Date.UTC(Number(periodStart.slice(0,4)),Number(periodStart.slice(5,7))-1,0)).toISOString().slice(0,10), baselineCents, currentCents, increaseCents: currentCents - baselineCents,
        ...metadata([...baseline, ...now], ['基线取已提供的连续历史月份月均支出，按报告月份数计算；不是预测']) });
    }
  }
  const subscriptionCandidates: BillBrief['subscriptionCandidates'] = [];
  const priceChanges: Array<{ merchantId: string; differenceCents: number; rows: NormalizedStatementRow[] }> = [];
  for (const merchant of unique(expenses.filter(row => !row.excludedReason)
    .map(row => row.merchantId).filter((id): id is string => !!id))) {
    const known = Object.hasOwn(merchants, merchant) ? merchants[merchant] : null;
    if (!known) continue; // Unrecognized identifiers may contain arbitrary user-supplied text.
    const rows = usable.filter(row => !row.excludedReason && row.merchantId === merchant && row.amountCents < 0).sort((a, b) => a.date.localeCompare(b.date));
    if (rows.length < 2) continue;
    const months = rows.map(row => monthIndex(row.date));
    const monthly = rows.every((row, i) => !i || (months[i] === months[i - 1] + 1 &&
      Math.abs(Number(row.date.slice(8)) - Number(rows[i - 1].date.slice(8))) <= 3));
    const stableAmount = rows.every(row => row.amountCents === rows[0].amountCents);
    const subscriptionId = state.subscriptions.find(item => item.id === known.id)?.id ?? null;
    if (rows.some(row => 'category' in row.correctedValues && safeCategory(row) !== 'subscriptions')) continue;
    if (!subscriptionId && !rows.every(row => safeCategory(row) === 'subscriptions')) continue;
    if (!monthly && !subscriptionId) continue;
    if (!rows.every(row => safeCategory(row) === 'subscriptions') && !stableAmount) continue;
    const last = rows.at(-1)!;
    const nextMonth = new Date(`${last.date}T00:00:00Z`);
    const day = nextMonth.getUTCDate(); nextMonth.setUTCDate(1); nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    const maxDay = new Date(Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1, 0)).getUTCDate();
    nextMonth.setUTCDate(Math.min(day, maxDay));
    const candidateConfidence = Math.min(confidence(rows), monthly && stableAmount && rows.length >= 3 ? 0.9 : 0.6);
    if (rows.length > 1 && rows.at(-2)!.amountCents !== last.amountCents)
      priceChanges.push({ merchantId: known.id, differenceCents: rows.at(-2)!.amountCents - last.amountCents, rows: rows.slice(-2) });
    subscriptionCandidates.push({ subscriptionId,
      merchantId: known.id, label: `${known.label}：可能是订阅，需用户确认`, monthlyCents: -last.amountCents,
      nextChargeDate: monthly ? nextMonth.toISOString().slice(0, 10) : null,
      ...metadata(rows, ['下次扣款日期是历史月度周期推算，金额取最近扣款；不保证续费或确认使用情况']),
      confidence: candidateConfidence });
  }
  const id = `bill-${createHash('sha256').update(JSON.stringify({ input, version: state.twinVersion, calculationVersion, all })).digest('hex').slice(0, 24)}`;
  const claims: BillInvestigationBrief['claims'] = [];
  const addClaim = (claimType: EvidenceRef['claimType'], label: string, refs = sources, certainty = confidence(all)) => {
    if (refs.length) claims.push({ id: `${id}-${claims.length}`, claimType, label,
      dataAsOf, sourceRefs: refs, confidence: certainty, limitations: [...limitations], twinVersion: state.twinVersion, calculationVersion });
  };
  const grossExpenseCents = expenses.reduce((sum, row) => sum - row.amountCents, 0);
  const refundCreditsCents = refunds.reduce((sum, row) => sum + row.amountCents, 0);
  const netExpenseCents = grossExpenseCents - refundCreditsCents;
  addClaim('fact', `报告窗口已确认支出合计 ${Math.max(0, netExpenseCents)} 分（扣除当期匹配退款，最低为零）`, withPairs(windowRows).map(ref));
  if (refunds.length) addClaim('fact', `当期匹配退款入账 ${refundCreditsCents} 分；按发生日期计算的净支出 ${netExpenseCents} 分`, withPairs([...expenses, ...refunds]).map(ref));
  for (const category of categoryResults) addClaim('fact', `${category.category} 支出 ${category.amountCents} 分，共 ${category.transactionCount} 笔`, category.sourceRefs, category.confidence);
  for (const change of changes) addClaim('fact', `${change.category} 较历史基线变化 ${change.increaseCents} 分，属于待核实的支出变化`, change.sourceRefs, change.confidence);
  for (const change of priceChanges) addClaim('fact', `${change.merchantId} 最近两次扣款金额变化 ${change.differenceCents} 分`, change.rows.map(ref), confidence(change.rows));
  if (all.some(row => row.excludedReason === 'duplicate' || row.excludedReason === 'internal_transfer'))
    addClaim('fact', '已排除对账识别的重复记录及内部转账；匹配退款按入账日期抵减当期支出',
      all.filter(row => row.excludedReason === 'duplicate' || row.excludedReason === 'internal_transfer').map(ref));
  if (current.some(row => Object.keys(row.correctedValues).length)) addClaim('fact', '账单分析采用已确认的用户修正值', current.filter(row => Object.keys(row.correctedValues).length).map(ref));
  if (current.some(row => safeCategory(row) === 'unclassified')) addClaim('limitation', '存在未分类交易，需要用户核实', current.filter(row => safeCategory(row) === 'unclassified').map(ref));
  addClaim('assumption', '历史连续月份作为支出比较基线；周期相近的付款只作为可能订阅的线索');
  for (const candidate of subscriptionCandidates) {
    addClaim('assumption', `${candidate.label}；最近月度扣款 ${candidate.monthlyCents} 分`, candidate.sourceRefs, candidate.confidence);
    if (candidate.nextChargeDate) addClaim('prediction', `${candidate.merchantId} 若月度周期延续，预计下次扣款 ${candidate.nextChargeDate}`, candidate.sourceRefs, candidate.confidence);
  }
  addClaim('limitation', '交易频次无法确认使用情况；历史支出变化不能直接推算目标影响');
  return BillInvestigationBriefSchema.parse({ id, periodStart, periodEnd, dataAsOf, twinVersion: state.twinVersion,
    calculationVersion, grossExpenseCents, refundCreditsCents, netExpenseCents,
    sourceRefs: unique(withPairs(windowRows).map(ref)), confidence: confidence(withPairs(windowRows)),
    totalExpenseCents: Math.max(0, netExpenseCents), categories: categoryResults,
    changes, subscriptionCandidates, claims, limitations, createdAt: `${state.clock}T12:00:00.000Z` });
}
