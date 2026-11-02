import * as store from './store.ts';
import {interpretConversation,reduceConversation,goalUnderstanding,navigationMemory} from './conversation.ts';
import {createAgentTurn} from './workspace.ts';
import {ChatRouteDecisionSchema} from '../shared/chat-routing.ts';
import {startAgentRun} from './agent-runner.ts';
import {readConversationFacts} from './conversation-facts.ts';
import {renderServiceReply,renderClarification} from './conversation-replies.ts';
import {productKnowledge} from '../shared/product-knowledge.ts';
export async function converse(sessionId:string,threadId:string|null,message:string){
 const thread=threadId?store.getAgentThread(sessionId,threadId):store.createAgentThread(sessionId,{title:message.slice(0,40)});
 if(thread.readOnly||thread.status==='archived')throw Error('THREAD_ARCHIVED');
 const state=store.getConversationState(sessionId,thread.id);
 const context=store.getAgentMessages(sessionId,thread.id).map(m=>({role:m.role,content:m.content}));
 const snapshot=store.getState(sessionId);
 const references={accounts:snapshot.accounts.map(a=>({id:a.id,label:a.label})),goals:snapshot.goals.map(g=>({id:g.id,title:g.title})),orders:snapshot.financialServices.bookings.map(b=>({id:b.id,goalId:b.goalId,kind:b.merchantId==='air-demo'?'机票':'住宿'}))};
 const result=await interpretConversation(message,context,state,snapshot.clock,false,references);
 const before=state.tasks.find(t=>t.id===state.activeTaskId);
 const fail=(question:string,reason:string)=>({decision:ChatRouteDecisionSchema.parse({mode:'clarify',destination:null,question}),provider:'unavailable',reason,threadId:thread.id,memory:navigationMemory(before),turn:null});
 if(!result.ok)return fail(result.reason==='DEEPSEEK_BILLING'?'AI服务计费状态异常，请检查服务端账户余额或计费设置。你的输入已保留。':result.reason==='DEEPSEEK_AUTH'?'AI服务认证失败，请检查服务端配置。你的输入已保留。':result.reason==='DEEPSEEK_RATE_LIMIT'?'AI服务请求过于频繁，请稍后重试。你的输入已保留。':'AI服务暂时无法响应，你的输入已保留，请重试。',result.reason);
 let reduced:ReturnType<typeof reduceConversation>;
 try{reduced=reduceConversation(state,result.data,message,store.getState(sessionId).clock);}catch(e){return fail(e instanceof Error&&e.message==='CONVERSATION_TASK_CANCELLED'?'该任务已取消。你想重新新建一项吗？':'这次修改还无法安全确认，请补充具体对象、金额或日期。',e instanceof Error?e.message:'INVALID_COMMAND');}
 const command=result.data,{task}=reduced;
 if(reduced.choices?.length){
  const question='你想继续哪一个任务？'+reduced.choices.map(t=>`${t.name||t.goal.title||'未命名目标'}${t.goal.targetCents!=null?`（预算${Number(t.goal.targetCents)/100}元）`:''}`).join('、');
  store.saveAgentMessage(sessionId,thread.id,{role:'user',content:message,components:[]});
  store.saveAgentMessage(sessionId,thread.id,{role:'assistant',content:question,components:[]});
  return {decision:ChatRouteDecisionSchema.parse({mode:'clarify',destination:null,question:question.slice(0,160)}),provider:'deepseek',reason:null,threadId:thread.id,memory:navigationMemory(before),turn:null};
 }
 // Optimistic locking covers the entire interpretation, including slow model calls.
 try{store.saveConversationState(sessionId,thread.id,reduced.state,state.version);}catch{return fail('任务信息刚刚发生变化，请重新确认这次修改。','CONVERSATION_STATE_CHANGED');}
 const chosenId=command.taskId??(command.taskCandidates.length===1?command.taskCandidates[0]:null);
 const selected=Boolean(chosenId&&reduced.state.activeTaskId===chosenId&&command.lifecycle!=='new');
 const isGoal=task?.kind==='goal'&&(['goal','resume'].includes(command.operation)||selected&&command.operation==='clarify');
 const navigate=task?.kind==='service'&&(['navigate','resume'].includes(command.operation)||selected&&command.operation==='clarify');
 const reading=command.operation==='read_facts';
 const facts=reading&&command.read?readConversationFacts(store.getState(sessionId),command.read):null;
 const knowledge=command.knowledgeRefs.map(id=>productKnowledge[id].text).join('\n');
 const explanation=reading?[facts?.body??'请说明想查询账户余额、目标资金、目标进度还是旅行订单。',knowledge].filter(Boolean).join('\n')
  :command.operation==='explain'?knowledge||'这部分目前缺少可靠说明。你想了解哪个功能的使用方式？':null;
 const decision=ChatRouteDecisionSchema.parse({mode:isGoal||explanation?'chat':navigate?'navigate':'clarify',destination:navigate?task.capability:null,
  question:isGoal||navigate||explanation?null:command.operation==='cancel'?task?`已取消“${task.name||task.goal.title||'当前任务'}”，未执行资金操作。`:'目前没有正在进行的任务。':renderClarification(command,task),
  chatIntent:isGoal?'goal_planning':explanation?'clarification':null,answer:explanation?.slice(0,500)??null,memoryAction:command.lifecycle});
 const memory=navigationMemory(task);
 store.saveChatMemory(sessionId,thread.id,memory);
 let turn=null;
 if(isGoal||explanation){
  turn=await createAgentTurn(sessionId,thread.id,message,store.getState(sessionId),{intent:isGoal?'goal_planning':'clarification',explanation,provider:'deepseek',fallbackReason:null,
   ...(isGoal&&task?{understanding:goalUnderstanding(task,null),canonicalTaskId:task.id,goalReply:{before:state,task}}:{})});
 }else{
  store.cancelActiveAgentRunForThread(sessionId,thread.id);
  store.saveAgentMessage(sessionId,thread.id,{role:'user',content:message,components:[]});
  store.saveAgentMessage(sessionId,thread.id,{role:'assistant',content:navigate?renderServiceReply(task!):decision.question!,components:[]});
 }
 const latest=store.getAgentMessages(sessionId,thread.id).filter(m=>m.role==='user').at(-1);
 if(facts&&turn)store.saveReplyEvidence(sessionId,thread.id,turn.message.id,facts.proof);
 const run=turn?.intent==='goal_planning'&&turn.components.some(c=>c.type==='goal_input_card')&&!turn.components.some(c=>c.type==='clarification'||c.type==='data_connection_prompt')&&latest?startAgentRun(sessionId,thread.id,latest.id):null;
 return {decision,provider:'deepseek',reason:null,threadId:thread.id,memory,turn:turn?{...turn,run}:null,replyEvidence:facts?.proof??[]};
}
