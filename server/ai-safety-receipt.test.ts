import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
process.env.NOVA_DB_PATH = join(mkdtempSync(join(tmpdir(),'nova-receipt-')), 'test.sqlite');
const { buildAiSafetyDecisionReceipt } = await import('./ai-safety-receipt.ts');
const { AiSafetyDecisionReceiptSchema } = await import('../shared/contracts.ts');
const db = new DatabaseSync(process.env.NOVA_DB_PATH);
const session='owner', thread='shared-thread', task=randomUUID(), demo=randomUUID();
const now=new Date().toISOString();
db.prepare('INSERT INTO demo_sessions VALUES(?,?,?,?)').run(session,JSON.stringify({audit:[]}),0,now);
function seed(toolId:string, reasonCode:string|null=null) {
 const runId=randomUUID();
 const payload={provider:'deterministic',reasonCode,decisionCount:2,toolCallCount:1,startedAt:now,updatedAt:now,
 steps:[{toolResultId:toolId,summary:'SECRET prompt filename account token'}],recommendedResultIds:[],question:'SECRET'};
 db.prepare('INSERT INTO agent_task_runs VALUES(?,?,?,?,?,?,?,?,?,?)').run(runId,session,thread,task,demo,randomUUID(),0,'completed',null,JSON.stringify(payload));
 return runId;
}
// Column count is explicit to keep fixture independent of future migrations.
function tool() { const id=randomUUID(); db.prepare(`INSERT INTO agent_tool_results
 (id,session_id,thread_id,task_id,run_id,twin_version,tool,dedupe_key,payload_json) VALUES(?,?,?,?,?,?,?,?,?)`)
 .run(id,session,thread,task,demo,7,'financial_overview',id,JSON.stringify({status:'ok',output:{content:'SECRET'},sourceEntities:[]})); return id; }
test('receipt isolates exact runs and sessions and rejects unsafe metadata',()=>{
 const firstTool=tool(),secondTool=tool(); const first=seed(firstTool,'SECRET token');const second=seed(secondTool);
 const receipt=buildAiSafetyDecisionReceipt(session,first);
 assert.equal(receipt.tools.length,1); assert.equal(receipt.skillId,null);assert.equal(receipt.fallbackReason,null);
 assert.deepEqual(receipt.evidenceIds,[firstTool]);
 assert.deepEqual(buildAiSafetyDecisionReceipt(session,second).evidenceIds,[secondTool]);
 assert.equal(receipt.twinVersion,7);assert.equal(receipt.completedAt,now);
 assert.equal(buildAiSafetyDecisionReceipt(session,second).tools.length,1);
 assert.throws(()=>buildAiSafetyDecisionReceipt('foreign',first),/AI_SAFETY_RECEIPT_NOT_FOUND/);
 assert.throws(()=>AiSafetyDecisionReceiptSchema.parse({...receipt,prompt:'secret'}));
 assert.doesNotMatch(JSON.stringify(receipt),/SECRET|prompt|message|content|reasoning|chainOfThought|token|filename/);
});
test('running receipt has no completion time and exact candidate action status is used',()=>{
 const reference=tool(),runId=seed(reference,'AI_SAFE_MODE');
 db.prepare("UPDATE agent_task_runs SET status='running',payload_json=json_set(payload_json,'$.recommendedResultIds',json(?)) WHERE run_id=?")
 .run(JSON.stringify([reference]),runId);
 const id=randomUUID();
 db.prepare(`INSERT INTO agent_actions VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id,session,thread,
 'apply_verified_candidate',7,'consumed',JSON.stringify({taskId:task,demoRunId:demo,resultId:reference,frozen:{title:'SECRET'}}),
 null,now,randomUUID(),now);
 const receipt=buildAiSafetyDecisionReceipt(session,runId);
 assert.equal(receipt.completedAt,null);assert.equal(receipt.fallbackReason,'AI_SAFE_MODE');
 assert.equal(receipt.confirmationStatus,'confirmed');assert.equal(receipt.requiresHumanConfirmation,true);
 assert.doesNotMatch(JSON.stringify(receipt),/SECRET|frozen/);
});

test('HTTP receipt is no-store and foreign sessions get 404', {timeout:30000}, async()=>{
 const {spawn}=await import('node:child_process');
 const {createServer}=await import('node:net');
 const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));
 const port=(probe.address() as {port:number}).port;await new Promise<void>(resolve=>probe.close(()=>resolve()));
 const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),NODE_ENV:'development'}});
 let output='';child.stderr.on('data',x=>output+=x);child.stdout.on('data',x=>output+=x);
 const base=`http://127.0.0.1:${port}`;
 try {
 let response:Response|undefined;
 for(let i=0;i<100;i++){try {response=await fetch(`${base}/api/session`);if(response.ok)break;}catch{} await new Promise(resolve=>setTimeout(resolve,100));}
 assert.ok(response?.ok,output);
 const cookie=response.headers.get('set-cookie')!.split(';')[0];
 const ownerRun=seed(tool());
 const foreign=await fetch(`${base}/api/ai-safety/runs/${ownerRun}/receipt`,{headers:{cookie}});
 assert.equal(foreign.status,404);assert.equal(foreign.headers.get('cache-control'),'no-store');
 assert.deepEqual(await foreign.json(),{error:'AI_SAFETY_RECEIPT_NOT_FOUND'});
 const row=db.prepare('SELECT id FROM demo_sessions WHERE id<>? ORDER BY updated_at DESC LIMIT 1').get(session)!;
 db.prepare('UPDATE agent_task_runs SET session_id=? WHERE run_id=?').run(row.id,ownerRun);
 const own=await fetch(`${base}/api/ai-safety/runs/${ownerRun}/receipt`,{headers:{cookie}});
 assert.equal(own.status,200);assert.equal(own.headers.get('cache-control'),'no-store');
 assert.equal((await own.json()).runId,ownerRun);
 }finally{child.kill();await new Promise<void>(resolve=>child.once('exit',()=>resolve()));}
});
test('recorded budget fallback retains its recognized control code',()=>{
 const runId=seed(tool(),'AGENT_RUN_BUDGET_EXHAUSTED');
 db.prepare("UPDATE agent_task_runs SET status='fallback' WHERE run_id=?").run(runId);
 assert.equal(buildAiSafetyDecisionReceipt(session,runId).fallbackReason,'AGENT_RUN_BUDGET_EXHAUSTED');
});
