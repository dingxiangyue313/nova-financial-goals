import { ClaimBadge } from './ClaimBadge';

export function DataChoice({
  uploadEnabled,
  busy,
  onImportSample,
  onUpload
}: {
  uploadEnabled: boolean;
  busy: boolean;
  onImportSample: (sampleId: 'all' | 'bank' | 'wechat' | 'alipay') => void;
  onUpload?: (file: File) => void;
}) {
  return (
    <section className="mission-card">
      <h2 className="font-bold">选择账单数据</h2>
      <p>比赛构建默认导入 NOVA 合成样例。字段只含日期、商户摘要、整数分、分类与来源；不会改写工资卡、旅行金或应急金余额。</p>
      <button type="button" className="mission-primary" disabled={busy} onClick={() => onImportSample('all')}>导入 NOVA 合成样例</button>
      <div className="flex flex-wrap gap-2">
        {[{ id: 'bank' as const, label: '银行卡样例' }, { id: 'wechat' as const, label: '微信样例' }, { id: 'alipay' as const, label: '支付宝样例' }].map(item => (
          <button key={item.id} type="button" className="mission-secondary" disabled={busy} onClick={() => onImportSample(item.id)}>{item.label}</button>
        ))}
      </div>
      {uploadEnabled ? (
        <label className="block">上传模拟账单（CSV / XLSX / PDF / PNG，最大 5MB）
          <input type="file" disabled={busy} accept=".csv,.xlsx,.pdf,.png" onChange={event => {
            const file = event.target.files?.[0];
            if (file) onUpload?.(file);
            event.target.value = '';
          }} />
          <span className="block">文件只用于当前模拟会话解析，核对并确认后才计入分析；不会改写账户余额。</span>
        </label>
      ) : (
        <p><ClaimBadge kind="limitation" />当前不接受个人 CSV / XLSX / PDF / 图片上传，因此这里没有系统文件选择器。数据只保存在本机演示会话，评测结束后可重置。</p>
      )}
    </section>
  );
}
