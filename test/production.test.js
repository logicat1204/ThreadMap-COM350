import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createThreadMapServer } from '../server.js';
import { appOrigin } from '../runtime.js';
import { createAccounts } from '../accounts.js';

async function route(server, { host = 'threadmap.example', path = '/health', method = 'GET', origin, ip = '127.0.0.1', forwarded } = {}) {
  const request = Readable.from([]);
  request.url = path; request.method = method;
  request.headers = { host, origin, 'x-threadmap-client-ip': forwarded, 'x-threadmap-ip': 'attacker-value' };
  request.socket = { remoteAddress: ip };
  const response = new EventEmitter();
  response.setHeader = () => {};
  response.writeHead = (status) => { response.status = status; };
  response.end = (body) => { response.data = JSON.parse(body); };
  await server.listeners('request')[0](request, response);
  return response;
}

test('public deployment accepts only its configured host and HTTPS origin', async () => {
  const server = createThreadMapServer({ publicURL: 'https://threadmap.example' });
  assert.equal((await route(server)).status, 200);
  assert.equal((await route(server, { host: 'threadmap.example:443' })).status, 200);
  assert.equal((await route(server, { host: 'elsewhere.example' })).status, 403);
  assert.equal((await route(server, { host: 'threadmap.example@elsewhere.example' })).status, 403);
  assert.equal((await route(server, { host: '127.0.0.1:3000' })).status, 200);
  assert.equal((await route(server, { method: 'POST', origin: 'https://elsewhere.example' })).status, 403);
  assert.equal((await route(server, { method: 'POST', origin: 'http://threadmap.example' })).status, 403);
});

test('without APP_URL the server remains local-only', async () => {
  const server = createThreadMapServer({ publicURL: '' });
  assert.equal((await route(server)).status, 403);
  assert.equal((await route(server, { host: 'localhost:3000' })).status, 200);
  assert.throws(() => appOrigin('https://example.com/path'));
  assert.throws(() => appOrigin('https://user:password@example.com'));
});

test('production requires HTTPS and an explicit permanent session secret', async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.throws(() => appOrigin(''), /APP_URL/);
    assert.throws(() => appOrigin('http://threadmap.example'), /HTTPS/);
    await assert.rejects(createAccounts({ baseURL: 'https://threadmap.example', secret: '' }), /BETTER_AUTH_SECRET/);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test('only the explicitly trusted local proxy can provide a visitor IP to auth rate limits', async () => {
  const seen = [];
  const accounts = {
    authHandler: async (request, response) => {
      seen.push(request.headers['x-threadmap-ip']);
      response.writeHead(200); response.end('{}');
    },
  };
  const proxy = createThreadMapServer({ publicURL: 'https://threadmap.example', accounts, trustProxy: true });
  const direct = createThreadMapServer({ publicURL: 'https://threadmap.example', accounts, trustProxy: false });
  await route(proxy, { path: '/api/auth/ok', forwarded: '203.0.113.10' });
  await route(proxy, { path: '/api/auth/ok', forwarded: '203.0.113.11' });
  await route(proxy, { path: '/api/auth/ok', forwarded: '203.0.113.10', ip: '198.51.100.5' });
  await route(direct, { path: '/api/auth/ok', forwarded: '203.0.113.10' });
  await route(proxy, { path: '/api/auth/ok', forwarded: '203.0.113.10, 203.0.113.11' });
  assert.deepEqual(seen, ['203.0.113.10', '203.0.113.11', '198.51.100.5', '127.0.0.1', '127.0.0.1']);
});
