import type { Express, Request, Response, RequestHandler } from 'express';
import { z } from 'zod';
import { ServiceActionSchema } from '../shared/financial-services.ts';
import { createAgentAction, createAgentThread, finishAgentAction, getAgentAction, getState, mutateState } from './store.ts';
import { appendAuditEvent, createApprovalSnapshot, confirmApproval, consumeApproval } from './governance.ts';
import { collectSplit, describeServiceAction, executeServiceAction, financialServicesView, reconcileServices, requestTravelQuotes } from './financial-services.ts';
import { containsPromptInjection } from './security.ts';
import { listSkillDefinitions } from './skills/registry.ts';
import { executeMoneyMissionSkill } from './skills/core-skills.ts';

export function registerFinancialServices(app:Express,sessionId:(req:Request,res:Response)=>string,route:(fn:(req:Request,res:Response)=>unknown)=>RequestHandler){
  app.get('/api/services/skills',route((_req,res)=>res.json({skills:listSkillDefinitions().map(({inputSchema:_i,outputSchema:_o,...definition})=>definition)})));
  app.post('/api/services/skills/inspect',route(async(req,res)=>{
    const body=z.object({skillId:z.enum(['recipient_and_split_coordinator','investment_lifecycle_manager','card_lifecycle_manager','mandate_builder','external_agent_request_inbox']),input:z.record(z.string(),z.unknown())}).strict().parse(req.body);
    const id=sessionId(req,res),thread=createAgentThread(id,{title:'金融任务证据',dedupeKey:'financial-service-evidence'});
    res.json(await executeMoneyMissionSkill(id,thread.id,body.skillId,body.input));
  }));
  app.get('/api/services',route((req,res)=>res.json(financialServicesView(getState(sessionId(req,res))))));
  app.post('/api/services/interpret',route((req,res)=>{
    const {message}=z.object({message:z.string().trim().min(1).max(1000)}).strict().parse(req.body);
    if(containsPromptInjection(message))throw new Error('SERVICE_UNTRUSTED_INSTRUCTION');
    const tab=/账单|订阅|代扣|消费分类|异常交易/.test(message)?'bills':/理财|申购|赎回|产品|风险评估/.test(message)?'wealth':/信用卡|借记卡|卡片|挂失|解锁|调额/.test(message)?'cards':/转账|给.+转|AA|收款/i.test(message)?'transfers':/机票|住宿|报价|预订|商户|授权/.test(message)?'travel':'overview';
    const match=message.match(/给(.+?)(?:转|支付)/),amount=message.match(/(?:转|支付|申购)\s*[¥￥]?\s*(\d+(?:\.\d{1,2})?)/);
    res.json({tab,provider:'deterministic',explanation:'已按明确关键词整理任务。请核对对象、条件和预览；理解这句话不会直接执行金融操作。',draft:{...(match?{query:match[1].trim()}:{}),...(amount?{amount:amount[1]}:{})}});
  }));
  app.post('/api/services/quotes',route((req,res)=>{
    z.object({}).strict().parse(req.body);const id=sessionId(req,res);
    res.json(financialServicesView(mutateState(id,s=>requestTravelQuotes(s))));
  }));
  app.post('/api/services/prepare',route((req,res)=>{
    const input=ServiceActionSchema.parse(req.body),id=sessionId(req,res);
    const thread=createAgentThread(id,{title:'金融任务确认',dedupeKey:'financial-service-actions'});
    let confirmation:unknown;
    mutateState(id,s=>{
      const p=describeServiceAction(s,input);
      const params={input:p.action,manifestHash:p.manifestHash};
      const approval=createApprovalSnapshot(p.state,`financial_service:${input.kind}`,params,`${s.clock}T12:05:00.000Z`);
      const action=createAgentAction(id,thread.id,'financial_service',s.twinVersion,{...params,approvalId:approval.approval.id,snapshotHash:approval.approval.snapshotHash});
      confirmation={actionId:action.id,title:'核对模拟金融操作',body:p.label,amountCents:p.amountCents,expiresAt:action.expiresAt,details:p.details};
      return appendAuditEvent(approval.state,'financial_service_prepare','prepared',p.label,{approvalId:approval.approval.id,requestId:action.id});
    });
    res.json({confirmation,view:financialServicesView(getState(id))});
  }));
  app.post('/api/services/confirm',route((req,res)=>{
    const body=z.object({actionId:z.string(),decision:z.enum(['confirm','cancel'])}).strict().parse(req.body),id=sessionId(req,res);
    mutateState(id,s=>{
      const a=getAgentAction(id,body.actionId);if(a.actionType!=='financial_service')throw new Error('AGENT_ACTION_NOT_ALLOWED');
      if(a.status==='consumed')return s;if(a.status!=='pending')throw new Error('AGENT_ACTION_NOT_PENDING');
      if(body.decision==='cancel'){finishAgentAction(id,a.id,'cancelled',{});return appendAuditEvent(s,'financial_service_cancel','cancelled','用户取消，未执行金融操作。',{requestId:a.id});}
      if(a.twinVersion!==s.twinVersion||Date.parse(a.expiresAt)<=Date.now())throw new Error('TWIN_VERSION_CHANGED');
      const payload=z.object({input:ServiceActionSchema,manifestHash:z.string(),approvalId:z.string(),snapshotHash:z.string()}).strict().parse(a.payload);
      const current=describeServiceAction(s,payload.input);if(current.manifestHash!==payload.manifestHash)throw new Error('APPROVAL_PARAMETERS_CHANGED');
      const approved=confirmApproval(s,payload.approvalId,payload.snapshotHash);
      let permitted=consumeApproval(approved.state,approved.token,`financial_service:${payload.input.kind}`,{input:payload.input,manifestHash:payload.manifestHash});
      permitted=appendAuditEvent(permitted,'financial_service_permission','authorized','已核对用户、准确参数、版本与时效。',{operationId:a.id,approvalId:payload.approvalId});
      permitted=appendAuditEvent(permitted,'financial_service_risk','passed','资金、目标、卡片、产品与报价条件已重新核对。',{operationId:a.id});
      const result=executeServiceAction(permitted,payload.input,a.id);
      const receipt=result.financialServices.receipts.find(r=>r.operationId===a.id)!;
      finishAgentAction(id,a.id,'consumed',{operationId:a.id,status:receipt.status});
      return appendAuditEvent(result,'financial_service_verify',receipt.status,receipt.status==='succeeded'?'模拟服务结果已核对。':'请求已持久化，按原操作查询后续结果。',{operationId:a.id,approvalId:payload.approvalId});
    });
    res.json(financialServicesView(getState(id)));
  }));
  app.post('/api/services/reconcile',route((req,res)=>{
    const input=z.object({id:z.string().optional()}).strict().parse(req.body),id=sessionId(req,res);
    res.json(financialServicesView(mutateState(id,s=>reconcileServices(s,input.id))));
  }));
  app.post('/api/services/splits/:id/status',route((req,res)=>{
    z.object({}).strict().parse(req.body);const id=sessionId(req,res);
    res.json(financialServicesView(mutateState(id,s=>collectSplit(s,req.params.id))));
  }));
  app.post('/api/demo/services/fault',route((req,res)=>{
    const input=z.object({fault:z.enum(['none','decline','timeout_before','timeout_after','partial'])}).strict().parse(req.body);
    mutateState(sessionId(req,res),s=>({...s,financialServices:{...s.financialServices,fault:input.fault}}));res.json({configured:true});
  }));
}
