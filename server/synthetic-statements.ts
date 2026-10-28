import type { ParsedStatement } from './statement-parser.ts';

/** Deterministic histories are evidence only; they never mint authoritative cash. */
export function syntheticStatements(profile: 'travel' | 'flex' | 'longterm', asOf: string): ParsedStatement {
  const count = profile === 'travel' ? 2400 : 1800;
  const first = Date.parse(`${Number(asOf.slice(0,4))-1}-01-01T00:00:00Z`), end = Date.parse(`${asOf}T00:00:00Z`);
  const categories = ['dining','transport','shopping','housing','education','health','subscriptions'];
  const merchants = ['Cafe','Transport','NOVA Shop','Rent','NOVA Academy','NOVA Health','CloudBox Plus'];
  return { templateId:'bank-csv-v1',format:'csv',accountId:'checking',sourceKind:'bank',confidence:1,issues:[],
    rows:Array.from({length:count},(_,i)=>{
      const date=new Date(first+Math.floor(i*(end-first)/(count-1)/86400000)*86400000).toISOString().slice(0,10);
      const category=categories[i%categories.length],name=merchants[i%merchants.length];
      const cents=-(100+(i*37+profile.length*101)%15000);
      return {rowNumber:i+1,date,rawDescription:category==='subscriptions'?name:`${name} · ${profile}-${i+1}`,amountCents:cents,category,
        merchantId:category==='subscriptions'?'cloudbox':category==='dining'?'cafe':category==='housing'?'rent':category==='transport'?'transport':null,
        confidence:1,originalValues:{date,description:name,amount:(cents/100).toFixed(2)},issues:[]};
    })};
}
