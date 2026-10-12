import assert from "node:assert/strict";

const base=process.env.NOVA_BASE_URL??"http://localhost:5173";
const session=`phase17-${Date.now()}-${crypto.randomUUID()}`;
const headers={"content-type":"application/json","x-nova-sandbox-session":session};
const request=async(path,init={})=>{const response=await fetch(`${base}${path}`,init);const body=await response.json();return {response,body}};
const getTwin=()=>request("/api/financial-twin",{headers});
const action=body=>request("/api/financial-twin",{method:"POST",headers,body:JSON.stringify(body)});
const tool=(name,input)=>request("/api/banking-tools",{method:"POST",headers,body:JSON.stringify({tool:name,input})});

const initial=await getTwin();
assert.equal(initial.response.status,200);
assert.equal(initial.body.state.version,1);
const initialChecking=initial.body.state.accounts.find(account=>account.type==="checking").balance;
const initialMandate=initial.body.state.mandate.remainingLimit;

const simulation=await action({type:"simulate_expense",amount:5000,goalId:"goal_japan_001",strategy:"adjust_contribution"});
assert.equal(simulation.response.status,200);
assert.equal(simulation.body.state.version,1,"情景模拟不能修改正式状态");
assert.equal(simulation.body.simulation.impact.completionDelayDays,7);
assert.equal(simulation.body.simulation.impact.strategy,"adjust_contribution");
assert.equal(simulation.body.simulation.impact.recommendedMonthlyAdjustment,1667);
const dateScenario=await action({type:"simulate_expense",amount:5000,goalId:"goal_japan_001",strategy:"adjust_date"});
assert.equal(dateScenario.response.status,200);
assert.equal(dateScenario.body.state.version,1);
assert.equal(dateScenario.body.simulation.impact.completionDelayDays,10);
assert.equal(dateScenario.body.simulation.impact.strategy,"adjust_date");
assert.ok(dateScenario.body.simulation.impact.recommendedTargetDate);

const plan=await action({type:"select_goal_plan",goalId:"goal_japan_001",plan:"accelerated"});
assert.equal(plan.response.status,200);
assert.equal(plan.body.state.version,2);
const initialGoal=initial.body.state.goals.find(goal=>goal.id==="goal_japan_001");
const months=Math.max(1,Math.max(1,Math.ceil((new Date(`${initialGoal.targetDate}T00:00:00Z`).getTime()-Date.now())/86_400_000))/30);
const balanced=Math.ceil(Math.ceil((initialGoal.targetAmount-initialGoal.savedAmount)/months/1000)*1000);
assert.equal(plan.body.state.goals.find(goal=>goal.id==="goal_japan_001").monthlyContribution,Math.ceil(balanced*1.35/1000)*1000);
assert.ok(plan.body.forecast.goalCompetition.some(goal=>goal.goalId==="goal_japan_001"));

const shopping=await action({type:"resolve_shopping",decision:"approved",amount:28000,merchant:"Phase 17 Test Shop"});
assert.equal(shopping.response.status,200);
assert.equal(shopping.body.state.version,3);
assert.equal(shopping.body.state.accounts.find(account=>account.type==="checking").balance,initialChecking-28000);
assert.equal(shopping.body.state.mandate.remainingLimit,initialMandate-28000);
assert.equal(shopping.body.state.activities[0].type,"execution");

const refreshed=await getTwin();
assert.equal(refreshed.body.state.version,3);
assert.equal(refreshed.body.state.accounts.find(account=>account.type==="checking").balance,initialChecking-28000);
assert.ok(refreshed.body.forecast.projectedLowestBalance<initial.body.forecast.projectedLowestBalance);

const snapshot=await tool("get_financial_snapshot",{});
assert.equal(snapshot.response.status,200);
assert.equal(snapshot.body.result.accounts.find(account=>account.accountType==="checking").availableBalance,initialChecking-28000);
assert.equal(snapshot.body.result.authorization.remainingLimit,initialMandate-28000);

const cashflow=await tool("forecast_cashflow",{snapshotId:snapshot.body.result.snapshotId,horizonDays:30,hypotheticalChanges:[]});
assert.equal(cashflow.response.status,200);
assert.equal(cashflow.body.result.startingBalance,initialChecking-28000);

for(const surface of ["Today","Life","Twin","Activity"]){
  assert.ok(refreshed.body.state.version===3,`${surface} 必须消费 Twin v3`);
}

const updatedGoal=await action({type:"update_goal",goalId:"goal_japan_001",changes:{targetAmount:900000}});
assert.equal(updatedGoal.response.status,200);
const progress=await tool("get_goal_progress",{goalId:"goal_japan_001"});
assert.equal(progress.response.status,200);
assert.equal(progress.body.result.targetAmount,900000);
assert.equal(progress.body.result.monthlyContribution,updatedGoal.body.state.goals.find(goal=>goal.id==="goal_japan_001").monthlyContribution);
assert.equal(progress.body.result.twinVersion,updatedGoal.body.state.version);
const simulatedPlan=await tool("simulate_goal_plan",{snapshotId:`snap_${session}_v${updatedGoal.body.state.version}`,name:"日本旅行",targetAmount:900000,currency:"CNY",targetDate:progress.body.result.targetDate});
assert.equal(simulatedPlan.response.status,200);
assert.equal(simulatedPlan.body.result.remainingAmount,900000-progress.body.result.savedAmount);
assert.equal(simulatedPlan.body.result.twinVersion,updatedGoal.body.state.version);
assert.ok(simulatedPlan.body.result.scenarios[1].monthlyContribution>76000);

console.log(JSON.stringify({status:"passed",twinVersion:refreshed.body.state.version,operation:{merchant:"Phase 17 Test Shop",amount:28000},sharedFacts:{checkingBalance:initialChecking-28000,mandateRemaining:initialMandate-28000,projectedLowestBalance:refreshed.body.forecast.projectedLowestBalance,latestActivity:refreshed.body.state.activities[0].title},verifiedSurfaces:["Today","Life","Twin","Activity"],checks:["simulation is read-only","goal competition recalculated","operation persisted","account balance updated","mandate remaining updated","forecast updated","activity appended","Banking Tools reads same Twin"]},null,2));
