import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const root = new URL('..', import.meta.url);
const temporary = await mkdtemp(join(tmpdir(), 'nova-promptfoo-'));
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: root,
  env: {
    ...process.env,
    PORT: '3199',
    NOVA_DB_PATH: join(temporary, 'eval.sqlite'),
    NOVA_LOG_LEVEL: 'silent',
    DEEPSEEK_API_KEY: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverOutput = '';
server.stdout.on('data', (chunk) => { serverOutput += String(chunk); });
server.stderr.on('data', (chunk) => { serverOutput += String(chunk); });

async function ready() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`NOVA eval server exited early:\n${serverOutput}`);
    try {
      const response = await fetch('http://127.0.0.1:3199/api/health');
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`NOVA eval server did not become ready:\n${serverOutput}`);
}

try {
  await ready();
  const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const evaluator = spawn(executable, ['--yes', 'promptfoo@0.124.1', 'eval',
    '--config', 'promptfooconfig.yaml', '--no-cache', '--no-progress-bar'], {
    cwd: root,
    env: { ...process.env, PROMPTFOO_SAFE_MODE: 'true', PROMPTFOO_DISABLE_TELEMETRY: 'true' },
    stdio: 'inherit',
  });
  const exitCode = await new Promise((resolve, reject) => {
    evaluator.once('error', reject);
    evaluator.once('exit', resolve);
  });
  if (exitCode !== 0) process.exitCode = Number(exitCode ?? 1);
} finally {
  server.kill('SIGTERM');
  await rm(temporary, { recursive: true, force: true });
}
