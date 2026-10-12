import type { BankingToolName } from "@backend/banking-tool-contracts";

export type BankingActorType="user"|"sandbox"|"external_agent"|"internal_agent";

export const externalAgentTools=new Set<BankingToolName>([
  "get_financial_snapshot","list_accounts","list_transactions","forecast_cashflow","simulate_goal_plan",
  "get_operation_status","permission_check","risk_check","detect_financial_signals","explain_decision",
  "compare_scenarios","get_goal_progress","list_bills","list_subscriptions","compare_cards","quote_fx",
  "assess_goal_feasibility","prepare_goal_adjustment","evaluate_agent_payment","execute_agent_payment",
  "evaluate_external_agent_request","execute_external_payment",
]);

export const internalAgentTools=new Set<BankingToolName>([
  "get_financial_snapshot","list_accounts","list_transactions","forecast_cashflow","simulate_goal_plan",
  "detect_financial_signals","compare_scenarios","get_goal_progress","list_bills","list_subscriptions",
  "compare_cards","quote_fx","assess_goal_feasibility","prepare_goal_adjustment",
]);

export function actorCanCallTool(actor:BankingActorType,name:BankingToolName){
  if(actor==="external_agent")return externalAgentTools.has(name);
  if(actor==="internal_agent")return internalAgentTools.has(name);
  return true;
}
