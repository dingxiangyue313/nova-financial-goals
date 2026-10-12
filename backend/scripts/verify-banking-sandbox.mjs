import assert from "node:assert/strict";

const base=process.env.NOVA_BASE_URL??"http://localhost:5173";
const session=`phase16-${Date.now()}-${crypto.randomUUID()}`;
const headers={"content-type":"application/json","x-nova-sandbox-session":session};

async function json(path,init={}){
  const response=await fetch(`${base}${path}`,init);
  const body=await response.json();
  return {response,body};
}
async function tool(name,input,extraHeaders={}){
  return json("/api/banking-tools",{method:"POST",headers:{...headers,...extraHeaders},body:JSON.stringify({tool:name,input})});
}

const discovery=await json("/api/banking-tools");
assert.equal(discovery.response.status,200);
assert.equal(discovery.body.status,"ready");

const unauthenticated=await json("/api/banking-tools",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({tool:"get_financial_snapshot",input:{}})});
assert.equal(unauthenticated.response.status,401);
assert.equal(unauthenticated.body.error.code,"AUTH_REQUIRED");

const snapshot=await tool("get_financial_snapshot",{});
assert.equal(snapshot.response.status,200);
assert.match(snapshot.body.result.snapshotId,/^snap_sandbox_/);

const risk=await tool("risk_check",{action:"execute_transfer",amount:800000,snapshotId:snapshot.body.result.snapshotId,idempotencyKey:`risk-${session}`});
assert.equal(risk.response.status,200);
assert.equal(risk.body.result.status,"fail");

const unsafePrepare=await tool("prepare_transfer",{snapshotId:snapshot.body.result.snapshotId,sourceAccountId:"acc_checking_001",destinationAccountId:"acc_goal_japan_001",amount:800000,currency:"CNY",schedule:{type:"once",firstExecutionDate:"2026-09-24"}});
assert.equal(unsafePrepare.response.status,200);
assert.equal(unsafePrepare.body.result.status,"prepared");
assert.ok(unsafePrepare.body.result.balanceAfter<unsafePrepare.body.result.safetyBuffer);

const goal={planId:"plan_phase16",name:"Phase 16 验证目标",targetAmount:800000,currency:"CNY",targetDate:"2027-04-10",protectedAccountIds:["acc_emergency_001"]};
const approvalSnapshot=await tool("create_approval_snapshot",{action:"create_goal",parameters:goal,expiresInSeconds:300});
assert.equal(approvalSnapshot.response.status,200);

const crossUser=await json("/api/banking-tools",{method:"POST",headers:{"content-type":"application/json","x-nova-sandbox-session":`${session}-other`,"x-nova-user-confirmed":"true"},body:JSON.stringify({tool:"confirm_approval",input:{approvalId:approvalSnapshot.body.result.approvalId,snapshotHash:approvalSnapshot.body.result.snapshotHash,confirmed:true}})});
assert.equal(crossUser.response.status,404);
assert.equal(crossUser.body.error.code,"NOT_FOUND");

const confirmation=await tool("confirm_approval",{approvalId:approvalSnapshot.body.result.approvalId,snapshotHash:approvalSnapshot.body.result.snapshotHash,confirmed:true},{"x-nova-user-confirmed":"true"});
assert.equal(confirmation.response.status,200);
const createInput={...goal,approvalToken:confirmation.body.result.approvalToken,idempotencyKey:`idem-${session}`};
const first=await tool("create_goal",createInput);
const replay=await tool("create_goal",createInput);
assert.equal(first.response.status,200);
assert.equal(replay.response.status,200);
assert.equal(first.body.result.operationId,replay.body.result.operationId);

const conflict=await tool("create_goal",{...createInput,name:"被修改的目标"});
assert.equal(conflict.response.status,409);
assert.equal(conflict.body.error.code,"IDEMPOTENCY_CONFLICT");

