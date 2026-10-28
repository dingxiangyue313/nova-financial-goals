export function decimalUnits(value: string, decimals: number): string {
  const normalized = value.trim();
  if (!new RegExp(`^\\d{1,16}(?:\\.\\d{0,${decimals}})?$`).test(normalized)) throw new Error('金额格式不正确');
  const [whole, fraction = ''] = normalized.split('.');
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0'))).toString();
}
export function amountCents(value: string) {
  const result = Number(decimalUnits(value, 2));
  if (!Number.isSafeInteger(result)) throw new Error('金额超出支持范围');
  return result;
}
