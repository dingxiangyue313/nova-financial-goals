import { env } from "cloudflare:workers";
import { createInitialTwin,forecastTwin } from "@backend/financial-twin-engine";
import { FinancialTwinStateSchema,type FinancialTwinState,type TwinAction } from "@backend/financial-twin-contracts";
import { applyTwinAction } from "@backend/financial-twin-engine";
import { sha256 } from "@backend/security-architecture";

const recordId=async(userId:string)=>`financial_twin_${(await sha256(userId)).slice(0,32)}`;
const database=()=>{if(!env.DB)throw new Error("DATABASE_UNAVAILABLE");return env.DB};

export async function getOrCreateTwin(userId:string):Promise<FinancialTwinState>{
 const id=await recordId(userId);const row=await database().prepare("SELECT data FROM nova_records WHERE id=? AND user_id=? AND kind='financial_twin'").bind(id,userId).first<{data:string}>();
 if(row)return FinancialTwinStateSchema.parse(JSON.parse(row.data));
 const state=createInitialTwin();const at=state.updatedAt;try{await database().prepare("INSERT INTO nova_records(id,user_id,kind,status,data,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").bind(id,userId,"financial_twin","active",JSON.stringify(state),at,at).run();return state}catch{const retry=await database().prepare("SELECT data FROM nova_records WHERE id=? AND user_id=?").bind(id,userId).first<{data:string}>();if(!retry)throw new Error("TWIN_CREATE_FAILED");return FinancialTwinStateSchema.parse(JSON.parse(retry.data));}
}

export async function mutateTwin(userId:string,action:Exclude<TwinAction,{type:"simulate_expense"}>,attempt=0):Promise<FinancialTwinState>{
 const id=await recordId(userId);const row=await database().prepare("SELECT data,updated_at FROM nova_records WHERE id=? AND user_id=? AND kind='financial_twin'").bind(id,userId).first<{data:string;updated_at:string}>();
 if(!row){await getOrCreateTwin(userId);return mutateTwin(userId,action,attempt)}
 const current=FinancialTwinStateSchema.parse(JSON.parse(row.data));const next=applyTwinAction(current,action);const result=await database().prepare("UPDATE nova_records SET data=?,updated_at=? WHERE id=? AND user_id=? AND kind='financial_twin' AND updated_at=?").bind(JSON.stringify(next),next.updatedAt,id,userId,row.updated_at).run();
 if(Number(result.meta.changes)===1)return next;if(attempt<2)return mutateTwin(userId,action,attempt+1);throw new Error("TWIN_CONCURRENT_UPDATE");
}

export async function getTwinView(userId:string){const state=await getOrCreateTwin(userId);return {state,forecast:forecastTwin(state),derived:{totalBalance:state.accounts.reduce((sum,item)=>sum+item.balance,0),protectedFunds:state.accounts.filter(item=>item.protected).reduce((sum,item)=>sum+item.balance,0)}};}
