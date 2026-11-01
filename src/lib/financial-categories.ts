export const financialCategories = [
  { id: 'overview', label: '目标资金' },
  { id: 'transfers', label: '转账与AA' },
  { id: 'wealth', label: '理财' },
  { id: 'cards', label: '卡片' },
  { id: 'travel', label: '旅行请求' },
  { id: 'bills', label: '账单与订阅' },
] as const;

export type FinancialCategory = typeof financialCategories[number]['id'];
export type FinancialTab = Exclude<FinancialCategory, 'bills'>;
