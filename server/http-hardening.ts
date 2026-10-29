import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type express from 'express';
import helmet from 'helmet';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import pino from 'pino';

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sessionHint(cookie: string | undefined): string {
  return cookie?.match(/(?:^|;\s*)nova_demo_sid=([0-9a-f-]{36})/)?.[1] || 'anonymous';
}

function rateKey(req: express.Request): string {
  const ip = ipKeyGenerator(req.ip || req.socket.remoteAddress || 'unknown');
  return `${ip}:${sessionHint(req.headers.cookie)}`;
}

export function setStaticCacheHeaders(res: express.Response, filePath: string): void {
  const name = path.basename(filePath);
  if (name === 'sw.js' || name === 'manifest.webmanifest' || name === 'index.html') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
}

export function installRequestHardening(app: express.Express): void {
  const logger = pino({
    level: process.env.NOVA_LOG_LEVEL || 'info',
    base: undefined,
    redact: {
      paths: [
        'req.headers.authorization', 'req.headers.cookie', 'req.headers.x-nova-signature',
        'res.headers.set-cookie', 'body', 'apiKey', 'signature', 'accountId',
      ],
      censor: '[Redacted]',
    },
  });

  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:', 'https://images.unsplash.com', 'https://lh3.googleusercontent.com'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));
  app.use((req, res, next) => {
    // Correlation IDs are generated here so a caller cannot smuggle secrets into logs.
    const supplied = undefined;
    const requestId = randomUUID();
    res.setHeader('x-request-id', requestId);
    const startedAt = Date.now();
    res.on('finish', () => logger.info({
      event: 'http_request', requestId, method: ['GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD'].includes(req.method)?req.method:'OTHER',
      path: typeof req.route?.path==='string'?req.route.path:'/static-or-unmatched', status: res.statusCode, durationMs: Date.now() - startedAt,
    }));
    next();
  });
}

export function installApiRateLimits(app: express.Express): void {
  const common = {
    windowMs: 60_000,
    standardHeaders: 'draft-8' as const,
    legacyHeaders: false,
    keyGenerator: rateKey,
    handler: (_req: express.Request, res: express.Response) => res.status(429).json({ error: 'RATE_LIMITED' }),
  };
  const general = rateLimit({
    ...common,
    limit: positiveInteger(process.env.NOVA_API_RATE_LIMIT, 180),
    skip: req => req.path === '/health',
  });
  const sensitive = rateLimit({
    ...common,
    limit: positiveInteger(process.env.NOVA_SENSITIVE_RATE_LIMIT, 30),
    skip: req => req.method === 'GET' || req.method === 'HEAD',
  });
  app.use('/api', general);
  app.use(['/api/agent', '/api/goal/interpret', '/api/external-agent/request'], sensitive);
}
