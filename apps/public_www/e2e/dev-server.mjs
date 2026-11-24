import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const sitePort = Number(process.env.E2E_SITE_PORT);
const crmPort = Number(process.env.E2E_CRM_PORT);

if (!Number.isInteger(sitePort) || !Number.isInteger(crmPort)) {
  throw new Error('E2E_SITE_PORT and E2E_CRM_PORT must be integers.');
}

const allowedOrigin = `http://localhost:${sitePort}`;

const server = createServer((request, response) => {
  response.setHeader('access-control-allow-origin', allowedOrigin);
  response.setHeader('access-control-allow-headers', 'accept, content-type, x-api-key');
  response.setHeader('access-control-allow-methods', 'GET, OPTIONS');

  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  response.writeHead(200, { 'content-type': 'application/json' });
  response.end('{"events":[]}');
});

server.listen(crmPort, '127.0.0.1', () => {
  const next = spawn('npm', ['run', 'dev', '--', '-p', String(sitePort)], {
    stdio: 'inherit',
    env: process.env,
  });

  const stop = (signal) => {
    next.kill(signal);
    server.close();
  };

  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
  next.on('exit', (code, signal) => {
    server.close();
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
});
