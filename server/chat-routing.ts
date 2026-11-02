// Compatibility classifier. Production chat uses converse() and persistent state.
import {interpretConversation,reduceConversation} from './conversation.ts';
import {ConversationStateSchema} from '../shared/conversation.ts';
import {ChatRouteDecisionSchema} from '../shared/chat-routing.ts';
export async function routeChat(message:string,context:Array<{role:string;content:string}>=[],memory:unknown=null){
 const state=ConversationStateSchema.safeParse(memory);
 const initial=state.success?state.data:ConversationStateSchema.parse({});
 const result=await interpretConversation(message,context,initial,new Date().toISOString().slice(0,10));
 if(!result.ok)return {decision:ChatRouteDecisionSchema.parse({mode:'clarify',destination:null,question:'AI服务暂时无法响应，请重试。'}),provider:'unavailable' as const,reason:result.reason};
 try{
  const {task}=reduceConversation(initial,result.data,message),c=result.data;
  const goal=task?.kind==='goal'&&['goal','resume'].includes(c.operation);
  const nav=task?.kind==='service'&&['navigate','resume'].includes(c.operation);
  return {decision:ChatRouteDecisionSchema.parse({mode:goal||c.operation==='explain'?'chat':nav?'navigate':'clarify',destination:nav?task.capability:null,question:goal||nav||c.operation==='explain'?null:c.question??'请补充要办理的事项。',chatIntent:goal?'goal_planning':c.operation==='explain'?'clarification':null,answer:c.answer}),provider:'deepseek' as const,reason:null};
 }catch{return {decision:ChatRouteDecisionSchema.parse({mode:'clarify',destination:null,question:'请确认本次修改的信息。'}),provider:'unavailable' as const,reason:'INVALID_SEMANTIC_COMMAND'};}
}
