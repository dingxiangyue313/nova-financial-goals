import type {BillBrief} from '../../../shared/contracts';
import {money} from '../../lib/format';
const labels:Record<string,string>={housing:'住房',dining:'餐饮',dining_delivery:'餐饮外卖',utilities:'水电',shopping:'购物',insurance:'保险',transport:'交通',subscriptions:'订阅',health:'健康',education:'教育',entertainment:'娱乐',unclassified:'待分类'};
export function BillBreakdown({brief,onCategory,onEvidence}:{brief:BillBrief;onCategory:(category:string)=>void;onEvidence:()=>void}){
 return <section className="mission-card" aria-label="消费分类图"><h2 className="text-lg font-bold mb-4">钱主要花在哪里</h2>
 {brief.categories.filter(c=>c.amountCents>0).map(c=><button key={c.category} onClick={()=>onCategory(c.category)} className="block w-full text-left mb-5 min-h-11" aria-label={`查看${labels[c.category]??c.category}逐笔账单`}>
   <span className="flex justify-between gap-2 mb-2"><span>{labels[c.category]??c.category}</span><span>{money(c.amountCents)} ›</span></span>
   <span className="block h-2 rounded-full bg-[#ECF1F1] overflow-hidden"><span className="block h-full rounded-full bg-[#378E90]" style={{width:`${Math.min(100,Math.max(1,100*c.amountCents/Math.max(1,brief.totalExpenseCents)))}%`}}/></span>
 </button>)}
 {!brief.categories.length&&<p>这段时间还没有消费记录，可前往“数据管理”导入账单。</p>}
 <button className="mission-link" onClick={onEvidence}>查看逐笔证据与排除项</button></section>;
}
