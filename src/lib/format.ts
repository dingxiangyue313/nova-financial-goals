export function money(cents: number) {
  return `¥${(cents / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
}
