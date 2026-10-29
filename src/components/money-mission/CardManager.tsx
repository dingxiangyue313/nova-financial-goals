import type {FinancialServicesView} from '../../../server/financial-services';
import type {ServiceAction} from '../../../shared/financial-services';
export function CardManager({view,busy,onLimitPreview,onPrepare,onQuery}:{view:FinancialServicesView;busy:boolean;onLimitPreview:(id:string)=>void;onPrepare:(a:ServiceAction)=>void;onQuery:(id:string)=>void}){
 const money=(c:number)=>`¥${(c/100).toLocaleString('zh-CN')}`;
 return <>{view.cards.map(card=>{
  const pending=view.cardOperations.find(o=>(o.cardId===card.id||o.replacementCardId===card.id)&&o.status==='unknown');
  const replacement=view.cardOperations.find(o=>o.cardId===card.id&&o.kind==='replace_card'&&o.status==='succeeded');
  return <section className="mission-card" aria-label={`${card.label}尾号${card.suffix}`} key={card.id}>
   <h2 className="font-bold">{card.label} · 尾号{card.suffix}</h2><p>{({active:'正常',locked:'临时锁定',lost:'已挂失'})[card.status]} · {card.type==='credit'?'信用额度':'单笔限制'}{money(card.limitCents)} · 结算账户{card.accountId}</p><p>线上{card.online?'已开启':'已关闭'} · 境外{card.overseas?'已开启':'已关闭'}</p>
   {pending?<><p role="status">此卡操作结果未知，查询原操作后再继续；不会重复提交。</p><button className="mission-secondary" disabled={busy} onClick={()=>onQuery(pending.id)}>查询此卡原操作</button></>:card.status==='lost'?<>
    <p>已挂失，不可普通解锁。旧订单保留；补发卡沿用原账户，不增加现金。</p>
    {replacement?<p role="status">已补发新卡，请核对新卡尾号并单独确认解锁和支付开关。</p>:<button className="mission-secondary" disabled={busy} onClick={()=>onPrepare({kind:'replace_card',id:card.id})}>核对补发此卡</button>}
   </>:<div className="grid grid-cols-2 gap-2">
    <button className="mission-secondary" disabled={busy} onClick={()=>onPrepare({kind:'card',id:card.id,action:card.status==='active'?'lock':'unlock'})}>{card.status==='active'?'临时锁定':'解除临时锁'}</button>
    <button className="mission-secondary" disabled={busy} onClick={()=>onPrepare({kind:'card',id:card.id,action:'lost'})}>挂失此卡</button>
    <button className="mission-secondary" disabled={busy} onClick={()=>onLimitPreview(card.id)}>预览额度调整</button>
    <button className="mission-secondary" disabled={busy} onClick={()=>onPrepare({kind:'card',id:card.id,action:'controls',online:!card.online,overseas:card.overseas})}>{card.online?'关闭':'开启'}线上交易</button>
    <button className="mission-secondary" disabled={busy} onClick={()=>onPrepare({kind:'card',id:card.id,action:'controls',online:card.online,overseas:!card.overseas})}>{card.overseas?'关闭':'开启'}境外交易</button>
   </div>}
  </section>;
 })}</>;
}
