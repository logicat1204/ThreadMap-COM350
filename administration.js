import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hashPassword, verifyPassword } from 'better-auth/crypto';

export const ADMIN_EMAIL = 'josiasquispe999@gmail.com';
const unlockLifetime = 15 * 60_000;
const digest = (value) => createHash('sha256').update(value).digest('hex');
const same = (left, right) => timingSafeEqual(Buffer.from(digest(left)), Buffer.from(digest(right)));
const timestamp = (value) => typeof value === 'number' ? value : Date.parse(value);

export class AdminError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function createAdministration({ db, directory, origin, issueReset }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_owner (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      user_id TEXT NOT NULL UNIQUE REFERENCES user(id), password_hash TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_unlock (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_attempt (
      user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE, count INTEGER NOT NULL, started_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_access (
      user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
      login_count INTEGER NOT NULL DEFAULT 0, last_login_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_audit (
      id INTEGER PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT, amount INTEGER, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_metrics (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1), started_at INTEGER NOT NULL
    );
  `);
  const metrics = db.prepare('INSERT OR IGNORE INTO admin_metrics VALUES (1, ?)').run(Date.now());
  // Historical logins cannot be reconstructed; seed only sessions that still exist.
  if (metrics.changes) {
    const backfill = db.prepare(`INSERT INTO user_access VALUES (?, 1, ?)
      ON CONFLICT(user_id) DO UPDATE SET login_count = login_count + 1, last_login_at = max(last_login_at, excluded.last_login_at)`);
    for (const row of db.prepare('SELECT userId, createdAt FROM session').all()) backfill.run(row.userId, timestamp(row.createdAt));
  }
  const owner = () => db.prepare('SELECT * FROM admin_owner WHERE singleton = 1').get();
  const setupPath = resolve(directory, 'admin-setup-code');
  if (!owner()) {
    try { writeFileSync(setupPath, randomBytes(32).toString('base64url'), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const audit = (actor, action, target = null, amount = null) => db.prepare(
    'INSERT INTO admin_audit (actor_id, action, target_id, amount, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(actor, action, target, amount, Date.now());
  const eligible = (user) => user?.email?.toLowerCase() === ADMIN_EMAIL && (!owner() || owner().user_id === user.id);
  const requireOwner = (session) => {
    if (!session) throw new AdminError(401, 'Inicia sesión para continuar.');
    if (!eligible(session.user)) throw new AdminError(403, 'No tienes acceso a la administración.');
  };
  const checkPassword = async (userId, password) => {
    if (typeof password !== 'string' || password.length > 128) return false;
    const credential = db.prepare("SELECT password FROM account WHERE userId = ? AND providerId = 'credential'").get(userId);
    return Boolean(credential?.password && await verifyPassword({ hash: credential.password, password }));
  };
  const attempt = (userId) => {
    const now = Date.now();
    db.prepare(`INSERT INTO admin_attempt VALUES (?, 1, ?) ON CONFLICT(user_id) DO UPDATE SET
      count = CASE WHEN started_at <= ? THEN 1 ELSE count + 1 END,
      started_at = CASE WHEN started_at <= ? THEN excluded.started_at ELSE started_at END`
    ).run(userId, now, now - unlockLifetime, now - unlockLifetime);
    if (db.prepare('SELECT count FROM admin_attempt WHERE user_id = ?').get(userId).count > 5) {
      throw new AdminError(429, 'Demasiados intentos. Espera 15 minutos antes de volver a probar.');
    }
  };
  const clearAttempts = (userId) => db.prepare('DELETE FROM admin_attempt WHERE user_id = ?').run(userId);
  const validateNewPassword = async (userId, password) => {
    if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
      throw new AdminError(400, 'Usa entre 12 y 128 caracteres para la contraseña administrativa.');
    }
    if (await checkPassword(userId, password)) throw new AdminError(400, 'La contraseña administrativa debe ser distinta de la de tu cuenta.');
  };
  const mintUnlock = (session) => {
    db.prepare('DELETE FROM admin_unlock WHERE expires_at <= ?').run(Date.now());
    const token = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + unlockLifetime;
    db.prepare('INSERT INTO admin_unlock VALUES (?, ?, ?, ?)').run(digest(token), session.user.id, session.session.id, expiresAt);
    return { token, expiresAt };
  };
  const authorize = (session, token) => {
    requireOwner(session);
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token) || !db.prepare(
      'SELECT 1 FROM admin_unlock WHERE token_hash = ? AND user_id = ? AND session_id = ? AND expires_at > ?'
    ).get(digest(token), session.user.id, session.session.id, Date.now())) {
      throw new AdminError(423, 'Desbloquea la administración con tu segunda contraseña.');
    }
  };
  return {
    eligible,
    recordLogin(userId) {
      db.prepare(`INSERT INTO user_access VALUES (?, 1, ?) ON CONFLICT(user_id) DO UPDATE SET
        login_count = login_count + 1, last_login_at = excluded.last_login_at`).run(userId, Date.now());
    },
    status(session) { requireOwner(session); return { setupRequired: !owner() }; },
    async setup(session, { code, loginPassword, password }) {
      requireOwner(session);
      attempt(session.user.id);
      if (owner()) throw new AdminError(409, 'La administración ya está activada.');
      const validCode = typeof code === 'string' && code.length <= 128 && same(code.trim(), readFileSync(setupPath, 'utf8').trim());
      if (!validCode || !await checkPassword(session.user.id, loginPassword)) throw new AdminError(403, 'El código de activación o la contraseña de tu cuenta no son correctos.');
      await validateNewPassword(session.user.id, password);
      const hash = await hashPassword(password);
      const inserted = db.prepare('INSERT OR IGNORE INTO admin_owner VALUES (1, ?, ?, ?)').run(session.user.id, hash, Date.now());
      if (!inserted.changes) throw new AdminError(409, 'La administración ya está activada.');
      clearAttempts(session.user.id);
      audit(session.user.id, 'setup');
      try { unlinkSync(setupPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      return mintUnlock(session);
    },
    async unlock(session, { password }) {
      requireOwner(session);
      attempt(session.user.id);
      const configured = owner();
      if (!configured) throw new AdminError(409, 'Primero activa la administración.');
      if (typeof password !== 'string' || password.length > 128 || !await verifyPassword({ hash: configured.password_hash, password })) {
        throw new AdminError(403, 'La contraseña administrativa no es correcta.');
      }
      if (owner()?.password_hash !== configured.password_hash) throw new AdminError(409, 'La contraseña cambió. Desbloquea con la nueva contraseña.');
      clearAttempts(session.user.id);
      audit(session.user.id, 'unlock');
      return mintUnlock(session);
    },
    authorize,
    lock(session, token) {
      requireOwner(session);
      if (typeof token === 'string') db.prepare('DELETE FROM admin_unlock WHERE token_hash = ? AND user_id = ?').run(digest(token), session.user.id);
    },
    users(session, token) {
      authorize(session, token);
      const users = db.prepare(`SELECT u.id, u.name, u.email, u.createdAt,
        coalesce(a.login_count, 0) AS loginCount, a.last_login_at AS lastLoginAt,
        coalesce(p.used, 0) AS used, coalesce(p.allowance, 5) AS allowance
        FROM user u LEFT JOIN user_access a ON a.user_id = u.id LEFT JOIN platform_usage p ON p.user_id = u.id
        ORDER BY u.createdAt DESC`).all().map((user) => ({ ...user, createdAt: timestamp(user.createdAt), remaining: Math.max(0, user.allowance - user.used) }));
      return {
        users,
        summary: { registered: users.length, peopleWithLogins: users.filter((user) => user.loginCount > 0).length, logins: users.reduce((sum, user) => sum + user.loginCount, 0) },
        metricsStartedAt: db.prepare('SELECT started_at FROM admin_metrics WHERE singleton = 1').get().started_at,
        audit: db.prepare('SELECT action, target_id AS targetId, amount, created_at AS createdAt FROM admin_audit ORDER BY id DESC LIMIT 30').all(),
      };
    },
    grant(session, token, { userId, amount }) {
      authorize(session, token);
      if (typeof userId !== 'string' || !Number.isInteger(amount) || amount < 1 || amount > 1000) throw new AdminError(400, 'Añade entre 1 y 1000 mensajes por operación.');
      if (!db.prepare('SELECT 1 FROM user WHERE id = ?').get(userId)) throw new AdminError(404, 'La cuenta no existe.');
      db.transaction(() => {
        db.prepare('INSERT OR IGNORE INTO platform_usage (user_id) VALUES (?)').run(userId);
        db.prepare('UPDATE platform_usage SET allowance = allowance + ? WHERE user_id = ?').run(amount, userId);
        audit(session.user.id, 'grant', userId, amount);
      })();
      return { status: 'ok' };
    },
    async resetLink(session, token, { userId }) {
      authorize(session, token);
      if (typeof userId !== 'string') throw new AdminError(400, 'Selecciona una cuenta.');
      const user = db.prepare('SELECT id, email FROM user WHERE id = ?').get(userId);
      if (!user) throw new AdminError(404, 'La cuenta no existe.');
      // Only one outstanding link per target. Issuing it does not change their password yet.
      db.prepare("DELETE FROM verification WHERE value = ? AND identifier LIKE 'reset-password:%'").run(userId);
      const resetToken = await issueReset(user.email);
      audit(session.user.id, 'reset-link', userId);
      return { url: `${origin}/restablecer#token=${encodeURIComponent(resetToken)}`, expiresInMinutes: 15 };
    },
    async changePassword(session, token, { currentPassword, password }) {
      authorize(session, token);
      attempt(session.user.id);
      if (typeof currentPassword !== 'string' || currentPassword.length > 128 || !await verifyPassword({ hash: owner().password_hash, password: currentPassword })) {
        throw new AdminError(403, 'La contraseña administrativa actual no es correcta.');
      }
      await validateNewPassword(session.user.id, password);
      const hash = await hashPassword(password);
      // A concurrent password change cannot use a capability invalidated while hashing.
      authorize(session, token);
      db.transaction(() => {
        db.prepare('UPDATE admin_owner SET password_hash = ? WHERE singleton = 1').run(hash);
        db.prepare('DELETE FROM admin_unlock').run();
        clearAttempts(session.user.id);
        audit(session.user.id, 'change-password');
      })();
      return { status: 'ok' };
    },
  };
}
