import { useEffect, useRef, useState, type ReactNode } from 'react';
import { amountCents } from '../../shared/amount';

export function ExpenseImpactDialog({ onClose, onSimulate, active, children }: {
  onClose: () => void;
  onSimulate: (amount: number, title: string) => Promise<boolean>;
  active: boolean;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [amount, setAmount] = useState('900');
  const [title, setTitle] = useState('汽车保养');
  const [stage, setStage] = useState<'input' | 'impact' | 'quiet'>('input');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { dialog.current?.close(); opener?.focus(); };
  }, []);
  return <dialog ref={dialog} aria-labelledby="expense-dialog-title"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    className="m-auto w-[calc(100%-24px)] max-w-[440px] max-h-[90dvh] overflow-hidden rounded-3xl border border-[#B9D9D8] bg-[#F5F7F8] p-0 text-[#1F2329] shadow-2xl backdrop:bg-[#152B2D]/40">
    <div className="flex max-h-[90dvh] flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-[#E5E8EB] bg-white px-4 py-3">
        <h2 id="expense-dialog-title" className="text-base font-semibold">{stage === 'input' ? '模拟一笔大额支出' : '目标影响提醒'}</h2>
        <button type="button" disabled={busy} aria-label="关闭支出提示" onClick={onClose}
          className="min-h-11 min-w-11 rounded-full text-xl text-[#5A616B]">×</button>
      </header>
      <div className="overflow-y-auto overscroll-contain">
        {stage === 'input' ? <form className="space-y-4 p-5" onSubmit={async event => {
          event.preventDefault(); setError('');
          try {
            const value = amountCents(amount);
            if (value <= 0 || !title.trim()) throw new Error('请填写支出用途和大于零的金额');
            setBusy(true);
            setStage(await onSimulate(value, title.trim()) ? 'impact' : 'quiet');
          } catch (reason) { setError(reason instanceof Error ? reason.message : '暂时无法模拟，请重试'); }
          finally { setBusy(false); }
        }}>
          <p className="text-sm leading-6 text-[#5A616B]">模拟已发生的支出，NOVA 会重新核算当前目标。只更新模拟账户，不涉及真实资金。</p>
          <label className="block text-sm font-medium">支出用途<input autoFocus required maxLength={60} value={title} disabled={busy}
            onChange={event => setTitle(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-[#D0D5DD] bg-white px-3" /></label>
          <label className="block text-sm font-medium">支出金额（元）<input required inputMode="decimal" value={amount} disabled={busy}
            onChange={event => setAmount(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-[#D0D5DD] bg-white px-3" /></label>
          {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
          <button disabled={busy || !active} className="min-h-11 w-full rounded-xl bg-[#0F6B6D] px-4 text-sm font-semibold text-white disabled:opacity-40">
            {busy ? '正在核算目标影响…' : '确认记录模拟支出并核算'}</button>
          {!active && <p className="text-xs text-[#5A616B]">请先选择方案并激活一个目标，再模拟支出影响。</p>}
        </form> : stage === 'impact' ? children : <div className="space-y-4 p-5">
          <p className="text-lg font-semibold text-[#0F6B6D]">本次变化无需调整计划</p>
          <p className="text-sm leading-6 text-[#5A616B]">模拟支出已记录。根据当前数据，尚未达到即时目标风险提醒条件，NOVA 将继续观察。</p>
          <button onClick={onClose} className="min-h-11 w-full rounded-xl bg-[#0F6B6D] text-sm font-semibold text-white">知道了</button>
        </div>}
      </div>
    </div>
  </dialog>;
}
