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
  for (let attempt = 0; attempt < 240; attempt += 1) {
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
  const evaluatorArgs = ['--yes', 'promptfoo@0.124.1', 'eval',
    '--config', 'promptfooconfig.yaml', '--no-cache', '--no-progress-bar'];
  const windows = process.platform === 'win32';
  const executable = windows ? process.execPath : 'npx';
  const args = windows ? [process.env.npm_execpath, 'exec', '--yes',
    '--package=promptfoo@0.124.1', '--', 'promptfoo', 'eval',
    '--config', 'promptfooconfig.yaml', '--no-cache', '--no-progress-bar'].filter(Boolean) : evaluatorArgs;
  const evaluator = spawn(executable, args, {
    cwd: root,
    env: { ...process.env, PROMPTFOO_SAFE_MODE: 'true', PROMPTFOO_DISABLE_TELEMETRY: 'true' },
    stdio: 'inherit',
  });
  const exitCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      evaluator.kill('SIGTERM');
      reject(new Error('Promptfoo evaluator exceeded 300 seconds; check package availability or network access.'));
    }, 300_000);
    evaluator.once('error', error => { clearTimeout(timer); reject(error); });
    evaluator.once('exit', code => { clearTimeout(timer); resolve(code); });
  });
  if (exitCode !== 0) process.exitCode = Number(exitCode ?? 1);
} finally {
  if (server.exitCode === null && server.signalCode === null) {
    await new Promise(resolve => {
      const timeout = setTimeout(resolve, 5_000);
      server.once('exit', () => { clearTimeout(timeout); resolve(); });
      server.kill('SIGTERM');
    });
    if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
  }
  await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
