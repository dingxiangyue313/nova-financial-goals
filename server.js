import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const app = express();
const rootDir = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);

app.disable('x-powered-by');
app.use(express.json({ limit: '8kb' }));

app.post('/api/goal/interpret', async (req, res) => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: '服务端尚未配置 DeepSeek API Key。请在项目根目录创建 .env 并填写 DEEPSEEK_API_KEY。',
    });
  }

  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text || text.length > 500) {
    return res.status(400).json({ error: '目标描述不能为空，且最多为 500 个字符。' });
  }

  try {
    const upstream = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
        thinking: { type: 'disabled' },
        response_format: { type: 'json_object' },
        max_tokens: 900,
        messages: [
          {
            role: 'system',
            content: [
              '你是 NOVA 的目标信息提取助手。根据用户提供的中文目标描述，提取目标规划字段。',
              '必须输出一个 JSON object；所有无法从文本明确提取的字段写 null，不要猜测、编造或提供投资建议。',
              'targetDate 仅保留用户说出的日期或时间表达；不要自行推算日期。',
              '字段为：title（简短目标名）、targetAmount（目标总金额，人民币数字）、targetDate（日期或时间表达字符串）、monthlySavings（每月计划存入金额，人民币数字）、emergencyFundProtected（用户明确要求保留的应急金金额，人民币数字）、flexibilityWeeks（日期可浮动周数，数字）。',
              '格式示例：{"title":"日本旅行","targetAmount":8000,"targetDate":"三个月后","monthlySavings":null,"emergencyFundProtected":20000,"flexibilityWeeks":null}',
            ].join(' '),
          },
          { role: 'user', content: text },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!upstream.ok) {
      console.error('DeepSeek request failed with status', upstream.status);
      return res.status(502).json({ error: 'DeepSeek 暂时无法完成解析，请检查 API Key、余额或稍后重试。' });
    }

    const upstreamData = await upstream.json();
    const content = upstreamData?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      return res.status(502).json({ error: 'DeepSeek 返回了空结果，请修改描述后重试。' });
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      return res.status(502).json({ error: 'DeepSeek 返回格式异常，请稍后重试。' });
    }

    const validNumber = (value, min, max) =>
      typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
        ? value
        : null;
    const validString = (value, maxLength) =>
      typeof value === 'string' && value.trim() && value.trim().length <= maxLength
        ? value.trim()
        : null;

    const goal = {
      title: validString(parsed.title, 40),
      targetAmount: validNumber(parsed.targetAmount, 1, 1000000000),
      targetDate: validString(parsed.targetDate, 40),
      monthlySavings: validNumber(parsed.monthlySavings, 0, 100000000),
      emergencyFundProtected: validNumber(parsed.emergencyFundProtected, 0, 1000000000),
      flexibilityWeeks: validNumber(parsed.flexibilityWeeks, 0, 52),
    };

    if (!Object.values(goal).some((value) => value !== null)) {
      return res.status(502).json({ error: '没有从描述中识别到可用字段，请补充目标金额或日期后重试。' });
    }

    return res.json({ goal });
  } catch (error) {
    console.error('DeepSeek request error:', error?.name || 'UnknownError');
    return res.status(502).json({ error: '无法连接 DeepSeek，请检查网络后重试。' });
  }
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(rootDir, 'dist')));
  app.get('*', (_req, res) => res.sendFile(path.join(rootDir, 'dist', 'index.html')));
} else {
  const vite = await createViteServer({
    root: rootDir,
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

app.listen(port, '0.0.0.0', () => {
  console.log(`NOVA is running at http://localhost:${port}`);
});
