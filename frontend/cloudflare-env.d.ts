declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    DEEPSEEK_API_KEY?: string;
    QWEN_API_KEY?: string;
    NOVA_AGENT_ROLLOUT?: string;
    NOVA_EVALUATION_MODE?: string;
    NOVA_AGENT_RPM?: string;
    NOVA_BANKING_RPM?: string;
    NOVA_MCP_RPM?: string;
    EXTERNAL_AGENT_SIGNING_SECRET?: string;
  }
}
