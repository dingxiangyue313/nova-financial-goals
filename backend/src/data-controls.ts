export const PERSISTENCE_KEY="nova_device_state_v1";
export const MEMORY_KEY="nova_memory_v1";
export const ANALYTICS_KEY="nova_analytics_v1";
export const DRAFT_KEY="nova_agent_draft_v1";

export type MemoryItem={id:string;label:string;value:string;source:"user"|"inferred";updatedAt:string};
export type AnalyticsEvent={id:string;name:string;timestamp:string;properties:Record<string,string|boolean>};
export const defaultMemory:MemoryItem[]=[
 {id:"priority",label:"首要目标",value:"日本旅行",source:"user",updatedAt:"2026-09-20"},
 {id:"risk",label:"规划偏好",value:"平衡",source:"user",updatedAt:"2026-09-20"},
 {id:"constraint",label:"长期约束",value:"不动用应急金",source:"user",updatedAt:"2026-09-20"},
];

const allowedProperties=new Set(["view","scenario","component","action","result","offline","installed"]);
export function createAnalyticsEvent(name:string,input:Record<string,unknown>,now=new Date()):AnalyticsEvent{
 const properties:Record<string,string|boolean>={};
 for(const [key,value] of Object.entries(input)){if(!allowedProperties.has(key))continue;if(typeof value==="boolean")properties[key]=value;else if(typeof value==="string")properties[key]=value.slice(0,48);}
 return {id:`evt_${now.getTime()}_${name}`,name:name.replace(/[^a-z0-9_]/gi,"_").slice(0,40),timestamp:now.toISOString(),properties};
}
export function containsSensitiveAnalyticsData(event:AnalyticsEvent){const serialized=JSON.stringify(event).toLowerCase();return ["amount","balance","account","merchant","prompt","snapshot","hash","¥","cny"].some(term=>serialized.includes(term));}
export function parseStored<T>(raw:string|null,fallback:T):T{if(!raw)return fallback;try{return JSON.parse(raw) as T}catch{return fallback}}
