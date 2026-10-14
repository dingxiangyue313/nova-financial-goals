module.exports = (output, context) => {
  const parsed = typeof output === 'string' ? JSON.parse(output) : output;
  const expectedIntent = context.vars.expectedIntent;
  const expectedFallback = context.vars.expectedFallback;
  const pass = parsed.intent === expectedIntent && parsed.provider === 'deterministic'
    && parsed.fallbackReason === expectedFallback;
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? `intent=${expectedIntent}, deterministic fallback verified`
      : `expected ${expectedIntent}/${expectedFallback}, received ${parsed.intent}/${parsed.fallbackReason}`,
  };
};
