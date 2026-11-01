import { useEffect, useState } from 'react';
import type { FinancialServicesView } from '../../../server/financial-services';
import type { ServiceAction } from '../../../shared/financial-services';
import { recipientReady } from '../../../shared/recipient-identity';

export function RecipientVerifier({ recipients, selectedId, busy, onSelect, onPrepare, inline = false }: {
  recipients: FinancialServicesView['recipients']; selectedId: string; busy: boolean;
  onSelect: (id: string) => void; onPrepare: (action: ServiceAction) => void; inline?: boolean;
}) {
  const contacts = recipients.filter(item => item.id !== 'self');
  const current = contacts.find(item => item.id === selectedId) || contacts[0];
  const [suffix, setSuffix] = useState(''), [ack, setAck] = useState(false);
  useEffect(() => { setSuffix(''); setAck(false); }, [current?.id, current?.version]);
  if (!current) return null;
  const ready = recipientReady(current);
  const content = <>
    {!inline && <label>需要核对的联系人<select className="mission-input" value={current.id} disabled={busy} onChange={e => onSelect(e.target.value)}>{contacts.map(item => <option key={item.id} value={item.id}>{item.name} · {item.alias} · 尾号{item.suffix}</option>)}</select></label>}
    <strong>{current.name} · {current.alias} · 尾号{current.suffix}</strong>
    <p role="status">{ready ? '收款人资料已核对（模拟）。' : '请先核对姓名、备注和尾号，再继续。'}</p>
    {ready ? <button className="mission-link" disabled={busy} onClick={() => onPrepare({ kind: 'review_recipient', id: current.id, expectedVersion: current.version })}>资料有疑问，重新核对</button> : <>
      <label>收款账号尾号（4位）<input className="mission-input" inputMode="numeric" maxLength={4} value={suffix} onChange={e => { setSuffix(e.target.value); setAck(false); }} /></label>
      <label className="flex gap-2 py-2"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />我已核对姓名、备注和尾号，确认是这位联系人</label>
      <button className="mission-secondary" disabled={busy || !ack || !/^\d{4}$/.test(suffix)} onClick={() => onPrepare({ kind: 'verify_recipient', id: current.id, expectedVersion: current.version, suffix, acknowledged: true })}>核对并保存联系人</button>
      <p className="text-xs">仅核对模拟资料，不代表银行实名验证。</p>
    </>}
  </>;
  return inline ? <section aria-label="收款人核对资料" className="rounded-xl bg-[#F4F7F7] p-3 space-y-2">{content}</section> : <details className="mission-card"><summary className="font-bold min-h-11 py-2 cursor-pointer">核对收款人资料</summary>{content}</details>;
}
