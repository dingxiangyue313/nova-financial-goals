process.env.PORT = '3177';
process.env.NODE_ENV = 'production';
process.env.NOVA_DEMO_CONTROLS = 'true';
process.env.NOVA_RP_ID = 'localhost';
process.env.NOVA_ORIGIN = 'http://localhost:3177';
process.env.NOVA_DB_PATH = './data/e2e.sqlite';
process.env.DEEPSEEK_API_KEY = '';
process.env.NOVA_SESSION_SECRET = 'playwright-session-secret-at-least-32-characters';

await import('../server/index.ts');
