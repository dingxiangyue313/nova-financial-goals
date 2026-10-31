import type { AiSafetyControl } from '../../../shared/contracts';

export function SafetyModeBanner({ control }: { control: AiSafetyControl }) {
  return <section role="status" className="rounded-xl border border-[#D8E4E4] bg-[#F2FAFA] p-4 text-sm text-[#1F2329]">
    <h2 className="font-bold"><span aria-hidden="true">{control.mode === 'safe_mode' ? '⏸' : '◇'}</span> {control.mode === 'safe_mode' ? '安全模式已开启' : '常规模式'}</h2>
    <p>模型调用{control.modelCallsAllowed ? '可用' : '已停止'} · AI 写操作{control.aiWriteActionsAllowed ? '仍需授权与确认' : '已停止'}</p>
    <p>确定性只读功能仍可用，历史回执和取消操作仍可用。</p>
    {control.activatedAt && <p>启用时间：{new Date(control.activatedAt).toLocaleString('zh-CN')}</p>}
  </section>;
}
