import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const tokenHash = (req) => {
  const token = (req.headers.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("forma_session="))
    ?.slice(14);
  return token ? digest(token) : "";
};
function base32(bytes) {
  let bits = 0, value = 0, result = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}
function unbase32(secret) {
  let bits = 0, value = 0;
  const result = [];
  for (const character of secret.toUpperCase().replace(/=+$/, "")) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid authenticator secret");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      result.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(result);
}
// RFC 6238, SHA-1 / 6 digits / 30 seconds: compatible with common authenticators.
export function totpCode(secret, timestamp = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timestamp / 30000)));
  const hash = createHmac("sha1", unbase32(secret)).update(counter).digest();
  const offset = hash[hash.length - 1] & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, "0");
}
function secretKey(db) {
  const database = db.prepare("PRAGMA database_list").all().find((row) => row.name === "main")?.file;
  if (!database) return randomBytes(32);
  const file = path.join(path.dirname(database), "account-security.key");
  let key;
  try {
    key = readFileSync(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const existing = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='account_security'").get();
    if (existing && db.prepare("SELECT 1 FROM account_security WHERE secret<>'' OR pending<>'' LIMIT 1").get()) {
      throw new Error("Account security key is missing. Restore account-security.key from the database backup.");
    }
    try {
      writeFileSync(file, randomBytes(32), { mode: 0o600, flag: "wx" });
    } catch (writeError) {
      if (writeError.code !== "EEXIST") throw writeError;
    }
    key = readFileSync(file);
  }
  if (key.length !== 32) throw new Error("Account security key must contain exactly 32 bytes");
  return key;
}

export function registerAccounts(app, { db, auth, realtime, safeUser }) {
  const key = secretKey(db);
  const columns = new Set(db.prepare("PRAGMA table_info(sessions)").all().map((column) => column.name));
  if (!columns.has("created")) db.exec("ALTER TABLE sessions ADD COLUMN created INTEGER NOT NULL DEFAULT 0");
  if (!columns.has("user_agent")) db.exec("ALTER TABLE sessions ADD COLUMN user_agent TEXT NOT NULL DEFAULT ''");
  db.exec(`CREATE TABLE IF NOT EXISTS account_security(
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    secret TEXT NOT NULL DEFAULT '', pending TEXT NOT NULL DEFAULT '',
    pending_until INTEGER NOT NULL DEFAULT 0, last_step INTEGER NOT NULL DEFAULT -1,
    recovery TEXT NOT NULL DEFAULT '[]', enabled_at INTEGER NOT NULL DEFAULT 0
  )`);
  const fail = (res, status, error, extra = {}) => res.status(status).json({ error, ...extra });
  const seal = (secret) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64")).join(".");
  };
  const unseal = (sealed) => {
    const [iv, tag, encrypted] = sealed.split(".").map((part) => Buffer.from(part, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  };
  const record = (userId) => db.prepare("SELECT * FROM account_security WHERE user_id=?").get(userId);
  const ensure = (userId) => db.prepare("INSERT OR IGNORE INTO account_security(user_id) VALUES(?)").run(userId);
  const publicSessionId = (token) => createHmac("sha256", key).update("session:" + token).digest("hex");
  const refresh = () => realtime?.refreshAccess();
  const passwordMatches = (userId, password) => {
    if (typeof password !== "string" || password.length > 256 || !password) return false;
    const stored = db.prepare("SELECT password FROM users WHERE id=?").get(userId)?.password;
    const [salt, hash] = (stored || "").split(":");
    if (!salt || !hash || !/^[a-f0-9]{128}$/i.test(hash)) return false;
    return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(hash, "hex"));
  };
  const attempts = new Map();
  const sensitive = (req, res, next) => {
    const stamp = Date.now();
    let attempt = attempts.get(req.user.id);
    if (!attempt || stamp >= attempt.until) {
      attempt = { count: 0, until: stamp + 60000 };
      attempts.set(req.user.id, attempt);
    }
    if (++attempt.count > 20) return fail(res, 429, "Слишком много попыток. Повторите через минуту.");
    // Avoid accumulating records for inactive users indefinitely.
    if (attempts.size > 1000) for (const [id, value] of attempts) if (value.until < stamp) attempts.delete(id);
    next();
  };
  const requirePassword = (req, res, next) => passwordMatches(req.user.id, req.body?.currentPassword)
    ? next() : fail(res, 403, "Текущий пароль указан неверно");
  const matchTotp = (secret, code, lastStep = -1) => {
    if (typeof code !== "string" || !/^\d{6}$/.test(code.replace(/\s/g, ""))) return -1;
    const normalized = code.replace(/\s/g, "");
    const current = Math.floor(Date.now() / 30000);
    for (const step of [current, current - 1, current + 1]) {
      if (step <= lastStep || step < 0) continue;
      const expected = totpCode(secret, step * 30000);
      if (timingSafeEqual(Buffer.from(normalized), Buffer.from(expected))) return step;
    }
    return -1;
  };
  const consumeFactor = (userId, code) => {
    const security = record(userId);
    if (!security?.secret || typeof code !== "string" || code.length > 100) return false;
    const step = matchTotp(unseal(security.secret), code, security.last_step);
    if (step >= 0) {
      return db.prepare("UPDATE account_security SET last_step=? WHERE user_id=? AND last_step<?")
        .run(step, userId, step).changes === 1;
    }
    const normalized = code.toUpperCase().replace(/[\s-]/g, "");
    if (!/^[A-F0-9]{16}$/.test(normalized)) return false;
    const hashed = digest(normalized);
    const recovery = JSON.parse(security.recovery);
    const index = recovery.indexOf(hashed);
    if (index < 0) return false;
    recovery.splice(index, 1);
    return db.prepare("UPDATE account_security SET recovery=? WHERE user_id=? AND recovery=?")
      .run(JSON.stringify(recovery), userId, security.recovery).changes === 1;
  };
  const newRecovery = (userId) => {
    const codes = Array.from({ length: 10 }, () => randomBytes(8).toString("hex").toUpperCase());
    db.prepare("UPDATE account_security SET recovery=? WHERE user_id=?")
      .run(JSON.stringify(codes.map(digest)), userId);
    return codes.map((code) => code.match(/.{4}/g).join("-"));
  };

  app.patch("/api/account/profile", auth, (req, res) => {
    const name = req.body?.name;
    if (typeof name !== "string" || !name.trim() || name.trim().length > 100 || /[\u0000-\u001f\u007f]/.test(name)) {
      return fail(res, 400, "Укажите имя длиной от 1 до 100 символов");
    }
    db.prepare("UPDATE users SET name=? WHERE id=?").run(name.trim(), req.user.id);
    refresh();
    res.json({ user: safeUser(db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id)) });
  });
  app.post("/api/account/password", auth, sensitive, requirePassword, (req, res) => {
    const password = req.body?.newPassword;
    if (typeof password !== "string" || password.length < 10 || password.length > 256) {
      return fail(res, 400, "Новый пароль должен содержать от 10 до 256 символов");
    }
    if (password === req.body.currentPassword) return fail(res, 400, "Новый пароль должен отличаться от текущего");
    const salt = randomBytes(16).toString("hex");
    const stored = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
    db.exec("BEGIN IMMEDIATE");
    let revoked;
    try {
      db.prepare("UPDATE users SET password=? WHERE id=?").run(stored, req.user.id);
      revoked = db.prepare("DELETE FROM sessions WHERE user_id=? AND token<>?")
        .run(req.user.id, tokenHash(req)).changes;
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    refresh();
    res.json({ ok: true, revoked });
  });
  app.get("/api/account/sessions", auth, (req, res) => {
    const current = tokenHash(req);
    const sessions = db.prepare("SELECT token,expires,created,user_agent FROM sessions WHERE user_id=? AND expires>? ORDER BY created DESC")
      .all(req.user.id, Date.now()).map((session) => ({
        id: publicSessionId(session.token), current: session.token === current,
        created: session.created ? new Date(session.created).toISOString() : null,
        expires: new Date(session.expires).toISOString(),
        userAgent: String(session.user_agent || "").slice(0, 300),
      }));
    res.json({ sessions });
  });
  app.delete("/api/account/sessions/:id", auth, (req, res) => {
    if (!/^[a-f0-9]{64}$/.test(req.params.id)) return fail(res, 404, "Сеанс не найден");
    const sessions = db.prepare("SELECT token FROM sessions WHERE user_id=? AND expires>?").all(req.user.id, Date.now());
    const session = sessions.find((item) => publicSessionId(item.token) === req.params.id);
    if (!session) return fail(res, 404, "Сеанс не найден");
    if (session.token === tokenHash(req)) return fail(res, 409, "Для завершения текущего сеанса используйте «Выйти»");
    db.prepare("DELETE FROM sessions WHERE token=? AND user_id=?").run(session.token, req.user.id);
    refresh();
    res.json({ ok: true });
  });
  app.post("/api/account/logout-all", auth, (req, res) => {
    const revoked = db.prepare("DELETE FROM sessions WHERE user_id=?").run(req.user.id).changes;
    refresh();
    res.clearCookie("forma_session", { path: "/" }).json({ ok: true, revoked });
  });
  app.get("/api/account/security", auth, (req, res) => {
    const security = record(req.user.id);
    res.json({ twoFactorEnabled: !!security?.secret,
      enabledAt: security?.enabled_at ? new Date(security.enabled_at).toISOString() : null,
      recoveryCodesRemaining: security?.secret ? JSON.parse(security.recovery).length : 0 });
  });
  app.post("/api/account/2fa/setup", auth, sensitive, requirePassword, (req, res) => {
    if (record(req.user.id)?.secret) return fail(res, 409, "Двухфакторная защита уже включена");
    ensure(req.user.id);
    const secret = base32(randomBytes(20));
    const expires = Date.now() + 600000;
    db.prepare("UPDATE account_security SET pending=?,pending_until=? WHERE user_id=?")
      .run(seal(secret), expires, req.user.id);
    const label = encodeURIComponent("Forma:" + req.user.email);
    res.set("Cache-Control", "no-store").json({ secret, expires: new Date(expires).toISOString(),
      otpauthUri: `otpauth://totp/${label}?secret=${secret}&issuer=Forma&algorithm=SHA1&digits=6&period=30` });
  });
  app.post("/api/account/2fa/confirm", auth, sensitive, requirePassword, (req, res) => {
    const security = record(req.user.id);
    if (security?.secret) return fail(res, 409, "Двухфакторная защита уже включена");
    if (!security?.pending || security.pending_until < Date.now()) {
      return fail(res, 400, "Срок настройки истёк. Начните настройку заново.");
    }
    const step = matchTotp(unseal(security.pending), req.body?.code);
    if (step < 0) return fail(res, 400, "Неверный код приложения-аутентификатора");
    db.prepare("UPDATE account_security SET secret=pending,pending='',pending_until=0,last_step=?,enabled_at=? WHERE user_id=?")
      .run(step, Date.now(), req.user.id);
    const recoveryCodes = newRecovery(req.user.id);
    // Enabling a second factor also ends existing sessions on other devices.
    db.prepare("DELETE FROM sessions WHERE user_id=? AND token<>?").run(req.user.id, tokenHash(req));
    refresh();
    res.set("Cache-Control", "no-store").json({ ok: true, recoveryCodes });
  });
  app.post("/api/account/2fa/disable", auth, sensitive, requirePassword, (req, res) => {
    if (!record(req.user.id)?.secret) return fail(res, 409, "Двухфакторная защита не включена");
    if (!consumeFactor(req.user.id, req.body?.code)) return fail(res, 403, "Неверный или уже использованный код");
    db.prepare("UPDATE account_security SET secret='',pending='',pending_until=0,last_step=-1,recovery='[]',enabled_at=0 WHERE user_id=?")
      .run(req.user.id);
    refresh();
    res.json({ ok: true });
  });
  app.post("/api/account/2fa/recovery", auth, sensitive, requirePassword, (req, res) => {
    if (!record(req.user.id)?.secret) return fail(res, 409, "Сначала включите двухфакторную защиту");
    if (!consumeFactor(req.user.id, req.body?.code)) return fail(res, 403, "Неверный или уже использованный код");
    res.set("Cache-Control", "no-store").json({ recoveryCodes: newRecovery(req.user.id) });
  });
  return {
    verifyLogin(req, res, user) {
      if (!record(user.id)?.secret) return true;
      if (consumeFactor(user.id, req.body?.twoFactorCode)) return true;
      fail(res, 401, req.body?.twoFactorCode ? "Неверный или уже использованный код двухфакторной защиты" :
        "Введите код приложения-аутентификатора или резервный код", { requiresTwoFactor: true });
      return false;
    },
  };
}
