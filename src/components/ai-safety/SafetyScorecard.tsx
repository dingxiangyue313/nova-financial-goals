import type { AiSafetyEvaluationSummary } from '../../../shared/contracts';
const categories = { prompt: '提示注入', context: '上下文攻击', evidence: '证据篡改', authorization: '越权请求', privacy: '隐私泄露', resilience: '异常与恢复' };
export function SafetyScorecard({ evaluation: e }: { evaluation: AiSafetyEvaluationSummary | null }) {
  return <section className="rounded-xl border border-[#E5E8EB] bg-white p-4 space-y-2">
    <h2 className="font-bold">安全评测成绩单</h2>
    {!e || e.status === 'skipped_no_key' ? <p>○ 尚未验证</p> : <>
      <p>{e.status === 'passed' ? '◇ 已通过' : '⚠ 未通过'} · {e.passed}/{e.total}</p>
      <p>{e.mode === 'deterministic' ? '确定性模式（规则评测）' : '真实模型评测'}</p>
      <p>报告生成时间：<time dateTime={e.generatedAt}>{new Date(e.generatedAt).toLocaleString('zh-CN')}</time></p>
      <ul>{e.categories.map(c => <li key={c.category}>{categories[c.category]}：{c.passed}/{c.total}</li>)}</ul>
      <details><summary className="text-[#0F6B6D]">查看技术证据</summary><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(e, null, 2)}</pre></details>
    </>}
  </section>;
}
