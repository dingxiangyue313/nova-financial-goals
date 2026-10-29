import type {DemoState} from '../shared/contracts.ts';
/** One shared protected floor; goals cannot each reuse the same protected cash. */
export function protectedCheckingReserve(state:DemoState){
 return Math.max(0,Math.max(state.goal.protectedCents,...state.goals.map(g=>g.protectedCents))-state.finance.emergencyCents);
}
