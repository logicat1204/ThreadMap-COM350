import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createAccounts } from '../accounts.js';
import { ADMIN_EMAIL } from '../administration.js';
import { createThreadMapServer } from '../server.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'threadmap-admin-'));
  const databasePath = join(directory, 'accounts.sqlite');
  let releaseAccounts;
  const ready = new Promise((resolve) => { releaseAccounts = resolve; });
  const server = createThreadMapServer({ accounts: ready, geminiPlatformKey: 'test-key', fetchProvider: async () => Response.json({ candidates: [{ content: { parts: [{ text: 'Respuesta' }] } }] }) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  const accounts = await createAccounts({ databasePath, baseURL }); releaseAccounts(accounts);
  const db = new Database(databasePath);
  t.after(async () => { db.close(); await new Promise((resolve) => server.close(resolve)); await new Promise((resolve) => setImmediate(resolve)); await rm(directory, { recursive: true, force: true }); });
  const call = async (path, { body, cookie, token, origin = baseURL, method = body === undefined ? 'GET' : 'POST' } = {}) => {
    const response = await fetch(baseURL + path, { method, redirect: 'manual',
      headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, data: response.headers.get('content-type')?.startsWith('application/json') ? JSON.parse(text) : text,
      cookie: response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; '), headers: response.headers };
  };
  const loginPassword = 'Account-test-password-2026';
  const adminPassword = 'Admin-test-password-2026';
  const register = (email, name = 'Demo') => call('/api/auth/sign-up/email', { body: { name, email, password: loginPassword } });
  const code = (await readFile(join(directory, 'admin-setup-code'), 'utf8')).trim();
  return { directory, databasePath, baseURL, accounts, db, call, code, register, loginPassword, adminPassword };
}

test('administration requires the bound owner, a one-time server code and a second password', async (t) => {
  const f = await fixture(t);
  const { call, register, loginPassword, adminPassword, code, db } = f;
  const owner = await register(ADMIN_EMAIL, 'Owner');
  const regular = await register('participant@example.test', '<img src=x onerror=alert(1)>');
  assert.equal(owner.status, 200);
  assert.equal(regular.status, 200);
  let capability;
  await t.test('anonymous and other accounts cannot see users or register admin credentials', async () => {
    assert.equal((await call('/admin')).headers.get('location'), '/app?modo=login&next=admin');
    for (const path of ['/api/admin/status', '/api/admin/users']) {
      assert.equal((await call(path)).status, 401);
      assert.equal((await call(path, { cookie: regular.cookie })).status, 403);
    }
    assert.equal((await call('/api/admin/setup', { cookie: regular.cookie, body: { code, loginPassword, password: adminPassword } })).status, 403);
    assert.equal((await call('/api/admin/users', { cookie: owner.cookie })).status, 423);
    assert.deepEqual((await call('/api/admin/status', { cookie: owner.cookie })).data, { setupRequired: true });
    assert.equal((await call('/api/me', { cookie: regular.cookie })).data.user.admin, false);
  });
  await t.test('knowing the email and account password is insufficient for first activation', async () => {
    assert.equal((await call('/api/admin/setup', { cookie: owner.cookie, body: { code: 'wrong-code', loginPassword, password: adminPassword } })).status, 403);
    assert.equal((await call('/api/admin/setup', { cookie: owner.cookie, body: { code, loginPassword, password: loginPassword } })).status, 400);
    const setup = await call('/api/admin/setup', { cookie: owner.cookie, body: { code, loginPassword, password: adminPassword } });
    assert.equal(setup.status, 200, JSON.stringify(setup.data)); capability = setup.data.token;
    assert.equal(db.prepare('SELECT user_id FROM admin_owner').get().user_id, owner.data.user.id);
    const stored = db.prepare('SELECT password_hash FROM admin_owner').get().password_hash;
    assert.notEqual(stored, adminPassword); assert.ok(stored.length > 50);
    await assert.rejects(readFile(join(f.directory, 'admin-setup-code')), { code: 'ENOENT' });
    assert.equal((await call('/api/admin/setup', { cookie: owner.cookie, body: { code, loginPassword, password: adminPassword } })).status, 409);
  });
  await t.test('owner-only statistics include emails and accesses but never credentials', async () => {
    const result = await call('/api/admin/users', { cookie: owner.cookie, token: capability });
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.summary, { registered: 2, peopleWithLogins: 2, logins: 2 });
    assert.equal(result.data.users.find((user) => user.id === regular.data.user.id).email, 'participant@example.test');
    assert.doesNotMatch(JSON.stringify(result.data), /password|password_hash|Account-test|Admin-test/);
    assert.equal((await call('/api/admin/users', { cookie: regular.cookie, token: capability })).status, 403);
    const otherSession = await call('/api/auth/sign-in/email', { body: { email: ADMIN_EMAIL, password: loginPassword } });
    assert.equal((await call('/api/admin/users', { cookie: otherSession.cookie, token: capability })).status, 423, 'capabilities are bound to their application session');
  });
  await t.test('grants are validated, durable and honored by the real platform allowance', async () => {
    const userId = regular.data.user.id;
    for (let index = 0; index < 5; index++) assert.ok(f.accounts.reserveMessage(userId));
    assert.equal(f.accounts.reserveMessage(userId), false);
    for (const amount of [0, -1, 1.5, 1001, '10']) {
      assert.equal((await call('/api/admin/grant', { cookie: owner.cookie, token: capability, body: { userId, amount } })).status, 400);
    }
    assert.equal((await call('/api/admin/grant', { cookie: regular.cookie, token: capability, body: { userId, amount: 20 } })).status, 403);
    assert.equal((await call('/api/admin/grant', { cookie: owner.cookie, token: capability, origin: 'https://attacker.example', body: { userId, amount: 20 } })).status, 403);
    assert.equal((await call('/api/admin/grant', { cookie: owner.cookie, token: capability, body: { userId, amount: 3 } })).status, 200);
    assert.deepEqual((await call('/api/usage', { cookie: regular.cookie })).data.usage, { used: 5, limit: 8, remaining: 3 });
    const answer = await call('/api/chat', { cookie: regular.cookie, body: { provider: 'gemini', mode: 'platform', messages: [{ role: 'user', content: 'Pregunta' }] } });
    assert.equal(answer.status, 200);
    const reopened = await createAccounts({ databasePath: f.databasePath, baseURL: f.baseURL });
    try { assert.deepEqual(reopened.getUsage(userId), { used: 6, limit: 8, remaining: 2 }); }
    finally { reopened.close(); }
  });
  await t.test('recovery links are private, expire, are one-use and revoke old account sessions', async () => {
    const userId = regular.data.user.id;
    assert.equal((await call('/api/admin/reset-link', { cookie: regular.cookie, body: { userId } })).status, 403);
    assert.equal((await call('/api/auth/request-password-reset', { body: { email: regular.data.user.email } })).status, 403);
    const old = await call('/api/admin/reset-link', { cookie: owner.cookie, token: capability, body: { userId } });
    assert.equal(old.status, 200, JSON.stringify(old.data));
    const oldToken = new URLSearchParams(new URL(old.data.url).hash.slice(1)).get('token');
    const result = await call('/api/admin/reset-link', { cookie: owner.cookie, token: capability, body: { userId } });
    const resetToken = new URLSearchParams(new URL(result.data.url).hash.slice(1)).get('token');
    assert.equal(new URL(result.data.url).search, '', 'tokens are kept out of the URL query');
    assert.equal((await call('/api/auth/reset-password', { body: { token: oldToken, newPassword: 'New-account-password-2026' } })).status, 400);
    assert.equal((await call('/api/auth/reset-password', { body: { token: resetToken, newPassword: 'New-account-password-2026' } })).status, 200);
    assert.equal((await call('/api/me', { cookie: regular.cookie })).data.user, null);
    assert.equal((await call('/api/auth/reset-password', { body: { token: resetToken, newPassword: 'Another-password-2026' } })).status, 400);
    const signedIn = await call('/api/auth/sign-in/email', { body: { email: regular.data.user.email, password: 'New-account-password-2026' } });
    assert.equal(signedIn.status, 200);
    assert.deepEqual(f.accounts.getUsage(userId), { used: 6, limit: 8, remaining: 2 }, 'recovery does not change the allowance');
    const expired = await call('/api/admin/reset-link', { cookie: owner.cookie, token: capability, body: { userId } });
    const expiredToken = new URLSearchParams(new URL(expired.data.url).hash.slice(1)).get('token');
    db.prepare('UPDATE verification SET expiresAt = ? WHERE identifier = ?').run(Date.now() - 1000, `reset-password:${expiredToken}`);
    assert.equal((await call('/api/auth/reset-password', { body: { token: expiredToken, newPassword: 'Another-password-2026' } })).status, 400);
  });
  await t.test('locking, expiry, password changes and logout revoke privileged access', async () => {
    assert.equal((await call('/api/admin/lock', { cookie: owner.cookie, token: capability, body: {} })).status, 200);
    assert.equal((await call('/api/admin/users', { cookie: owner.cookie, token: capability })).status, 423);
    assert.equal((await call('/api/admin/unlock', { cookie: owner.cookie, body: { password: loginPassword } })).status, 403);
    capability = (await call('/api/admin/unlock', { cookie: owner.cookie, body: { password: adminPassword } })).data.token;
    db.prepare('UPDATE admin_unlock SET expires_at = ?').run(Date.now() - 1);
    assert.equal((await call('/api/admin/users', { cookie: owner.cookie, token: capability })).status, 423);
    capability = (await call('/api/admin/unlock', { cookie: owner.cookie, body: { password: adminPassword } })).data.token;
    const changed = await call('/api/admin/password', { cookie: owner.cookie, token: capability, body: { currentPassword: adminPassword, password: 'Replacement-admin-password-2026' } });
    assert.equal(changed.status, 200);
    assert.equal((await call('/api/admin/users', { cookie: owner.cookie, token: capability })).status, 423);
    assert.equal((await call('/api/admin/unlock', { cookie: owner.cookie, body: { password: adminPassword } })).status, 403);
    const unlock = await call('/api/admin/unlock', { cookie: owner.cookie, body: { password: 'Replacement-admin-password-2026' } });
    assert.equal(unlock.status, 200); capability = unlock.data.token;
    assert.equal((await call('/api/auth/sign-out', { cookie: owner.cookie, body: {} })).status, 200);
    assert.equal((await call('/api/admin/users', { cookie: owner.cookie, token: capability })).status, 401);
  });
});

test('admin password guessing is throttled in SQLite across server instances', async (t) => {
  const f = await fixture(t);
  const owner = await f.register(ADMIN_EMAIL);
  const setup = await f.call('/api/admin/setup', { cookie: owner.cookie, body: { code: f.code, loginPassword: f.loginPassword, password: f.adminPassword } });
  assert.equal(setup.status, 200);
  for (let index = 0; index < 5; index++) {
    assert.equal((await f.call('/api/admin/unlock', { cookie: owner.cookie, body: { password: 'wrong' } })).status, 403);
  }
  const reopened = await createAccounts({ databasePath: f.databasePath, baseURL: f.baseURL });
  try {
    const session = await reopened.getSession({ headers: { cookie: owner.cookie } });
    await assert.rejects(reopened.administration.unlock(session, { password: f.adminPassword }), (error) => error.status === 429);
  } finally { reopened.close(); }
});
