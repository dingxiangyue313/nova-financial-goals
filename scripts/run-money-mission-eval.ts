import { spawnSync } from 'node:child_process';

// Execute real deterministic assertions against the current core; never report
// a model evaluation from an offline test run.
const result=spawnSync(process.execPath,['--import','tsx','--test',
  'server/product-mission.test.ts','server/synthetic-statements.test.ts',
  'server/financial-services.test.ts','server/money-mission.test.ts',
  'server/money-mission-plans.test.ts','server/subscription-service.test.ts',
  'server/transfer-schedules.test.ts','server/transfer-worker.test.ts'],{stdio:'inherit',env:process.env});
if(result.error)throw result.error;
if(result.status!==0)process.exit(result.status??1);
console.log(JSON.stringify({layer:'deterministic_money_mission',status:'passed',realModel:'not_run',funds:'simulated'}));
if(process.argv.includes('--real')){
  const live=spawnSync(process.execPath,['--import','tsx','scripts/money-mission-real-eval.ts','--real',...process.argv.slice(2).filter(a=>a!=='--real')],{stdio:'inherit',env:process.env});
  if(live.error)throw live.error;
  process.exit(live.status??1);
}
