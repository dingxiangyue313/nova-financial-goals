import {mkdtempSync,readdirSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';

// Test state must never land in the developer's active simulated account DB.
const parent=realpathSync(tmpdir()),temporary=resolve(mkdtempSync(join(parent,'nova-unit-tests-')));
if(dirname(temporary)!==parent)throw new Error('Unexpected test directory');
const tests=['server','server/skills','src'].flatMap(dir=>readdirSync(dir).filter(name=>name.endsWith('.test.ts')).map(name=>resolve(dir,name)));
try{
  const result=spawnSync(process.execPath,['--import','tsx','--test','--test-concurrency=2',...tests],{stdio:'inherit',env:{...process.env,NOVA_DB_PATH:join(temporary,'tests.sqlite')}});
  if(result.error)throw result.error;
  process.exitCode=result.status??1;
}finally{rmSync(temporary,{recursive:true,force:true});}
