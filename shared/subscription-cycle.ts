import type {Subscription} from './contracts';

export const subscriptionCharge = (item: Pick<Subscription,'monthlyCents'|'chargeCents'>) => item.chargeCents ?? item.monthlyCents;
export function subscriptionCycleLabel(item: Pick<Subscription,'billingCycle'>) {
  return item.billingCycle === 'annual' ? '每年' : item.billingCycle === 'once' ? '单次' : '每月';
}
/** Always anchor to the original date, including leap-day annual renewals. */
export function subscriptionChargeDates(item: Subscription, through: string): string[] {
  if (item.billingCycle === 'once') return item.nextChargeDate <= through ? [item.nextChargeDate] : [];
  const start = new Date(item.nextChargeDate+'T00:00:00Z'), dates: string[] = [];
  for (let step=0;step<1200;step++) {
    const month=start.getUTCMonth()+step*(item.billingCycle==='annual'?12:1);
    const first=new Date(Date.UTC(start.getUTCFullYear(),month,1));
    const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
    const date=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth(),Math.min(start.getUTCDate(),last))).toISOString().slice(0,10);
    if(date>through)break;
    dates.push(date);
  }
  return dates;
}
