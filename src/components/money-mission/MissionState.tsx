export function MissionState({ kind, message, onRetry }: {
  kind: 'loading' | 'error' | 'empty' | 'completed'; message: string; onRetry?: () => void;
}) {
  return <div role={kind === 'error' ? 'alert' : 'status'} aria-live={kind === 'error' ? 'assertive' : 'polite'}
    className="rounded-xl border border-[#D8E7E7] bg-[#F5F7F8] p-4 text-[13px] leading-relaxed text-[#5A616B]">
    <p>{message}</p>
    {onRetry && <button type="button" onClick={onRetry}
      className="mt-3 min-h-11 rounded-xl border border-[#0F6B6D] px-4 py-2 font-semibold text-[#0F6B6D] focus-visible:outline-2 focus-visible:outline-offset-2">重新读取任务</button>}
  </div>;
}
