/** Frozen synthetic service calendar; not an exchange or bank holiday calendar. */
export const simulatedClosures=['2026-11-02','2027-01-01'];
const shift=(d:string,n:number)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const closed=(d:string)=>[0,6].includes(new Date(d+'T00:00:00Z').getUTCDay())||simulatedClosures.includes(d);
export function investmentSettlement(date:string,now:number){
 const local=new Date(now+8*3600000).toISOString();const hour=local.slice(0,10)===date?Number(local.slice(11,13)):12;
 let accepted=date;if(closed(accepted)||hour>=15){do{accepted=shift(accepted,1);}while(closed(accepted));}
 let settles=accepted;do{settles=shift(settles,1);}while(closed(settles));return {acceptedOn:accepted,settlesOn:settles,cutoff:'15:00 北京时间',calendar:'模拟服务日历',afterCutoff:hour>=15};
}
