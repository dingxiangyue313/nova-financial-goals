import {useState} from 'react';
import type {MandateDraft} from '../../../shared/financial-services';
import {api} from '../../api';
export function MandateDraftBuilder({onDraft}:{onDraft:(draft:NonNullable<MandateDraft['draft']>)=>void}){
 const [text,setText]=useState(''),[result,setResult]=useState<MandateDraft|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function parse(){setBusy(true);setError('');try{const value=await api<MandateDraft>('/api/services/mandate-draft','POST',{message:text});setResult(value);if(value.draft)onDraft(value.draft);}catch(e){setError(e instanceof Error?e.message:'无法整理草稿，请使用下方表单。');}finally{setBusy(false);}}
 return <details className="mb-3 rounded-xl border p-3"><summary className="font-bold cursor-pointer">用一句话填写授权草稿</summary>
  <label>授权描述<textarea className="mission-input" value={text} onChange={e=>setText(e.target.value)} placeholder="只允许樱旅航空和京都旅宿，单笔不超过3000元，累计5000元，有效至YYYY-MM-DD（未来30天内）"/></label>
  <button className="mission-secondary" disabled={busy||!text.trim()} onClick={()=>void parse()}>{busy?'正在整理草稿…':'整理为可编辑草稿'}</button>
  {error&&<p role="alert">{error}</p>}{result&&<div role="status"><p>{result.explanation}</p>{result.missing.map(m=><p key={m}>{m}</p>)}{result.draft&&<p>草稿已填写到下方。请核对目标、账户、商户和金额，再选择创建或修改；当前没有新增授权。</p>}</div>}
 </details>;
}
