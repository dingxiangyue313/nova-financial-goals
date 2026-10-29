import type {DemoState} from '../shared/contracts.ts';
import type {ServiceAction} from '../shared/financial-services.ts';
import {initializeServices,executeServiceAction,collectSplit} from './financial-services.ts';
export const aaCases=[
 ['odd','四人均分余分','整数分守恒'],['equal','四人整除','均分'],['custom','自定义份额','合计守恒'],['paid','本人历史已垫付','不重复扣款'],['paynow','本次本人垫付','确认后仅扣一次'],['other','同行已垫付','本人负债不计现金'],['partial','部分到账','未收不可用'],['duplicate','重复到账查询','幂等'],['overdue','逾期未收齐','不自动催收'],['closed-partial','部分到账后关闭','已收保留'],['closed-empty','未到账关闭','不凭空入账'],['settled','两人已结清','唯一到账']
] as const;
export function aaCatalogFixture(input:DemoState){
 let s=initializeServices(input);s.clock='2026-10-26';
 for(const [index,[id]]of aaCases.entries()){
  const participants=id==='settled'?['self','contact-1']:['self','contact-1','contact-2','contact-3'];
  const action:ServiceAction={kind:'split',totalCents:id==='odd'?39801:40000,participantIds:participants,accountId:'checking',alreadyPaid:id!=='paynow',payerId:id==='other'?'contact-1':'self',dueDate:id==='overdue'?'2026-10-27':'2026-11-05',...(id==='custom'?{shares:[{recipientId:'self',amountCents:11000},{recipientId:'contact-1',amountCents:10000},{recipientId:'contact-2',amountCents:9000},{recipientId:'contact-3',amountCents:10000}]}:{})};
  s=executeServiceAction(s,action,`aa-sample-${id}`);s.financialServices.splits.at(-1)!.sampleLabel=aaCases[index][1];
  if(['partial','duplicate','closed-partial','settled'].includes(id))s=collectSplit(s,`aa-sample-${id}`);
  if(id==='duplicate')s=collectSplit(s,`aa-sample-${id}`);
  if(id.startsWith('closed-'))s=executeServiceAction(s,{kind:'close_split',id:`aa-sample-${id}`},`aa-close-${index}`);
 }
 s.clock='2026-10-28';s.accountSnapshots=s.accountSnapshots.map(a=>({...a,asOf:s.clock,balanceCents:s.accounts.find(x=>x.id===a.accountId)!.balanceCents,sourceId:'aa-catalog-synthetic-opening'}));s.finance.updatedAt=s.clock;
 return s;
}
