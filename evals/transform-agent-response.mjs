export default function transformAgentResponse(json) {
  return JSON.stringify({
    intent: json?.intent,
    provider: json?.provider,
    fallbackReason: json?.fallbackReason,
    componentTypes: Array.isArray(json?.components) ? json.components.map((item) => item.type) : [],
  });
}
