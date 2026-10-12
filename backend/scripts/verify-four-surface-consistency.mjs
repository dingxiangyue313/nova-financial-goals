import assert from "node:assert/strict";

const base=process.env.NOVA_BASE_URL??"http://localhost:5173";const session=`surface-${Date.now()}-${crypto.randomUUID()}`;const headers={"content-type":"application/json","x-nova-sandbox-session":session};
const request=async(path,init={})=>{const response=await fetch(`${base}${path}`,init);const body=await response.json();return {response,body}};
const tool=(name,input,confirmed=false)=>request("/api/banking-tools",{method:"POST",headers:{...headers,...(confirmed?{"x-nova-user-confirmed":"true"}:{})},body:JSON.stringify({tool:name,input})});

const initial=await request("/api/financial-twin",{headers});assert.equal(initial.response.status,200);const before=initial.body.state.version;const parameters={goalId:"goal_japan_001",changes:{monthlyContribution:150000}};
const snapshot=await tool("create_approval_snapshot",{action:"update_goal",parameters,expiresInSeconds:300});
const confirmation=await tool("confirm_approval",{approvalId:snapshot.body.result.approvalId,snapshotHash:snapshot.body.result.snapshotHash,confirmed:true},true);
const update=await tool("update_goal",{...parameters,approvalToken:confirmation.body.result.approvalToken,idempotencyKey:`surface-update-${session}`});assert.equal(update.response.status,200);
const twin=await request("/api/financial-twin",{headers});const bankingSnapshot=await tool("get_financial_snapshot",{});const activity=await tool("get_activity",{limit:50});
const goal=twin.body.state.goals.find(item=>item.id==="goal_japan_001");const audit=activity.body.result.events.find(item=>item.event_type==="goal_updated"&&item.object_id==="goal_japan_001");
assert.equal(twin.body.state.version,update.body.result.twinVersion);assert.equal(goal.monthlyContribution,150000);assert.equal(bankingSnapshot.body.result.goals.find(item=>item.id==="goal_japan_001").monthlyContribution,150000);assert.ok(twin.body.state.activities.some(item=>item.title.includes("目标已调整")));assert.ok(audit);
const surfaces={Today:{twinVersion:twin.body.state.version,monthlyContribution:goal.monthlyContribution},Life:{twinVersion:twin.body.state.version,goalId:goal.id,status:goal.status},Twin:{twinVersion:twin.body.state.version,snapshotId:bankingSnapshot.body.result.snapshotId},Activity:{twinVersion:twin.body.state.version,evidenceId:audit.id,eventType:audit.event_type}};
assert.ok(Object.values(surfaces).every(surface=>surface.twinVersion===update.body.result.twinVersion));
console.log(JSON.stringify({status:"passed",beforeVersion:before,afterVersion:update.body.result.twinVersion,operationId:update.body.result.operationId,surfaces,checks:["single server mutation","Today updated","Life updated","Twin snapshot updated","Activity audit updated","all surfaces share one Twin version"]},null,2));
