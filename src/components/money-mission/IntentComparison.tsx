import {compareIntent} from '../../../shared/intent-comparison';
import {useState} from 'react';
import type {FinancialServicesView} from '../../../server/financial-services';
type Quote=FinancialServicesView['quotes'][number];
export function IntentComparison({quotes,accountId,cardId}:{quotes:Quote[];accountId:string;cardId:string}){
 const [intent,setIntent]=useState<{quotes:Quote[];accountId:string;cardId:string}|null>(null);
 const changes=compareIntent(intent,quotes,accountId,cardId);
 return <section className="mission-card"><h2 className="font-bold">原意与最终订单核对</h2><p>可先记住当前选择，调整报价或付款方式后对比。降价但变成不可退也会提示，最终付款始终需要重新预览确认。</p><button className="mission-secondary" disabled={!quotes.length} onClick={()=>setIntent({quotes:structuredClone(quotes),accountId,cardId})}>{intent?'以当前选择重新记录原意':'记住当前旅行选择'}</button>{intent&&<><p>已记录{intent.quotes.length}笔报价。仅保存在此页面，离开后需重新记录。</p>{changes.length?<div role="status"><strong>与原意有变化，请重新核对</strong>{changes.map((c,i)=><p key={i}>{c}</p>)}</div>:<p>当前可比较字段与记录一致；仍需核对有效期与最终确认。</p>}</>}</section>;
}
