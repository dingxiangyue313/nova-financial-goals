import type { GoalIntent,NotificationPreferences } from "@backend/goal-contracts";

export type GoalScenarioFixture={id:string;label:string;availableMonthly:number;safeToSpend:number;dataCoverage:number;missing:string[];existingGoalCommitments:number;changeAmount?:number;expectedStatus:"insufficient_data"|"on_track"|"at_risk"|"infeasible";expectedSignal:"none"|"eligible"|"suppressed"};
export const defaultGoalIntent:GoalIntent={name:"日本旅行",targetAmount:{amount:800000,currency:"CNY"},targetDate:"2027-01-31",monthlyContributionLimit:{amount:76000,currency:"CNY"},protectedAccountIds:["acc_emergency_001"],allowInvestmentSale:false,safetyBuffer:{amount:300000,currency:"CNY"}};
export const defaultNotificationPreferences:NotificationPreferences={weeklySummaryEnabled:true,dailySummaryEnabled:false,amountThreshold:{amount:5000,currency:"CNY"},goalImpactRatioThreshold:.05,quietHours:{enabled:true,start:"22:00",end:"08:00",timezone:"Asia/Shanghai"},pausedUntil:null,goalOverrides:{}};
export const goalScenarioFixtures:GoalScenarioFixture[]=[
 {id:"goal_insufficient_data",label:"数据不足",availableMonthly:76000,safeToSpend:184000,dataCoverage:.45,missing:["未来三个月收入","信用卡待出账"],existingGoalCommitments:0,expectedStatus:"insufficient_data",expectedSignal:"none"},
 {id:"goal_on_track",label:"正常可行",availableMonthly:76000,safeToSpend:184000,dataCoverage:1,missing:[],existingGoalCommitments:0,expectedStatus:"on_track",expectedSignal:"none"},
 {id:"goal_at_risk",label:"目标偏离",availableMonthly:52000,safeToSpend:90000,dataCoverage:1,missing:[],existingGoalCommitments:26000,expectedStatus:"at_risk",expectedSignal:"none"},
 {id:"goal_infeasible",label:"不可实现",availableMonthly:12000,safeToSpend:28000,dataCoverage:1,missing:[],existingGoalCommitments:52000,expectedStatus:"infeasible",expectedSignal:"none"},
 {id:"goal_small_change",label:"小额变化不提醒",availableMonthly:76000,safeToSpend:184000,dataCoverage:1,missing:[],existingGoalCommitments:0,changeAmount:1800,expectedStatus:"on_track",expectedSignal:"none"},
 {id:"goal_significant_change",label:"显著偏差",availableMonthly:76000,safeToSpend:184000,dataCoverage:1,missing:[],existingGoalCommitments:0,changeAmount:50000,expectedStatus:"at_risk",expectedSignal:"eligible"},
 {id:"goal_ignored_repeat",label:"忽略后抑制",availableMonthly:76000,safeToSpend:184000,dataCoverage:1,missing:[],existingGoalCommitments:0,changeAmount:50000,expectedStatus:"at_risk",expectedSignal:"suppressed"},
 {id:"goal_recovery",label:"调整后恢复",availableMonthly:102000,safeToSpend:210000,dataCoverage:1,missing:[],existingGoalCommitments:0,changeAmount:50000,expectedStatus:"on_track",expectedSignal:"eligible"},
];
export const resetGoalFixture=(id:string)=>structuredClone(goalScenarioFixtures.find(x=>x.id===id)??goalScenarioFixtures[1]);
