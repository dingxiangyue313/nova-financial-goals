import { AccountSnapshotSchema, NormalizedStatementRowSchema, StatementImportBatchSchema } from '../shared/contracts.ts';

/** Converts only the recognized earlier product prototype. Bank cash, audit,
 * goals and receipts are never replaced. Old execution authority is archived,
 * not translated into a newly executable authorization. */
export function migrateLegacyProduct(raw:Record<string,unknown>):Record<string,unknown>{
  const snapshots=Array.isArray(raw.accountSnapshots)?raw.accountSnapshots:[];
  if(!snapshots.some(s=>s&&typeof s==='object'&&'source' in s&&!('sourceKind' in s))&&!raw.mission)return raw;
  const archive={...(raw.legacyProductArtifacts as Record<string,unknown>??{})};
  for(const key of ['accountSnapshots','statementImportBatches','normalizedStatementRows','transferSchedules','transferExecutions','mission'])if(raw[key]!==undefined)archive[key]=structuredClone(raw[key]);
  const clock=String(raw.clock),version=Number(raw.twinVersion)+1;
  const rows=(Array.isArray(raw.normalizedStatementRows)?raw.normalizedStatementRows:[]).map((r,index)=>{
    if(NormalizedStatementRowSchema.safeParse(r).success)return r;
    return NormalizedStatementRowSchema.parse({...r,rowNumber:index+1,issueIds:r.issueIds??[],excludedReason:r.excludedReason==='income'?null:r.excludedReason??null,
      originalValues:{date:r.date,description:r.title,amountCents:r.amountCents,category:r.originalCategory??r.category},correctedValues:{}});
  });
  const batches=(Array.isArray(raw.statementImportBatches)?raw.statementImportBatches:[]).map(b=>{
    if(StatementImportBatchSchema.safeParse(b).success)return b;
    const included=rows.filter(r=>r.batchId===b.id&&!r.excludedReason).length;
    return StatementImportBatchSchema.parse({...b,sourceKind:'bank',accountId:'checking',importedCount:b.status==='committed'?included:0,excludedCount:rows.filter(r=>r.batchId===b.id&&r.excludedReason).length,reviewCount:0,committedAt:b.committedAt??null});
  });
  const accounts=snapshots.flatMap(s=>{
    if(AccountSnapshotSchema.safeParse(s).success)return [s];
    if(s.confirmed!==true)return [];
    return [AccountSnapshotSchema.parse({...s,sourceKind:s.source==='user_confirmed_balance'?'user_confirmed':'simulated_connection',sourceId:'legacy-confirmed-snapshot',createdAt:`${s.asOf}T12:00:00+08:00`})];
  });
  const {mission:_oldMission,...rest}=raw;
  return {...rest,accountSnapshots:accounts,normalizedStatementRows:rows,statementImportBatches:batches,transferSchedules:[],transferExecutions:[],
    legacyProductArtifacts:{...archive,migratedOn:clock,requiresScheduleReconfirmation:true},twinVersion:version};
}
