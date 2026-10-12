const base=process.env.NOVA_BASE_URL??"http://localhost:5173";
const session=`replan-check-${crypto.randomUUID()}`;
const headers={"content-type":"application/json","x-nova-sandbox-session":session};

async function request(path,options={}){
  const response=await fetch(new URL(path,base),{...options,headers:{...headers,...options.headers}});
  const body=await response.json();
  if(!response.ok)throw new Error(`${path}: HTTP ${response.status} ${JSON.stringify(body.error??body)}`);
  return body;
}
async function tool(name,input,confirmed=false){return (await request("/api/banking-tools",{method:"POST",headers:confirmed?{"x-nova-user-confirmed":"true"}:{},body:JSON.stringify({tool:name,input})})).result;}

const before=await request("/api/financial-twin");
const goal=before.state.goals.find(item=>item.priority>0);
if(!goal)throw new Error("No editable demo goal");
const targetAmount=goal.targetAmount+10_000;
const prompt=`把${goal.name}目标金额改为${targetAmount/100}元，重新规划每月投入，不动应急金。`;
const plan=await request("/api/agent",{method:"POST",body:JSON.stringify({message:prompt,contextGoalId:goal.id})});
if(plan.provider!=="deepseek"||plan.fallback||plan.intent?.intent!=="update_goal")throw new Error("Live DeepSeek update planning was not selected");
const draft=plan.plan?.toolCalls?.find(item=>item.name==="update_goal");
if(draft?.arguments?.goalId!==goal.id||draft.arguments.changes?.targetAmount!==targetAmount)throw new Error("AI draft did not match the requested target");
const parameters={goalId:goal.id,changes:draft.arguments.changes};
const snapshot=await tool("create_approval_snapshot",{action:"update_goal",parameters,expiresInSeconds:300});
const approval=await tool("confirm_approval",{approvalId:snapshot.approvalId,snapshotHash:snapshot.snapshotHash,confirmed:true},true);
await tool("update_goal",{...parameters,approvalToken:approval.approvalToken,idempotencyKey:`verify-${crypto.randomUUID()}`});
const after=await request("/api/financial-twin");
const updated=after.state.goals.find(item=>item.id===goal.id);
if(updated?.targetAmount!==targetAmount||after.state.version<=before.state.version)throw new Error("Confirmed update did not reach Financial Twin");
console.log(JSON.stringify({status:"passed",provider:plan.provider,intent:plan.intent.intent,goalId:goal.id,versionBefore:before.state.version,versionAfter:after.state.version}));
