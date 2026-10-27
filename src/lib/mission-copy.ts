import { ApiError } from '../api';

export const CATEGORY_LABELS: Record<string, string> = {
  dining_delivery: '餐饮',
  housing: '住房',
  transport: '交通',
  shopping: '购物',
  subscription: '订阅',
  utilities: '水电',
  insurance: '保险',
  income: '工资',
  refund: '退款',
  internal_transfer: '内部转账',
  unclassified: '待核对'
};

export const CLAIM_LABELS = {
  fact: '事实',
  assumption: '假设',
  prediction: '预测',
  limitation: '限制'
} as const;

export const ERROR_COPY: Record<string, string> = {
  TWIN_VERSION_CHANGED: '数据已更新，请关闭确认并重新准备。',
  APPROVAL_EXPIRED: '确认已过期，请重新准备。',
  PLAN_ALREADY_EXISTS: '已有储蓄计划，请先暂停或取消。',
  INSUFFICIENT_BALANCE: '可用余额不足，请降低金额。',
  DATA_BALANCE_STALE: '余额数据已过期，请先更新账户。',
  DATA_UPLOAD_DISABLED: '当前比赛构建不接受个人账单上传。',
  DATA_FILE_TOO_LARGE: '文件超过 5MB，请改用合成样例。',
  DATA_UPLOAD_INVALID: '文件无法读取，请改用合成样例。',
  DATA_MISSION_NOT_LOADED: '请先载入合成旅行任务。',
  IMPORT_BATCH_NOT_FOUND: '找不到这次导入批次，请重新导入。',
  EVIDENCE_NOT_FOUND: '找不到对应证据，请刷新后再试。',
  SCHEDULE_NOT_FOUND: '找不到储蓄计划，请刷新后再试。',
  HANDOFF_NOT_FOUND: '找不到交接说明。',
  ACCOUNT_CURRENCY_MISMATCH: '账户币种不匹配，当前只支持人民币工资卡。',
  ACCOUNT_SNAPSHOT_CHECKING_ONLY: '当前只接受工资卡余额快照。',
  DATA_SNAPSHOT_FUTURE: '余额日期不能晚于模拟今日。'
};

export function missionErrorMessage(error: unknown) {
  const code = error instanceof ApiError ? error.code : undefined;
  if (code && ERROR_COPY[code]) return ERROR_COPY[code];
  const text = error instanceof Error ? error.message : '';
  for (const [key, value] of Object.entries(ERROR_COPY)) {
    if (text.includes(key)) return value;
  }
  return text || '操作未完成，请重试。';
}

export const NOTIFICATION_LABELS: Record<string, string> = {
  transfer_failed: '转账未完成',
  transfer_unknown: '转账结果待核实',
  missing_salary: '本期未见工资到账',
  goal_changed: '目标条件已变化',
  subscription_price: '订阅价格变化'
};

export const REPAIR_LABELS: Record<string, string> = {
  skip_period: '跳过本期',
  adjust_date: '调整执行日',
  pause_schedule: '暂停计划',
  query_operation: '查询执行结果',
  replan: '重新比较方案'
};

export const SCHEDULE_STATUS_LABELS: Record<string, string> = {
  draft: '草案',
  simulated: '预览',
  awaiting_confirmation: '待确认',
  active: '进行中',
  paused: '已暂停',
  completed: '已完成',
  failed: '未完成',
  cancelled: '已取消'
};
