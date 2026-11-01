const words: Record<string, string> = {
  AA: '均摊', pending: '待结算', unknown: '结果待核对', failed: '未完成',
  succeeded: '已完成', settled: '已到账', confirmed: '已确认',
  approved: '已通过', rejected: '未通过', revoked: '已撤销',
  active: '生效中', submitted: '已提交', under_review: '审核中',
  refund_pending: '退款在途', refunded: '已退款', paid: '已付款',
  unpaid: '未付款', reserved: '已预留', released: '已释放',
  open: '待收款', partial: '部分到账', collected: '已收齐', closed: '已关闭',
};

/** Keep technical identifiers and machine timestamps out of activity copy. */
export function activityCopy(value: string): string {
  return value
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '')
    .replace(/\b[0-9a-f]{24,}\b/gi, '')
    .replace(/\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?/g, '')
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, '')
    .replace(/[A-Za-z][A-Za-z0-9_-]*/g, word => words[word] ?? '')
    .replace(/\s*·\s*(?=·|$)/g, '')
    .replace(/ {2,}/g, ' ')
    .trim();
}
