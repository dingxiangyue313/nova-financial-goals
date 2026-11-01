import {useState} from 'react';
import {money} from '../../lib/format';

const cases = [
  {amount:218000,result:'Execute',title:'条件匹配，可以继续',reason:'签名有效、授权与原意匹配，且目标现金流安全。',next:'进入付款预览；确认后执行模拟操作，再验证结果并记录凭证。'},
  {amount:215000,result:'Ask',title:'更便宜，也要重新确认',reason:'原 ¥2,200 报价可退，新报价不可退；退改条件改变了原意。',next:'返回报价与请求，核对退改差异并明确接受新请求，再重新准备付款。'},
  {amount:249000,result:'Manual Review',title:'需要进一步验证',reason:'达到单笔授权 80% 风险阈值，或设备与会话出现偏差。',next:'暂停执行，完成设备与用户验证，再重新检查授权和目标影响。'},
  {amount:232000,result:'Block',title:'请求未通过安全检查',reason:'签名过期、nonce 重放或硬性权限失效，真实性或权限边界未通过。',next:'停止执行，不扣款；取得新的有效请求或授权后重新核对。'},
] as const;

export function GoalGuardFlow({onQuotes,onOrders}:{onQuotes:()=>void;onOrders:()=>void}) {
 const [selected,setSelected]=useState(0),item=cases[selected];
 return <section className="mission-card" aria-label="GoalGuard 统一流程">
   <p className="text-xs text-[#0F6B6D] font-semibold">GoalGuard · 同时核对支付能力与原意</p>
   <h2 className="font-bold">低于上限，也有四种结果</h2>
   <p className="text-xs">规则说明示例 · 单笔上限 ¥2,500 · 以下不是当前请求的执行结果</p>
   <ol className="my-3 text-xs leading-6"><li>1. 核对签名、有效期与请求唯一性</li><li>2. 比较授权、退改条件与目标资金</li><li>3. 按风险决定继续、询问、复核或阻止</li><li>4. 经确认执行 → 查询验证 → 凭证与审计 → 更新目标资金</li></ol>
   <div className="grid grid-cols-2 gap-2">{cases.map((c,i)=><button key={c.result} type="button" aria-pressed={i===selected} className={i===selected?'mission-primary':'mission-secondary'} onClick={()=>setSelected(i)}>{money(c.amount)} · {c.result}</button>)}</div>
   <div className="mt-3 rounded-xl bg-[#E6F2F2] p-3" role="status"><strong className="text-[#0F6B6D]">{item.result} · {item.title}</strong><p>{item.reason}</p><p className="mt-2 text-xs">下一步：{item.next}</p></div>
   <div className="mt-3 flex flex-wrap gap-2"><button type="button" className="mission-secondary" onClick={onQuotes}>核对报价与原意</button><button type="button" className="mission-secondary" onClick={onOrders}>查看订单与恢复</button></div>
 </section>;
}
