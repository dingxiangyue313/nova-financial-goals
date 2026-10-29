export type MandateTerms={maxPerOrderCents:number;totalCents:number;merchants:string[];expiresAt:string};
export function mandateChanges(before:MandateTerms|undefined,after:MandateTerms){
 const names=(ids:string[])=>ids.map(id=>({'air-demo':'樱旅航空','stay-demo':'京都旅宿'}[id]??'未识别商户')).sort().join('、');
 const yuan=(n:number)=>`¥${(n/100).toLocaleString('zh-CN')}`;
 return [{label:'单笔上限',before:before?yuan(before.maxPerOrderCents):'未授权',after:yuan(after.maxPerOrderCents),expanded:!before||after.maxPerOrderCents>before.maxPerOrderCents},{label:'累计上限',before:before?yuan(before.totalCents):'未授权',after:yuan(after.totalCents),expanded:!before||after.totalCents>before.totalCents},{label:'允许商户',before:before?names(before.merchants):'未授权',after:names(after.merchants),expanded:!before||after.merchants.some(m=>!before.merchants.includes(m))},{label:'有效期',before:before?new Date(before.expiresAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'未授权',after:new Date(after.expiresAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}),expanded:!before||Date.parse(after.expiresAt)>Date.parse(before.expiresAt)}].filter(row=>row.before!==row.after);
}
