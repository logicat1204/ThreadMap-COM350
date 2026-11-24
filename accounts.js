import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { appOrigin } from './runtime.js';
import { createAdministration } from './administration.js';

export class AccountError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const FREE_MESSAGE_LIMIT = 5;

function localSecret(directory) {
  const path = resolve(directory, 'session-secret');
  try { writeFileSync(path, randomBytes(48).toString('base64url'), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  return readFileSync(path, 'utf8').trim();
}

// Validate the full tree before accepting a workspace. Only this account's document is writable.
export function validateWorkspace(workspace) {
  const invalid = () => { throw new AccountError(400, 'El historial contiene datos inválidos.'); };
  const id = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
  const text = (value, limit) => typeof value === 'string' && value.length <= limit;
  const date = (value) => text(value, 40) && Number.isFinite(Date.parse(value));
  if (!workspace || !Array.isArray(workspace.threads) || workspace.threads.length > 300) invalid();
  const threadIds = new Set();
  for (const thread of workspace.threads) {
    if (!thread || !id(thread.id) || threadIds.has(thread.id) || thread.temporary || !text(thread.title, 200) ||
        !date(thread.updatedAt) || !id(thread.rootId) || !thread.branches || typeof thread.branches !== 'object' || Array.isArray(thread.branches)) invalid();
    threadIds.add(thread.id);
    const branches = Object.values(thread.branches);
    if (!branches.length || branches.length > 500 || !Object.hasOwn(thread.branches, thread.rootId)) invalid();
    const messageIds = new Set();
    for (const [key, branch] of Object.entries(thread.branches)) {
      if (!branch || !id(branch.id) || key !== branch.id || !date(branch.createdAt) ||
          !Array.isArray(branch.messages) || branch.messages.length > 2000) invalid();
      for (const entry of branch.messages) {
        if (!entry || !id(entry.id) || messageIds.has(entry.id) || !['user', 'assistant'].includes(entry.role) ||
            !text(entry.content, 200_000) || !date(entry.createdAt) ||
            (entry.reference != null && !text(entry.reference, 200_000))) invalid();
        messageIds.add(entry.id);
      }
      if (branch.id === thread.rootId) {
        if (branch.parentId != null) invalid();
      } else {
        const parent = thread.branches[branch.parentId];
        if (!id(branch.parentId) || !Object.hasOwn(thread.branches, branch.parentId) || !Array.isArray(parent?.messages) ||
            !parent.messages.some((entry) => entry?.id === branch.originMessageId)) invalid();
      }
      if (branch.excerpt != null && !text(branch.excerpt, 200_000)) invalid();
      const visited = new Set();
      let ancestor = branch;
      while (ancestor) {
        if (visited.has(ancestor.id)) invalid();
        visited.add(ancestor.id);
        if (ancestor.parentId == null && ancestor.id !== thread.rootId) invalid();
        ancestor = ancestor.parentId == null ? null : thread.branches[ancestor.parentId];
      }
    }
  }
  if (workspace.threads.length) {
    const active = workspace.threads.find((thread) => thread.id === workspace.threadId);
    if (!active || !id(workspace.branchId) || !Object.hasOwn(active.branches, workspace.branchId)) invalid();
  } else if (workspace.threadId != null || workspace.branchId != null) invalid();
  return { threads: workspace.threads, threadId: workspace.threadId ?? null, branchId: workspace.branchId ?? null };
}

export async function createAccounts({
  databasePath = process.env.DATABASE_PATH || resolve('data', 'threadmap.sqlite'),
  baseURL = process.env.APP_URL || `http://127.0.0.1:${process.env.PORT || 3000}`,
  secret = process.env.BETTER_AUTH_SECRET,
} = {}) {
  appOrigin(baseURL);
  if (process.env.NODE_ENV === 'production' && !secret) throw new Error('Configura un BETTER_AUTH_SECRET permanente en producción.');
  mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  secret ||= localSecret(dirname(resolve(databasePath)));
  if (secret.length < 32) throw new Error('BETTER_AUTH_SECRET debe tener al menos 32 caracteres.');
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  try {
    const origin = new URL(baseURL);
    const trustedOrigins = [origin.origin];
    if (['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) {
      for (const host of ['127.0.0.1', 'localhost', '[::1]']) trustedOrigins.push(`${origin.protocol}//${host}:${origin.port}`);
    }
    const resetCapture = new AsyncLocalStorage();
    let administration;
    const auth = betterAuth({
      appName: 'ThreadMap', baseURL, secret, database: db, trustedOrigins,
      emailAndPassword: { enabled: true, requireEmailVerification: false, minPasswordLength: 8, maxPasswordLength: 128,
        resetPasswordTokenExpiresIn: 900, revokeSessionsOnPasswordReset: true,
        async sendResetPassword({ token }) { const capture = resetCapture.getStore(); if (capture) capture.token = token; },
      },
      databaseHooks: { session: { create: { after: async (session) => { administration?.recordLogin(session.userId); } } } },
      session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
      rateLimit: { enabled: true, storage: 'database', window: 60, max: 60,
        customRules: {
          '/sign-in/email': { window: 60, max: positiveLimit('AUTH_SIGNIN_RATE_LIMIT', 8) },
          '/sign-up/email': { window: 60, max: positiveLimit('AUTH_SIGNUP_RATE_LIMIT', 5) },
        } },
      advanced: { ipAddress: { ipAddressHeaders: ['x-threadmap-ip'] }, useSecureCookies: origin.protocol === 'https:' },
    });
    await (await getMigrations(auth.options)).runMigrations();
    db.exec(`CREATE TABLE IF NOT EXISTS workspace (
      user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
      document TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS platform_usage (
      user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
      used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0)
    )`);
    if (!db.pragma('table_info(platform_usage)').some((column) => column.name === 'allowance')) {
      db.exec('ALTER TABLE platform_usage ADD COLUMN allowance INTEGER NOT NULL DEFAULT 5 CHECK (allowance >= 0)');
    }
    administration = createAdministration({ db, directory: dirname(resolve(databasePath)), origin: origin.origin,
      async issueReset(email) {
        const capture = {};
        await resetCapture.run(capture, () => auth.api.requestPasswordReset({ body: { email, redirectTo: `${origin.origin}/restablecer` } }));
        if (!capture.token) throw new AccountError(500, 'No se pudo generar el enlace de recuperación.');
        return capture.token;
      },
    });
    const usage = db.prepare('SELECT used, allowance FROM platform_usage WHERE user_id = ?');
    const addUsage = db.prepare('INSERT OR IGNORE INTO platform_usage (user_id) VALUES (?)');
    const reserve = db.prepare('UPDATE platform_usage SET used = used + 1 WHERE user_id = ? AND used < allowance');
    const refund = db.prepare('UPDATE platform_usage SET used = used - 1 WHERE user_id = ? AND used > 0');
    const reserveMessage = db.transaction((userId) => {
      addUsage.run(userId);
      return reserve.run(userId).changes === 1;
    });
    const load = db.prepare('SELECT document, revision FROM workspace WHERE user_id = ?');
    const insert = db.prepare('INSERT OR IGNORE INTO workspace (user_id, document, revision) VALUES (?, ?, 0)');
    const update = db.prepare('UPDATE workspace SET document = ?, revision = revision + 1 WHERE user_id = ? AND revision = ?');
    const empty = JSON.stringify({ threads: [], threadId: null, branchId: null });
    const save = db.transaction((userId, revision, document) => {
      insert.run(userId, empty);
      if (update.run(document, userId, revision).changes !== 1) {
        throw new AccountError(409, 'Tu historial cambió en otra pestaña. Recarga antes de continuar.');
      }
      return revision + 1;
    });
    return {
      authHandler: toNodeHandler(auth),
      async getSession(request) { return auth.api.getSession({ headers: fromNodeHeaders(request.headers) }); },
      administration,
      getUsage(userId) {
        const row = usage.get(userId);
        const used = row?.used ?? 0;
        const limit = row?.allowance ?? FREE_MESSAGE_LIMIT;
        return { limit, used, remaining: Math.max(0, limit - used) };
      },
      reserveMessage,
      refundMessage(userId) { refund.run(userId); },
      loadWorkspace(userId) {
        const row = load.get(userId);
        return row ? { workspace: JSON.parse(row.document), revision: row.revision } : { workspace: null, revision: 0 };
      },
      saveWorkspace(userId, revision, workspace) {
        if (!Number.isSafeInteger(revision) || revision < 0) throw new AccountError(400, 'La versión del historial no es válida.');
        const document = JSON.stringify(validateWorkspace(workspace));
        if (Buffer.byteLength(document) > 8_000_000) throw new AccountError(413, 'El historial supera el espacio de la demo.');
        return save(userId, revision, document);
      },
      close() { db.close(); },
    };
  } catch (error) { db.close(); throw error; }
}

function positiveLimit(name, fallback) {
  const value = process.env[name] ? Number(process.env[name]) : fallback;
  if (!Number.isInteger(value) || value < 1 || value > 1000) throw new Error(`${name} debe ser un entero entre 1 y 1000.`);
  return value;
}
