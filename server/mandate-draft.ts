import {MandateDraftSchema,type MandateDraft} from '../shared/financial-services.ts';
import {amountCents} from '../shared/amount.ts';
import {containsPromptInjection} from './security.ts';

/** Bounded parser: incomplete/unsupported intent never falls through to broad defaults. No authority is created. */
export function buildMandateDraft(message:string,now=Date.now()):MandateDraft {
 if(containsPromptInjection(message))throw new Error('SERVICE_UNTRUSTED_INSTRUCTION');
 const missing:string[]=[],merchants:Array<'air-demo'|'stay-demo'>=[];
 if(/樱旅航空|air-demo/.test(message))merchants.push('air-demo');
 if(/京都旅宿|stay-demo/.test(message))merchants.push('stay-demo');
 const moneyPart=(pattern:RegExp,label:string)=>{const matches=[...message.matchAll(pattern)];if(matches.length!==1){missing.push(label);return null;}try{const cents=amountCents(matches[0][1]);if(cents<=0)throw new Error();return cents;}catch{missing.push(label);return null;}};
 const maxPerOrderCents=moneyPart(/单笔(?:不超过|上限|最多|限额)?\s*[¥￥]?\s*(\d+(?:\.\d{1,2})?)(?![\d.])/g,'请明确一个正数的单笔金额上限。');
 const totalCents=moneyPart(/(?:累计|总共|总额)(?:不超过|上限|最多)?\s*[¥￥]?\s*(\d+(?:\.\d{1,2})?)(?![\d.])/g,'请明确一个正数的累计金额上限。');
 const dates=[...message.matchAll(/(?:有效至|有效到|到期日|截止到?)\s*(\d{4}-\d{2}-\d{2})/g)];
 const expiresOn=dates.length===1?dates[0][1]:null;
 const validDate=expiresOn&&/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)&&!Number.isNaN(Date.parse(expiresOn+'T00:00:00Z'))&&new Date(expiresOn+'T00:00:00Z').toISOString().slice(0,10)===expiresOn;
 if(!validDate||Date.parse(expiresOn+'T23:59:00+08:00')<=now)missing.push('请填写未来的有效截止日期，格式 YYYY-MM-DD（北京时间）。');
 if(validDate&&Date.parse(expiresOn+'T23:59:00+08:00')>now+30*86400000)missing.push('授权有效期最多30天，请缩短截止日期。');
 if(!merchants.length)missing.push('请明确允许樱旅航空、京都旅宿中的哪些商户。');
 if(/不要|不允许|排除|除了|除外|仅限一次|每月|每天|手续费|必须退款|不可退款|所有商户|全部商户/.test(message))missing.push('描述包含额外或排除条件，当前草稿不能安全表达；请先在表单中明确支持的边界，不会忽略这些条件创建授权。');
 const residue=message.replace(/樱旅航空|京都旅宿|air-demo|stay-demo/g,'')
  .replace(/单笔(?:不超过|上限|最多|限额)?\s*[¥￥]?\s*\d+(?:\.\d{1,2})?元?/g,'')
  .replace(/(?:累计|总共|总额)(?:不超过|上限|最多)?\s*[¥￥]?\s*\d+(?:\.\d{1,2})?元?/g,'')
  .replace(/(?:有效至|有效到|到期日|截止到?)\s*\d{4}-\d{2}-\d{2}/g,'')
  .replace(/只允许|允许|商户|授权|和|及|与/g,'').replace(/[\s，,。.;；:：、]+/g,'');
 if(residue)missing.push('还有未识别的商户或条件，请按示例明确填写；不会自动忽略。');
 if(maxPerOrderCents&&totalCents&&maxPerOrderCents>totalCents)missing.push('单笔上限不能超过累计上限。');
 return MandateDraftSchema.parse({provider:'deterministic',status:missing.length?'needs_information':'draft',missing,
  explanation:'这是按明确字段整理的模拟草稿，不是模型推断，也未创建或修改授权。目标和来源账户沿用你在表单中明确选择的内容，核对后仍需准确确认。',
  draft:missing.length?null:{merchants,maxPerOrderCents,totalCents,expiresOn}});
}
