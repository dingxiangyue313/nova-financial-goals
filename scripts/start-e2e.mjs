import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
const parent=realpathSync(tmpdir()),temporary=resolve(mkdtempSync(join(parent,'nova-browser-tests-')));
if(dirname(temporary)!==parent)throw new Error('Unexpected browser test directory');
process.env.PORT = '3177';
process.env.NODE_ENV = 'production';
process.env.NOVA_DEMO_CONTROLS = 'true';
process.env.NOVA_RP_ID = 'localhost';
process.env.NOVA_ORIGIN = 'http://localhost:3177';
process.env.NOVA_DB_PATH = join(temporary,'e2e.sqlite');
process.env.DEEPSEEK_API_KEY = '';
process.env.NOVA_SESSION_SECRET = 'playwright-session-secret-at-least-32-characters';

await import('../server/index.ts');
const {closeStore}=await import('../server/store.ts');
process.once('exit',()=>{try{closeStore();}finally{try{rmSync(temporary,{recursive:true,force:true});}catch{/* OS can release a terminated child slightly later. */}}});
process.once('SIGTERM',()=>process.exit(0));
process.once('SIGINT',()=>process.exit(0));
