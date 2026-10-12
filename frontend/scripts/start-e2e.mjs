import { createReadStream } from "node:fs";
import { createServer,request as httpRequest } from "node:http";
import { readFile,readdir,stat } from "node:fs/promises";
import { dirname,extname,resolve,sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

const frontend=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const root=resolve(frontend,"..");
const serverRoot=resolve(frontend,"dist/server");
const moduleFiles=(await readdir(serverRoot,{recursive:true})).filter(file=>/\.(?:m?js)$/.test(file));
const modules=["index.js",...moduleFiles.filter(file=>file!=="index.js")].map(path=>({type:"ESModule",path:resolve(serverRoot,path)}));
export async function startE2EServer(){
 const server=new Miniflare({modules,modulesRoot:serverRoot,compatibilityDate:"2026-05-15",compatibilityFlags:["nodejs_compat"],d1Databases:["DB"],bindings:{NOVA_AGENT_ROLLOUT:"phase4",NOVA_BANKING_RPM:"1000"},host:"127.0.0.1",port:0});
 const database=await server.getD1Database("DB");
 for(const file of ["0000_many_joshua_kane.sql","0001_rate_limits.sql"]){
  const migration=await readFile(resolve(root,"backend/drizzle",file),"utf8");
  const delimiter=file.startsWith("0000")?"--> statement-breakpoint":";";
  for(const statement of migration.split(delimiter).map(value=>value.trim()).filter(Boolean))await database.prepare(statement).run();
 }
 const upstream=new URL(String(await server.ready));
 const clientRoot=resolve(frontend,"dist/client");
 const mime={".js":"text/javascript",".css":"text/css",".svg":"image/svg+xml",".png":"image/png",".json":"application/json",".webmanifest":"application/manifest+json"};
 const app=createServer(async(req,res)=>{
 const pathname=new URL(req.url??"/","http://127.0.0.1").pathname;
 const file=resolve(clientRoot,`.${decodeURIComponent(pathname)}`);
 if((pathname.startsWith("/_next/static/")||pathname.startsWith("/japan-goal-cover."))&&file.startsWith(clientRoot+sep)){
  try{const details=await stat(file);if(details.isFile()){res.writeHead(200,{"content-type":mime[extname(file)]??"application/octet-stream"});createReadStream(file).pipe(res);return}}catch{}
 }
 const proxy=httpRequest(new URL(req.url??"/",upstream),{method:req.method,headers:{...req.headers,host:upstream.host}},up=>{res.writeHead(up.statusCode??502,up.headers);up.pipe(res)});
 proxy.on("error",error=>{res.writeHead(502);res.end(error.message)});req.pipe(proxy);
 });
 await new Promise(resolve=>app.listen(Number(process.env.PORT??4173),"127.0.0.1",resolve));
 return async()=>{app.closeAllConnections();await new Promise(resolve=>app.close(resolve));await server.dispose()};
}
