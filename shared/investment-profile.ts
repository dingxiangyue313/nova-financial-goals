import {z} from 'zod';
export const InvestmentAnswersSchema=z.object({purpose:z.enum(['travel','education','reserve','longterm']),
 useByDate:z.iso.date(),lossToleranceBps:z.union([z.literal(0),z.literal(100),z.literal(500),z.literal(1500)]),
 liquidity:z.enum(['anytime','week','quarter']),experience:z.enum(['none','basic','experienced']),
 incomeStability:z.enum(['irregular','stable']),understandsRisk:z.boolean(),
}).strict();
export type InvestmentAnswers=z.infer<typeof InvestmentAnswersSchema>;
export function investmentRiskLevel(a:InvestmentAnswers){
 if(a.lossToleranceBps===0||a.purpose==='reserve'||!a.understandsRisk)return 0;
 return Math.min(a.lossToleranceBps===100?1:a.lossToleranceBps===500?2:4,
   a.experience==='none'?1:a.experience==='basic'?2:4,a.incomeStability==='irregular'?1:4);
}
