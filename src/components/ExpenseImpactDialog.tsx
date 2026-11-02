import { useEffect, useRef, type ReactNode } from 'react';

export function ExpenseImpactDialog({ onClose, onActivate, status, error, children }: {
  onClose: () => void;
  onActivate: () => void;
  status: 'loading' | 'impact' | 'quiet' | 'inactive' | 'error';
  error: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { dialog.current?.close(); opener?.focus(); };
  }, []);
  return <dialog ref={dialog} aria-labelledby="expense-dialog-title"
    onCancel={event => { event.preventDefault(); if (status !== 'loading') onClose(); }}
    className="m-auto w-[calc(100%-16px)] max-w-[440px] max-h-[94dvh] overflow-hidden rounded-3xl border-2 border-[#8ACCC3] bg-[#F5F7F8] p-0 text-[#1F2329] shadow-2xl backdrop:bg-[#152B2D]/40">
    <div className="flex max-h-[93dvh] flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-[#E5E8EB] bg-white px-3 py-1">
        <button type="button" disabled={status === 'loading'} aria-label="关闭支出提示" onClick={onClose}
          className="min-h-11 min-w-11 rounded-full text-xl text-[#5A616B]">←</button>
        <h2 id="expense-dialog-title" className="text-base font-semibold">目标影响提醒</h2>
        <span className="rounded-full bg-[#F0F2F5] px-2 py-1 text-[11px] text-[#5A616B]">模拟数据</span>
      </header>
      <div className="overflow-y-auto overscroll-contain">
        {status === 'impact' ? children : <div className="space-y-4 p-5">
          {status === 'loading' && <p role="status" className="text-sm text-[#0F6B6D]">NOVA 正在核算汽车保养支出对目标的影响…</p>}
          {status === 'quiet' && <><p className="text-lg font-semibold text-[#0F6B6D]">本次变化无需调整计划</p><p className="text-sm leading-6 text-[#5A616B]">模拟支出已记录，根据当前数据尚未达到即时提醒条件，NOVA 将继续观察。</p></>}
          {status === 'inactive' && <><p className="text-lg font-semibold">先确认一个目标计划</p><p className="text-sm leading-6 text-[#5A616B]">当前目标还未激活，暂时没有可比较的储蓄节奏。启用计划后即可模拟支出并查看实际影响。</p><button onClick={onActivate} className="min-h-11 w-full rounded-xl bg-[#0F6B6D] text-sm font-semibold text-white">选择目标方案</button></>}
          {status === 'error' && <p role="alert" className="text-sm text-rose-700">{error}</p>}
          {status !== 'loading' && <button onClick={onClose} className="min-h-11 w-full rounded-xl border border-[#B9D9D8] text-sm text-[#0F6B6D]">返回目标</button>}
        </div>}
      </div>
    </div>
  </dialog>;
}
