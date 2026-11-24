import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve as absolute } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createAccounts } from '../accounts.js';
import { createThreadMapServer } from '../server.js';
import { createBranch, createThread, message } from '../public/threads.js';

test('real registration, sessions and private workspaces survive restarts', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'threadmap-accounts-'));
  const databasePath = join(directory, 'accounts.sqlite');
  let resolveAccounts;
  const ready = new Promise((resolve) => { resolveAccounts = resolve; });
  let providerCalls = 0;
  const server = createThreadMapServer({ accounts: ready, fetchProvider: () => { providerCalls++; } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  const accounts = await createAccounts({ databasePath, baseURL });
  resolveAccounts(accounts);
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    assert.equal(dirname(absolute(directory)), absolute(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  });
  const request = async (path, { method = 'GET', body, cookie, origin = baseURL } = {}) => {
    const response = await fetch(`${baseURL}${path}`, {
      method, headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const cookies = response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    return { status: response.status, data: await response.json(), cookies, headers: response.headers };
  };
  const password = 'Demo-password-2026';
  const register = (name, email) => request('/api/auth/sign-up/email', { method: 'POST', body: { name, email, password } });
  let ana;
  let luis;
  let workspace;

  await t.test('anonymous requests cannot read, overwrite or generate chats', async () => {
    assert.deepEqual((await request('/api/me')).data, { user: null });
    assert.equal((await request('/api/workspace')).status, 401);
    assert.equal((await request('/api/workspace', { method: 'PUT', body: {} })).status, 401);
    assert.equal((await request('/api/chat', { method: 'POST', body: {} })).status, 401);
    assert.equal(providerCalls, 0);
    assert.equal((await request('/api/auth/sign-up/email', { method: 'POST', body: { name: 'A'.repeat(20_000) } })).status, 413);
  });
  await t.test('registers two users with signed session cookies and hashes their passwords', async () => {
    ana = await register('Ana', 'ana@example.test');
    luis = await register('Luis', 'luis@example.test');
    assert.equal(ana.status, 200, JSON.stringify(ana.data));
    assert.equal(luis.status, 200, JSON.stringify(luis.data));
    assert.ok(ana.cookies);
    assert.match(ana.headers.getSetCookie().join(' '), /HttpOnly/i);
    assert.match(ana.headers.getSetCookie().join(' '), /SameSite=Lax/i);
    const db = new Database(databasePath, { readonly: true });
    const stored = db.prepare('SELECT password FROM account WHERE userId = ?').get(ana.data.user.id).password;
    assert.notEqual(stored, password);
    assert.ok(stored.length > 50);
    db.close();
  });
  await t.test('a registered user can save a tree and a different account cannot see or overwrite it', async () => {
    const thread = createThread();
    thread.branches[thread.rootId].messages.push(message('user', 'Pregunta privada de Ana'));
    const branch = createBranch(thread, thread.rootId, thread.branches[thread.rootId].messages[0].id, 'privada', 'Rama de Ana');
    workspace = { threads: [thread], threadId: thread.id, branchId: branch.id };
    const saved = await request('/api/workspace', { method: 'PUT', cookie: ana.cookies, body: { revision: 0, workspace } });
    assert.deepEqual(saved.data, { revision: 1 });
    assert.deepEqual((await request('/api/workspace', { cookie: ana.cookies })).data.workspace, workspace);
    assert.equal((await request('/api/workspace', { cookie: luis.cookies })).data.workspace, null);
    const empty = { threads: [], threadId: null, branchId: null };
    await request('/api/workspace', { method: 'PUT', cookie: luis.cookies, body: { userId: ana.data.user.id, revision: 0, workspace: empty } });
    assert.deepEqual((await request('/api/workspace', { cookie: ana.cookies })).data.workspace, workspace);
  });
  await t.test('stale tabs and cross-origin requests cannot overwrite saved conversations', async () => {
    assert.equal((await request('/api/workspace', { method: 'PUT', cookie: ana.cookies, body: { revision: 0, workspace } })).status, 409);
    assert.equal((await request('/api/workspace', { method: 'PUT', cookie: ana.cookies, origin: 'https://elsewhere.example', body: { revision: 1, workspace } })).status, 403);
    assert.deepEqual((await request('/api/workspace', { cookie: ana.cookies })).data.workspace, workspace);
  });
  await t.test('rejects cyclic trees and temporary chat persistence', async () => {
    const cyclic = structuredClone(workspace);
    const root = cyclic.threads[0].branches[cyclic.threads[0].rootId];
    root.parentId = cyclic.branchId;
    assert.equal((await request('/api/workspace', { method: 'PUT', cookie: ana.cookies, body: { revision: 1, workspace: cyclic } })).status, 400);
    const temporary = structuredClone(workspace);
    temporary.threads[0].temporary = true;
    assert.equal((await request('/api/workspace', { method: 'PUT', cookie: ana.cookies, body: { revision: 1, workspace: temporary } })).status, 400);
  });
  await t.test('logout revokes the old session, and a new login restores the same history', async () => {
    const oldCookie = ana.cookies;
    assert.equal((await request('/api/auth/sign-out', { method: 'POST', cookie: oldCookie, body: {} })).status, 200);
    assert.equal((await request('/api/workspace', { cookie: oldCookie })).status, 401);
    const wrong = await request('/api/auth/sign-in/email', { method: 'POST', body: { email: 'ana@example.test', password: 'incorrect-password' } });
    assert.equal(wrong.status, 401);
    ana = await request('/api/auth/sign-in/email', { method: 'POST', body: { email: 'ana@example.test', password } });
    assert.equal(ana.status, 200);
    assert.deepEqual((await request('/api/workspace', { cookie: ana.cookies })).data.workspace, workspace);
    const tampered = ana.cookies.replace(/=(.)/, '=x$1');
    assert.equal((await request('/api/workspace', { cookie: tampered })).status, 401);
  });
  await t.test('the database and session secret can be reopened without losing accounts or conversations', async () => {
    const reopened = await createAccounts({ databasePath, baseURL });
    try {
      assert.deepEqual(reopened.loadWorkspace(ana.data.user.id).workspace, workspace);
      assert.equal((await reopened.getSession({ headers: { cookie: ana.cookies } })).user.id, ana.data.user.id);
    } finally { reopened.close(); }
  });
  await t.test('repeated bad logins are throttled even with spoofed IP headers', async () => {
    let status;
    for (let i = 0; i < 10; i++) {
      const response = await fetch(`${baseURL}/api/auth/sign-in/email`, { method: 'POST',
        headers: { Origin: baseURL, 'Content-Type': 'application/json', 'x-threadmap-ip': `1.2.3.${i}` },
        body: JSON.stringify({ email: 'luis@example.test', password: 'incorrect-password' }) });
      status = response.status;
      await response.arrayBuffer();
      if (status === 429) break;
    }
    assert.equal(status, 429);
  });
});