const updateParameters={goalId:first.body.result.goalId,changes:{monthlyContribution:150000}};
const updateSnapshot=await tool("create_approval_snapshot",{action:"update_goal",parameters:updateParameters,expiresInSeconds:300});
assert.equal(updateSnapshot.response.status,200);
const updateConfirmation=await tool("confirm_approval",{approvalId:updateSnapshot.body.result.approvalId,snapshotHash:updateSnapshot.body.result.snapshotHash,confirmed:true},{"x-nova-user-confirmed":"true"});
assert.equal(updateConfirmation.response.status,200);
const tamperedUpdate=await tool("update_goal",{goalId:updateParameters.goalId,changes:{monthlyContribution:250000},approvalToken:updateConfirmation.body.result.approvalToken,idempotencyKey:`update-tampered-${session}`});
assert.equal(tamperedUpdate.response.status,400);
assert.equal(tamperedUpdate.body.error.code,"APPROVAL_INVALID");
const updateInput={...updateParameters,approvalToken:updateConfirmation.body.result.approvalToken,idempotencyKey:`update-${session}`};
const updateResult=await tool("update_goal",updateInput);
const updateReplay=await tool("update_goal",updateInput);
assert.equal(updateResult.response.status,200);
assert.equal(updateReplay.response.status,200);
assert.equal(updateResult.body.result.operationId,updateReplay.body.result.operationId);

const selected=await json("/api/financial-twin",{method:"POST",headers,body:JSON.stringify({type:"select_goal_plan",goalId:"goal_japan_001",plan:"balanced"})});
assert.equal(selected.response.status,200);
const twinBeforeActivation=await json("/api/financial-twin",{headers});
assert.equal(twinBeforeActivation.response.status,200);
const activationParameters={goalId:"goal_japan_001",selectedPlan:twinBeforeActivation.body.state.goals.find(goal=>goal.id==="goal_japan_001").selectedPlan,twinVersion:twinBeforeActivation.body.state.version};
const activationSnapshot=await tool("create_approval_snapshot",{action:"activate_goal",parameters:activationParameters,expiresInSeconds:300});
const activationConfirmation=await tool("confirm_approval",{approvalId:activationSnapshot.body.result.approvalId,snapshotHash:activationSnapshot.body.result.snapshotHash,confirmed:true},{"x-nova-user-confirmed":"true"});
assert.equal(activationConfirmation.response.status,200);
const tamperedActivation=await tool("activate_goal",{...activationParameters,selectedPlan:activationParameters.selectedPlan==="balanced"?"accelerated":"balanced",approvalToken:activationConfirmation.body.result.approvalToken,idempotencyKey:`activate-tampered-${session}`});
assert.equal(tamperedActivation.response.status,409);
assert.equal(tamperedActivation.body.error.code,"GOAL_PLAN_NOT_SELECTED");
const activationInput={...activationParameters,approvalToken:activationConfirmation.body.result.approvalToken,idempotencyKey:`activate-${session}`};
const activationResult=await tool("activate_goal",activationInput);
const activationReplay=await tool("activate_goal",activationInput);
assert.equal(activationResult.response.status,200);
assert.equal(activationReplay.response.status,200);
assert.equal(activationResult.body.result.operationId,activationReplay.body.result.operationId);
assert.equal(activationResult.body.result.autoTransferAuthorized,false);

const activity=await tool("get_activity",{limit:20});
assert.equal(activity.response.status,200);
assert.ok(activity.body.result.events.some(event=>event.event_type==="goal_created"));
assert.ok(activity.body.result.events.some(event=>event.event_type==="goal_updated"));
assert.ok(activity.body.result.events.some(event=>event.event_type==="goal_activated"));

const auditExport=await tool("export_audit_report",{format:"json"});
assert.equal(auditExport.response.status,200);
assert.equal(auditExport.body.result.tamperEvident,true);
assert.match(auditExport.body.result.reportHash,/^[a-f0-9]{64}$/);

const mcpList=await json("/api/mcp",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/list"})});
assert.equal(mcpList.response.status,200);
assert.ok(mcpList.body.result.tools.length>0);
assert.ok(!mcpList.body.result.tools.some(tool=>tool.name==="confirm_approval"));

const unsignedMcp=await json("/api/mcp",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:2,method:"tools/call",params:{name:"get_financial_snapshot",arguments:{}}})});
assert.equal(unsignedMcp.response.status,401);
assert.equal(unsignedMcp.body.error.data.code,"AGENT_AUTH_REQUIRED");

console.log(JSON.stringify({status:"passed",checks:["service discovery","authentication","user isolation","server-side risk rejection","approval permission","idempotent replay","idempotency conflict","goal update approval binding","goal update tamper rejection","goal update replay protection","goal activation approval binding","goal activation tamper rejection","goal activation replay protection","activation grants no auto-transfer","audit persistence","tamper-evident audit export","MCP scope","MCP auth required"],operationId:first.body.result.operationId,updateOperationId:updateResult.body.result.operationId,activationOperationId:activationResult.body.result.operationId},null,2));
