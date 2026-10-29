type Quote={kind:string;label:string;merchantId:string;totalCents:number;feeCents:number;taxCents:number;refundable:boolean;expiresAt?:string};
const money=(n:number)=>'¥'+(n/100).toLocaleString('zh-CN');
export function compareIntent(intent:{quotes:Quote[];accountId:string;cardId:string}|null,quotes:Quote[],accountId:string,cardId:string){
 const changes:string[]=[];
 if(intent){if(intent.accountId!==accountId)changes.push(`资金账户：${intent.accountId} → ${accountId}`);if(intent.cardId!==cardId)changes.push(`支付卡：${intent.cardId} → ${cardId}`);for(const old of intent.quotes){const now=quotes.find(q=>q.kind===old.kind);if(!now){changes.push(`${old.label}：已从本次选择移除`);continue;}if(now.merchantId!==old.merchantId)changes.push(`${old.kind==='flight'?'机票':'住宿'}商户已变化`);if(now.totalCents!==old.totalCents)changes.push(`${old.kind==='flight'?'机票':'住宿'}总价：${money(old.totalCents)} → ${money(now.totalCents)}`);if(now.feeCents!==old.feeCents||now.taxCents!==old.taxCents)changes.push('税费或手续费构成已变化');if(now.expiresAt!==old.expiresAt)changes.push('报价有效期已变化，需重新核对');if(now.refundable!==old.refundable)changes.push(`退改条件：${old.refundable?'可退':'不可退'} → ${now.refundable?'可退':'不可退'}`);}for(const q of quotes)if(!intent.quotes.some(old=>old.kind===q.kind))changes.push(`新增${q.kind==='flight'?'机票':'住宿'}订单`);}

return changes;
}
