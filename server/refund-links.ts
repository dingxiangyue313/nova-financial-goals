export function isRefundRow(row: { title: string; category: string; amountCents: number }) {
  return row.amountCents > 0 && (row.title.startsWith('Refund: ') || row.category === 'refund' || /原路退款|退款到账/.test(row.title));
}
export function refundMatches(refund: { title: string }, original: { title: string }) {
  if (refund.title.startsWith('Refund: ')) return original.title === refund.title.slice(8);
  if (!refund.title.includes('·') || !original.title.includes('·')) return false;
  return refund.title.split('·')[0].trim() === original.title.split('·')[0].trim();
}
