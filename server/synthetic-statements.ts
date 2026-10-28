import type { ParsedStatement } from './statement-parser.ts';

/** Deterministic histories are evidence only; they never mint authoritative cash. */
export function syntheticStatements(profile: 'travel' | 'flex' | 'longterm', asOf: string): ParsedStatement {
  const count = profile === 'travel' ? 2400 : 1800;
  const first = Date.parse(`${Number(asOf.slice(0,4))-1}-01-01T00:00:00Z`), end = Date.parse(`${asOf}T00:00:00Z`);
  const categories = ['dining','transport','shopping','housing','education','health','subscriptions'];
  const merchants = ['Cafe','Transport','NOVA Shop','Rent','NOVA Academy','NOVA Health','CloudBox Plus'];
  const rows:Array<ParsedStatement['rows'][number]&{date:string;amountCents:number}>=[];
  for(let i=0;i<count;i++){
    let date=new Date(first+Math.floor(i*(end-first)/(count-1)/86400000)*86400000).toISOString().slice(0,10);
    let category=categories[i%categories.length];
    let name=category==='subscriptions'?'CloudBox Plus':`${merchants[i%merchants.length]} ${1+Math.floor(i/categories.length)%7}`;
    let description=category==='subscriptions'?name:`${name} · ${profile}-${i+1}`;
    let cents=-(100+(i*37+profile.length*101)%15000);
    if(i%120===0){category='income';name=profile==='flex'?'NOVA 项目款':'NOVA 合成收入';description=`${name} · ${profile}-${i+1}`;cents=profile==='flex'?80000+(i*673)%240000:850000;}
    if(i%120===2){const original=rows[i-1];category='refund';name=original.rawDescription;description=`Refund: ${original.rawDescription}`;cents=-original.amountCents;}
    if(i%127===0&&i>0){const original=rows[i-1];date=original.date;category=original.category;description=original.rawDescription;cents=original.amountCents;name=description;}
    if(i%149===0&&i>0){category='internal_transfer';name='NOVA 本人账户互转';description=`${name} · ${profile}-${i+1}`;cents=-20000;}
    rows.push({rowNumber:i+1,date,rawDescription:description,amountCents:cents,category,
      merchantId:category==='subscriptions'?'cloudbox':category==='dining'?'cafe':category==='housing'?'rent':category==='transport'?'transport':null,
      confidence:1,originalValues:{date,description,amount:(cents/100).toFixed(2)},issues:[]});
  }
  return { templateId:'bank-csv-v1',format:'csv',accountId:'checking',sourceKind:'bank',confidence:1,issues:[],
    rows};
}
