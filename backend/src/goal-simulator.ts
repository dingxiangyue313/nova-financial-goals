export type SimulatorPlan={id:"保守"|"平衡"|"加速";monthlyContribution:number;completionDate:string;months:number;safeToSpend:number;meetsDeadline:boolean;note:string};
export type CardOption={id:"travel"|"daily"|"premium";name:string;fxFeeRate:number;annualFee:number;estimatedFxFee:number;recommended:boolean;note:string};
const START_YEAR=2026;
const START_MONTH=9;

function addMonths(months:number){const result=new Date(Date.UTC(START_YEAR,START_MONTH-1,20));result.setUTCMonth(result.getUTCMonth()+months);return result.toISOString().slice(0,10);}
function monthsUntil(targetDate:string){const [year,month]=targetDate.split("-").map(Number);return Math.max(1,(year-START_YEAR)*12+month-START_MONTH);}

export function simulateTravelGoal(input:{targetAmount:number;savedAmount:number;targetDate:string;monthlyContribution:number;baseSafeToSpend:number;baselineContribution:number}){
  const remaining=Math.max(0,input.targetAmount-input.savedAmount);
  const targetMonths=monthsUntil(input.targetDate);
  const variants:[SimulatorPlan["id"],number,string][]=[["保守",.8,"每月压力较低"],["平衡",1,"保持当前节奏"],["加速",1.3,"更快完成，短期预算更紧"]];
  const plans=variants.map(([id,multiplier,note])=>{
    const monthlyContribution=Math.max(100,Math.round(input.monthlyContribution*multiplier/100)*100);
    const months=Math.max(1,Math.ceil(remaining/monthlyContribution));
    const safeToSpend=input.baseSafeToSpend-Math.max(0,monthlyContribution-input.baselineContribution);
    return {id,monthlyContribution,months,completionDate:addMonths(months),safeToSpend,meetsDeadline:months<=targetMonths,note:safeToSpend<100000?`${note}；可安心支配将低于 ¥1,000`:note};
  });
  const fxRate=20.5;
  const targetJpy=Math.round(input.targetAmount/100*fxRate);
  const cards:CardOption[]=[
    {id:"travel",name:"NOVA Travel",fxFeeRate:0,annualFee:0,estimatedFxFee:0,recommended:true,note:"JPY 消费免外币手续费"},
    {id:"daily",name:"Everyday Debit",fxFeeRate:.015,annualFee:0,estimatedFxFee:Math.round(input.targetAmount*.015),recommended:false,note:"外币手续费 1.5%"},
    {id:"premium",name:"Voyage Premium",fxFeeRate:.005,annualFee:68000,estimatedFxFee:Math.round(input.targetAmount*.005),recommended:false,note:"外币手续费 0.5%，含旅行权益"},
  ];
  return {remaining,targetMonths,plans,fx:{pair:"CNY/JPY",rate:fxRate,targetJpy,quotedAt:"2026-09-20 09:30",expiresIn:"仅用于模拟",stagedExchange:[{label:"计划确认后",percent:30,amount:Math.round(input.targetAmount*.3)},{label:"出发前 60 天",percent:40,amount:Math.round(input.targetAmount*.4)},{label:"出发前 14 天",percent:30,amount:Math.round(input.targetAmount*.3)}]},cards};
}
