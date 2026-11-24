import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createAccounts } from '../accounts.js';
import { createThreadMapServer } from '../server.js';

test('five free answers are enforced per account across providers, concurrent requests and database reopen', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'threadmap-quota-'));
  const databasePath = join(directory, 'accounts.sqlite');
  let releaseAccounts;
  const ready = new Promise((resolve) => { releaseAccounts = resolve; });
  let providerCalls = 0;
  let fail = false;
  let gate;
  let entered;
  const server = createThreadMapServer({
    accounts: ready, platformKey: 'test-openai', geminiPlatformKey: 'test-gemini',
    fetchProvider: async (url) => {
      providerCalls++;
      entered?.();
      if (gate) await gate;
      if (fail) return new Response('private', { status: 500 });
      return Response.json(url.includes('googleapis')
        ? { candidates: [{ content: { parts: [{ text: 'Respuesta' }] } }] }
        : { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Respuesta' }] }] });
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  const accounts = await createAccounts({ databasePath, baseURL });
  releaseAccounts(accounts);
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const call = async (path, cookie, body, extraHeaders = {}) => {
    const response = await fetch(baseURL + path, {
      method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Origin: baseURL, Cookie: cookie || '', ...extraHeaders },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json(), cookie: response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ') };
  };
  const register = (name) => call('/api/auth/sign-up/email', '', { name, email: `${name}@example.test`, password: 'Demo-password-2026' });
  const ana = await register('Ana');
  const bob = await register('Bob');
  assert.equal(ana.status, 200);
  assert.equal(bob.status, 200);
  assert.equal((await call('/api/usage', '')).status, 401);
  const chat = (provider = 'gemini', mode = 'platform') => ({ provider, mode, messages: [{ role: 'user', content: 'Pregunta' }], remaining: 999, userId: bob.data.user.id });
  fail = true;
  assert.equal((await call('/api/chat', ana.cookie, chat())).status, 502);
  assert.equal(accounts.getUsage(ana.data.user.id).used, 0, 'provider errors refund the reservation');
  fail = false;
  for (let index = 0; index < 4; index++) {
    assert.equal((await call('/api/chat', ana.cookie, chat(index % 2 ? 'openai' : 'gemini'))).status, 200);
  }
  let release;
  gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { entered = resolve; });
  const fifth = call('/api/chat', ana.cookie, chat());
  await started;
  const before = providerCalls;
  const blocked = await Promise.all([call('/api/chat', ana.cookie, chat()), call('/api/chat', ana.cookie, chat('openai'))]);
  assert.ok(blocked.every(({ status, data }) => status === 403 && data.code === 'FREE_MESSAGES_EXHAUSTED'));
  assert.equal(providerCalls, before, 'concurrent requests cannot bypass the last available slot');
  release();
  gate = null;
  assert.equal((await fifth).status, 200);
  const quota = { limit: 5, used: 5, remaining: 0 };
  assert.deepEqual((await call('/api/usage', ana.cookie)).data.usage, quota);
  const reopened = await createAccounts({ databasePath, baseURL });
  try { assert.deepEqual(reopened.getUsage(ana.data.user.id), quota); }
  finally { reopened.close(); }
  assert.equal((await call('/api/chat', ana.cookie, chat('gemini', 'personal'), { Authorization: 'Bearer personal-key' })).status, 200);
  assert.deepEqual(accounts.getUsage(ana.data.user.id), quota, 'personal keys do not consume platform messages');
  assert.equal((await call('/api/chat', bob.cookie, chat())).status, 200);
  assert.equal(accounts.getUsage(bob.data.user.id).remaining, 4, 'another account has its own allowance');
});
