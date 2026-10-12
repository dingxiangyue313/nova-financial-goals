const injectionRules:Array<[RegExp,string]>=[
  [/(ignore|忽略|无视).{0,20}(previous|above|system|之前|以上|系统).{0,20}(instruction|prompt|指令|提示)/i,"instruction_override"],
  [/(ignore|忽略|无视).{0,12}(all|所有|全部).{0,12}(rules?|instructions?|规则|限制|指令)/i,"instruction_override"],
  [/(reveal|show|print|输出|泄露).{0,20}(system prompt|developer message|系统提示|开发者指令)/i,"prompt_exfiltration"],
  [/(bypass|绕过|跳过).{0,20}(approval|permission|risk|授权|审批|风控)/i,"governance_bypass"],
  [/(call|调用|execute|执行).{0,30}(transfer|payment|转账|支付).{0,20}(without|无需|不要).{0,15}(confirm|approval|确认|授权)/i,"unauthorized_execution"],
  [/(you are now|act as|现在你是).{0,30}(system|developer|管理员|系统)/i,"role_override"],
  [/(伪造|fake|forge).{0,20}(回执|receipt|成功|result)/i,"forged_receipt"],
  [/(假装|声称|pretend|claim).{0,24}(转账|支付|transfer|payment).{0,20}(成功|完成|succeeded|completed).{0,20}(回执|receipt)?/i,"forged_receipt"],
];

export function inspectPromptInjection(text:string){
  const signals=injectionRules.filter(([pattern])=>pattern.test(text)).map(([,signal])=>signal);
  return {detected:signals.length>0,signals,action:(signals.length?"deterministic_fallback":"continue") as "continue"|"deterministic_fallback"};
}
