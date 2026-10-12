"use client";

import { useCallback,useRef,useState } from "react";
import type { FinancialTwinState,TwinAction } from "@backend/financial-twin-contracts";
import type { CashflowForecast } from "@backend/financial-twin-engine";

export type TwinView={state:FinancialTwinState;forecast:CashflowForecast;derived:{totalBalance:number;protectedFunds:number}};
type Headers=Record<string,string>|null;

function normalize(payload:any):TwinView{
 const state=payload.state as FinancialTwinState;
 return {state,forecast:payload.forecast,derived:payload.derived??{totalBalance:state.accounts.reduce((sum,item)=>sum+item.balance,0),protectedFunds:state.accounts.filter(item=>item.protected).reduce((sum,item)=>sum+item.balance,0)}};
}

export function useFinancialTwin(headers:Headers,onError:(message:string)=>void){
 const [twin,setTwin]=useState<TwinView|null>(null);const [loading,setLoading]=useState(true);const requestSequence=useRef(0);const version=useRef(0);
 const accept=useCallback((next:TwinView)=>{if(next.state.version<version.current)return false;version.current=next.state.version;setTwin(next);return true},[]);
 const refresh=useCallback(async(minimumVersion=0)=>{if(!headers)return null;const sequence=++requestSequence.current;setLoading(true);try{const response=await fetch("/api/financial-twin",{headers,cache:"no-store"});const payload:any=await response.json();if(!response.ok)throw new Error(payload?.error?.message??"Financial Twin 同步失败");const next=normalize(payload);if(sequence===requestSequence.current&&next.state.version>=minimumVersion)accept(next);return next}catch(error){onError(error instanceof Error?error.message:"暂时无法同步 Financial Twin");return null}finally{if(sequence===requestSequence.current)setLoading(false)}},[accept,headers,onError]);
 const act=useCallback(async(action:TwinAction,confirmed=false)=>{if(!headers)return null;const response=await fetch("/api/financial-twin",{method:"POST",headers:{...headers,...(confirmed?{"x-nova-user-confirmed":"true"}:{})},body:JSON.stringify(action)});const payload:any=await response.json();if(!response.ok){onError(payload?.error?.message??"操作未完成");return null}if(action.type!=="simulate_expense")accept(normalize(payload));return payload},[accept,headers,onError]);
 return {twin,loading,refresh,act};
}
