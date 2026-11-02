import {test,expect} from '@playwright/test';
test('normal clarification is a conversation; service failure preserves the input',async({page})=>{
 await page.goto('/');await page.getByRole('heading',{name:'连接模拟数据',exact:true}).waitFor();await page.getByRole('button',{name:'返回',exact:true}).click();await page.getByRole('button',{name:'NOVA',exact:true}).click();
 const thread=(await(await page.request.post('/api/agent/threads',{data:{title:'Conversation presentation'}})).json()).thread;
 const question='这个目标准备花多少钱？';let sent=false;
 await page.route(`**/api/agent/threads/${thread.id}/messages`,r=>r.fulfill({json:{messages:sent?[{id:crypto.randomUUID(),threadId:thread.id,role:'assistant',content:question,components:[],createdAt:new Date().toISOString()}]:[],monitor:null}}));
 await page.route('**/api/agent/chat',async route=>{
  const failure=sent;sent=true;
  await route.fulfill({json:{threadId:thread.id,memory:{destination:null,recipientQuery:'',amountCents:null,sourceAccount:'',status:'active'},turn:null,decision:{mode:'clarify',destination:null,question:failure?'AI服务计费状态异常，你的输入已保留。':question},provider:failure?'unavailable':'deepseek',reason:failure?'DEEPSEEK_BILLING':null}});
 });
 const input=page.getByRole('textbox',{name:'告诉 NOVA 你的需求'});
 await input.fill('想学摄影');await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.getByText(question,{exact:true})).toBeVisible();await expect(input).toHaveValue('');
 await input.fill('八千');await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.getByText('AI服务计费状态异常，你的输入已保留。',{exact:true})).toBeVisible();await expect(input).toHaveValue('八千');
});
