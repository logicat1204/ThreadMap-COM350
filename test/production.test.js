import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createThreadMapServer } from '../server.js';
import { appOrigin } from '../runtime.js';
import { createAccounts } from '../accounts.js';

async function route(server, { host = 'threadmap.example', path = '/health', method = 'GET', origin, ip = '127.0.0.1', forwarded, cookie } = {}) {
  const request = Readable.from([]);
  request.url = path; request.method = method;
  request.headers = { host, origin, cookie, 'x-threadmap-client-ip': forwarded, 'x-threadmap-ip': 'attacker-value' };
  request.socket = { remoteAddress: ip };
  const response = new EventEmitter();
  response.setHeader = () => {};
  response.writeHead = (status, headers) => { response.status = status; response.headers = headers; };
  response.end = (body) => {
    const type = response.headers?.['Content-Type'] ?? 'application/json';
    response.data = body === undefined ? undefined : type.startsWith('application/json') ? JSON.parse(body) : body?.toString();
  };
  await server.listeners('request')[0](request, response);
  return response;
}

test('the public landing and both account entry links serve the corresponding pages', async () => {
  const server = createThreadMapServer({ publicURL: 'https://threadmap.example' });
  const landing = await route(server, { path: '/' });
  assert.equal(landing.status, 200);
  assert.match(landing.data, /href="\/app\?modo=login"/);
  assert.match(landing.data, /href="\/app\?modo=registro"/);
  for (const mode of ['login', 'registro']) {
    const app = await route(server, { path: `/app?modo=${mode}` });
    assert.equal(app.status, 200);
    assert.match(app.data, /id="auth-form"/);
    assert.match(app.data, /src="\/app\.js"/);
  }
  for (const path of ['/landing.css', '/landing.js', '/appearance.js']) {
    assert.equal((await route(server, { path })).status, 200);
  }
});

test('the root and old login URLs redirect only valid sessions to the clean chat URL', async () => {
  const server = createThreadMapServer({
    publicURL: 'https://threadmap.example',
    accounts: { getSession: async (request) => request.headers.cookie === 'session=valid' ? { user: { id: 'demo' } } : null },
  });
  for (const path of ['/', '/app?modo=login', '/app?modo=registro']) {
    for (const method of ['GET', 'HEAD']) {
      const response = await route(server, { path, method, cookie: 'session=valid' });
      assert.equal(response.status, 302);
      assert.equal(response.headers.Location, '/app');
      assert.equal(response.headers['Cache-Control'], 'no-store');
    }
  }
  for (const cookie of [undefined, 'session=invalid']) {
    assert.equal((await route(server, { path: '/', cookie })).status, 200);
    assert.equal((await route(server, { path: '/app?modo=login', cookie })).status, 200);
  }
  assert.equal((await route(server, { path: '/app', cookie: 'session=valid' })).status, 200, 'the clean destination must not redirect again');
});

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
