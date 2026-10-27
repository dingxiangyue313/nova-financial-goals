import { useEffect } from 'react';
import type { Mission } from '../../../shared/mission';
import { money } from '../../lib/format';

export function ActionApproval({
  pending,
  lowCents,
  busy,
  error,
  onConfirm,
  onDismiss
}: {
  pending: NonNullable<Mission['pending']>;
  lowCents: number | null;
  busy: boolean;
  error: string;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const handleKey = (event: KeyboardEvent) => {
      const dialog = document.querySelector('[aria-labelledby="mission-confirm-title"]');
      if (!dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      if (event.key === 'Tab' && controls.length) {
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
      if (event.key === 'Escape') onDismiss();
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); previous?.focus(); };
  }, [pending.id, onDismiss]);
  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-5" role="dialog" aria-modal="true" aria-labelledby="mission-confirm-title">
      <div className="mission-card w-full max-w-[350px] shadow-xl max-h-[85vh] overflow-y-auto">
        <h2 id="mission-confirm-title" className="font-bold text-lg">
          {pending.kind === 'cancel_subscription' ? '确认关闭自动续费' : pending.kind === 'create_schedule' ? '确认旅行金转入安排' : '确认调整储蓄计划'}
        </h2>
        {pending.kind === 'cancel_subscription' ? (
          <>
            <p>CloudBox Plus · ¥68/月<br />下一扣款日：2026-11-05<br />付费服务可用至：2026-11-04</p>
            <p>确认后关闭后续自动续费，不退还已支付费用。只有商户验证成功后才计入每月 ¥68 节省。</p>
          </>
        ) : (
          <>
            <p>工资卡 → 旅行金账户<br />每期 {money(pending.amountCents)} · {pending.frequency === 'once' ? '一次性，确认后立即执行' : '每月检测到工资实际到账后次日09:00'}<br />手续费 ¥0 · 应急金不动用</p>
            <p>每月计划27日仍无工资到账则跳过、不补扣；达到目标或目标日期停止。创建月度计划时不会立即扣款。</p>
            {lowCents != null && <p>预计最低可用余额 {money(lowCents)}，基于当前账单及工资按时到账假设。</p>}
          </>
        )}
        <p className="text-xs">本确认5分钟内有效，数据变更后需重新准备。所有动作仅操作模拟账户。</p>
        <button autoFocus className="mission-primary" disabled={busy} onClick={onConfirm}>{busy ? '正在核对结果…' : '确认并执行模拟操作'}</button>
        <button className="mission-secondary" disabled={busy} onClick={onDismiss}>暂不操作</button>
        {error && <p role="alert" className="text-amber-800">{error}</p>}
      </div>
    </div>
  );
}
