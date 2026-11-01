import {test,expect} from '@playwright/test';
test('natural chat navigation opens the requested page and never asks the agent to execute',async({page})=>{
 test.setTimeout(300000);
 await page.goto('/');await page.getByRole('heading',{name:'连接模拟数据',exact:true}).waitFor();await page.getByRole('button',{name:'返回',exact:true}).click();await page.getByRole('button',{name:'NOVA',exact:true}).click();
 const testThread=(await(await page.request.post('/api/agent/threads',{data:{title:'navigation test'}})).json()).thread.id;
 const sent:string[]=[];
 await page.route('**/api/agent/chat',async route=>{const message=route.request().postDataJSON().message;const id=/A钱|发起AA/.test(message)?'aa_create':/AA记录/.test(message)?'aa_records':/不要|是什么|影响|预算/.test(message)?null:/转账|给小林转/.test(message)?'transfer':/申请/.test(message)?'card_apply':/卡片/.test(message)?'cards':/订阅/.test(message)?'subscriptions':/账单/.test(message)?'bills':/赎回/.test(message)?'investment_holdings':/风险/.test(message)?'investment_profile':/理财/.test(message)?'investment_products':/订单/.test(message)?'travel_orders':/机票/.test(message)?'travel_quotes':'cashflow';if(!id){sent.push(message);await route.fulfill({status:503,json:{error:'测试请求未发送'}});return;}await route.fulfill({json:{threadId:testThread,memory:{destination:id,recipientQuery:'',amountCents:null,sourceAccount:'',status:'active'},turn:null,decision:{mode:id?'navigate':'chat',destination:id,question:null},provider:'deepseek',reason:null}});});

 const cases=[
 ['我要和同事A钱','发起AA'],['帮我给林夏转账500元','联系人转账'],['我想转账','联系人转账'],['给小林转300元','联系人转账'],['帮我转账','联系人转账'],
 ['我要发起AA','发起AA'],['查看AA记录','AA待办与对账'],['查看我的卡片','我的卡片'],['申请信用卡','申请新卡'],
 ['管理订阅','订阅管理'],['查看账单','10月账单'],['我要赎回','我的持仓'],['查看理财','产品选择'],
 ['做风险评估','风险评估'],['查看旅行订单','旅行订单与资金对账'],['获取机票报价','机票与住宿报价'],['收支试算','工资与账单之间，钱够不够用']
 ];
 for(const [message,heading] of cases){await page.getByRole('textbox',{name:'告诉 NOVA 你的需求'}).fill(message);await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.getByRole('heading',{name:heading,exact:true}).last()).toBeVisible();if(message==='帮我给林夏转账500元'){await expect(page.getByLabel('搜索联系人',{exact:true})).toHaveValue('林夏');await expect(page.getByLabel('转账金额（元）',{exact:true})).toHaveValue('500');await expect(page.getByLabel('收款人',{exact:true})).toHaveValue('');}await page.getByRole('button',{name:'返回',exact:true}).click();}
 expect(sent).toEqual([]);
 for(const message of ['不要帮我转账','转账是什么','转账会影响目标吗？','我想去日本旅行，预算10000元']){await page.getByRole('textbox',{name:'告诉 NOVA 你的需求'}).fill(message);await page.getByRole('button',{name:'发送',exact:true}).click();await expect.poll(()=>sent.includes(message)).toBe(true);await expect(page.getByRole('textbox',{name:'告诉 NOVA 你的需求'})).toHaveValue(message);}
 console.log('All chat routing integration cases passed, including original user phrase, no unintended agent execution');
});


