import { AgentComponentSchema, UiCardSchema, type AgentComponent, type UiCard } from './contracts.ts';

export function normalizeUiCard(input: unknown): UiCard {
  const parsed = UiCardSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  return {
    id: 'invalid-component-fallback', type: 'explanation', title: '内容暂时无法显示',
    body: 'NOVA 已阻止未知或无效组件。你可以返回原页面继续使用确定性流程。',
    tone: 'warning', action: null,
  };
}

export function normalizeAgentComponent(input: unknown): AgentComponent {
  const parsed = AgentComponentSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  return {
    id: 'invalid-agent-component-fallback', type: 'explanation', title: '内容暂时无法显示',
    body: 'NOVA 已阻止未知或无效组件。你可以换一种方式描述任务。', tone: 'warning',
  };
}
