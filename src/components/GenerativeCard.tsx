import type { UiCard } from '../../shared/contracts';
import { normalizeUiCard } from '../../shared/generative';

const tones = {
  neutral: 'border-[#E5E8EB] bg-[#F8FAFB] text-[#1F2329]',
  good: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  danger: 'border-rose-200 bg-rose-50 text-rose-900',
};

export function GenerativeCard({ value, onAction }: { value: unknown; onAction?: (action: UiCard['action']) => void }) {
  const card = normalizeUiCard(value);
  return <article data-component={card.type} className={`rounded-xl border p-3 ${tones[card.tone]}`}>
    <div className="text-[11px] font-semibold opacity-70">NOVA 动态组件 · {card.type}</div>
    <h4 className="mt-1 text-[13px] font-bold">{card.title}</h4>
    <p className="mt-1 text-[12px] leading-relaxed opacity-80">{card.body}</p>
    {card.action && <button type="button" className="mt-2 rounded-lg bg-[#0F6B6D] px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-50"
      onClick={() => onAction?.(card.action)} disabled={!onAction}>{card.action.label}</button>}
  </article>;
}
