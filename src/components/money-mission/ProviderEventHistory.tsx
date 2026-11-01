import {useEffect,useState} from 'react';
import {api} from '../../api';
type Entry={id:string;domain:'investment'|'booking';revision:number;outcome:'applied'|'stale'|'terminal_ignored';reportedOn:string};
export function ProviderEventHistory({twinVersion,domain}:{twinVersion:number;domain?:Entry['domain']}){
 const [items,setItems]=useState<Entry[]>([]),[error,setError]=useState('');
 useEffect(()=>{let live=true;api<{items:Entry[]}>('/api/services/provider-events').then(r=>{if(live){setItems(r.items);setError('');}}).catch(()=>{if(live)setError('暂时无法读取服务回报，请稍后刷新。');});return()=>{live=false;};},[twinVersion]);
 const visible=items.filter(item=>!domain||item.domain===domain);
 return <details className="mission-card"><summary className="font-bold min-h-11 py-2 cursor-pointer">模拟服务结果核对记录</summary><p>同一回报只处理一次，过期回报不会覆盖已确认结果；这里只查询原操作，不会重新付款。</p>{error&&<p role="alert">{error}</p>}{!visible.length&&!error&&<p>还没有带版本的服务回报。</p>}{visible.slice(-20).reverse().map(item=><article className="border-t py-2" key={item.id}><strong>{item.domain==='investment'?'理财':'旅行订单'} · {({applied:'已核对回报',stale:'已忽略旧版本',terminal_ignored:'已保留最终结果'})[item.outcome]}</strong><p>{item.reportedOn} · 服务回报版本{item.revision}</p></article>)}</details>;
}
