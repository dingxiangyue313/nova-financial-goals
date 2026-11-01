import { useState } from 'react';
import type { FinancialServicesView } from '../../../server/financial-services';
import type { ServiceAction } from '../../../shared/financial-services';
import { amountCents } from '../../../shared/amount';
import { recipientReady } from '../../../shared/recipient-identity';
import { money } from '../../lib/format';
import { RecipientVerifier } from './RecipientVerifier';

export function ContactTransferPanel({ view, busy, onPrepare, initialMessage='',initialDraft,onDraftChanged }: {
  view: FinancialServicesView; busy: boolean; onPrepare: (action: ServiceAction) => void; initialMessage?:string;initialDraft?:import('../../../shared/chat-routing').ChatMemory;onDraftChanged?:(draft:{recipientQuery:string;amountCents:number|null;sourceAccount:string})=>void;
}) {
  const [query, setQuery] = useState(initialDraft?.recipientQuery || (initialMessage.match(/给(.{1,12}?)(?:转账|转|汇|打)/)?.[1]?.trim()??'')), [recipientId, setRecipientId] = useState('');
  const [source, setSource] = useState(view.accounts.find(a=>a.id===initialDraft?.sourceAccount||a.label===initialDraft?.sourceAccount)?.id??'checking'), [amount, setAmount] = useState(initialDraft?.amountCents!=null?String(initialDraft.amountCents/100):initialMessage.match(/(?:转账|转|汇|打)\s*[¥￥]?\s*(\d+(?:\.\d{1,2})?)(?![\d.万千])\s*元?/)?.[1]??''), [note, setNote] = useState('');
  const recipient = view.recipients.find(item => item.id === recipientId);
  const account = view.accounts.find(item => item.id === source);
  const contacts = view.recipients.filter(item => item.id !== 'self' && `${item.name} ${item.alias} ${item.phone} ${item.suffix}`.includes(query));
  let cents = 0;
  try { cents = amountCents(amount); } catch { /* Keep incomplete input editable. */ }
  const ready = recipient && recipientReady(recipient);
  return <section className="mission-card" aria-label="联系人转账流程" onBlur={()=>onDraftChanged?.({recipientQuery:query,amountCents:amount.trim()?cents:null,sourceAccount:source})}>
    <h2 className="font-bold">联系人转账</h2>
    <h3 className="font-semibold">1 · 选择并核对收款人</h3>
    <label>搜索联系人<input className="mission-input" placeholder="姓名、手机号、备注或尾号" value={query} onChange={e => { setQuery(e.target.value); setRecipientId(''); }} /></label>
    <label>收款人<select aria-label="收款人" className="mission-input" value={recipientId} onChange={e => setRecipientId(e.target.value)}><option value="">请选择收款人</option>{contacts.map(item => <option key={item.id} value={item.id}>{item.name} · {item.alias} · 尾号{item.suffix}</option>)}</select></label>
    {recipient && <RecipientVerifier recipients={[recipient]} selectedId={recipient.id} busy={busy} onSelect={setRecipientId} onPrepare={onPrepare} inline />}
    <h3 className="mt-2 font-semibold">2 · 填写转账信息</h3>
    <label>付款账户<select className="mission-input" value={source} onChange={e => setSource(e.target.value)}>{view.accounts.filter(item => item.type === 'checking').map(item => <option key={item.id} value={item.id}>{item.label} · 可用{money(item.availableCents)}</option>)}</select></label>
    <label>转账金额（元）<input className="mission-input" inputMode="decimal" placeholder="请输入金额" value={amount} onChange={e => setAmount(e.target.value)} /></label>
    {cents > (account?.availableCents ?? 0) && <p role="alert">可用余额不足，请调整金额。</p>}
    <label>转账备注（选填）<input className="mission-input" maxLength={120} value={note} onChange={e => setNote(e.target.value)} /></label>
    <h3 className="mt-2 font-semibold">3 · 核对并确认</h3>
    <p>下一步核对收款人、金额和手续费，确认后才执行模拟转账。</p>
    <button className="mission-primary" disabled={busy || !ready || cents <= 0 || cents > (account?.availableCents ?? 0)} onClick={() => recipient && onPrepare({ kind: 'transfer', recipientId: recipient.id, recipientVersion: recipient.version, accountId: source, amountCents: cents, note })}>下一步，核对转账</button>
  </section>;
}

