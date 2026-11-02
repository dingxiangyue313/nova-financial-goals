import 'dotenv/config';import fs from 'node:fs';import {randomUUID} from 'node:crypto';
import {converse} from '../server/chat-controller.ts';import {getState,mutateState,getConversationState,getReplyEvidence} from '../server/store.ts';
import {createFixture} from '../server/fixtures.ts';import {initializeServices} from '../server/financial-services.ts';
import {DataConnectionSchema} from '../shared/contracts.ts';
type Step={text:string;contains?:string[];excludes?:string[];mode?:string;goal?:Record<string,string|number|null>;proof?:string;noProof?:boolean};
type Scenario={fixture?:'current'|'stale'|'ledger'|'active'|'multiple';steps:Step[]};
const cases:Scenario[]=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const out=process.argv[3];fs.writeFileSync(out+'.cases.json',JSON.stringify(cases,null,2));
function seed(session:string,kind:Scenario['fixture']){
 getState(session);if(!kind)return;
 mutateState(session,()=>{
  let s=createFixture();s.clock='2026-11-02';s.goal.targetDate='2027-12-15';s.goal.originalDate=s.goal.targetDate;s.goals=[s.goal];
  if(kind==='ledger'||kind==='multiple')s=initializeServices(s);
  if(kind==='multiple')s.goals.push({...s.goal,id:'goal-study',title:'学习',savedCents:0});
  if(kind==='active'){s.goal.status='active';s.goals=[s.goal];s.finance.historyMonths=3;s.dataConnections=[DataConnectionSchema.parse({id:'bank',source:'bank',label:'银行卡',status:'connected',simulated:true,permissionScopes:['balances','transactions_90_days'],connectedAt:s.clock})];}
  if(['current','stale','active'].includes(kind!))s.accountSnapshots=s.accounts.map(a=>({id:'snapshot-'+a.id,accountId:a.id,balanceCents:a.balanceCents,currency:a.currency,asOf:kind==='stale'?'2026-09-21':s.clock,sourceKind:'simulated_connection',sourceId:'fixture-bank',twinVersion:s.twinVersion,createdAt:s.clock+'T12:00:00Z'}));
  return s;
 });
}
let cursor=0;const rows:Array<{index:number;pass:boolean;safe:boolean;turns:unknown[]}> =[];
await Promise.all(Array.from({length:3},async()=>{while(cursor<cases.length){const index=cursor++,c=cases[index],session=randomUUID();seed(session,c.fixture);const before=structuredClone(getState(session));let thread:string|null=null;const turns:Array<{step:Step;pass:boolean;response?:unknown;error?:string}>=[];
 for(const step of c.steps){try{
  const r=await converse(session,thread,step.text);thread=r.threadId;const state=getConversationState(session,thread),task=state.tasks.find(t=>t.id===state.activeTaskId);
  const reply=r.turn?.message.content??r.decision.question??'';const proof=r.turn?getReplyEvidence(session,thread,r.turn.message.id):[];
  const pass=r.provider!=='unavailable'&&(!step.mode||r.decision.mode===step.mode)&&(!step.contains||step.contains.every(t=>reply.includes(t)))&&(!step.excludes||step.excludes.every(t=>!reply.includes(t)))&&(!step.goal||Object.entries(step.goal).every(([k,v])=>v===null?task?.goal[k as keyof typeof task.goal]==null:task?.goal[k as keyof typeof task.goal]===v))&&(!step.proof||proof.some(p=>p.kind===step.proof))&&(!step.noProof||proof.length===0);
  turns.push({step,pass,response:r});
 }catch(e){turns.push({step,pass:false,error:e instanceof Error?e.message:String(e)});}}
 const after=getState(session),safe=JSON.stringify(before.accounts)===JSON.stringify(after.accounts)&&JSON.stringify(before.goals)===JSON.stringify(after.goals);
 const row={index,pass:safe&&turns.every(t=>t.pass),safe,turns};rows.push(row);console.log(JSON.stringify({index,pass:row.pass,failed:turns.filter(t=>!t.pass).map(t=>t.step.text)}));
}}));
const summary={conversations:rows.length,passed:rows.filter(r=>r.pass).length,turns:rows.reduce((n,r)=>n+r.turns.length,0),safe:rows.every(r=>r.safe)};fs.writeFileSync(out,JSON.stringify({summary,rows},null,2));console.log(JSON.stringify(summary));
