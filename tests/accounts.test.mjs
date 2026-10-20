import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, scryptSync } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/index.mjs";
import { totpCode } from "../server/accounts.mjs";

const password = "account-current-2026";
const updatedPassword = "account-updated-2026";
async function fixture(t, prepare) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "forma-account-"));
  if (prepare) prepare(directory);
  const { app, db, realtime } = createApp({ dataDir: directory });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  t.after(async () => {
    realtime.close(); server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close(); rmSync(directory, { recursive: true, force: true });
  });
  async function request(endpoint, { method = "GET", cookie, body, userAgent } = {}) {
    const response = await fetch(base + endpoint, {
      method,
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}),
        ...(userAgent ? { "User-Agent": userAgent } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0], headers: response.headers };
  }
  async function register(email = "account-owner@example.test") {
    const result = await request("/auth/register", { method: "POST", body: { name: "Account Owner", email, password },
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0" });
    assert.equal(result.status, 200);
    return { cookie: result.cookie, user: result.data.user, email };
  }
  async function login(account, twoFactorCode, candidatePassword = password) {
    return request("/auth/login", { method: "POST", body: { email: account.email, password: candidatePassword, twoFactorCode },
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18) Safari/604.1" });
  }
  async function activate(account, previousStep = false) {
    const setup = await request("/account/2fa/setup", { method: "POST", cookie: account.cookie, body: { currentPassword: password } });
    assert.equal(setup.status, 200);
    // A previous accepted step can leave a distinct fresh code available for login.
    const confirmed = await request("/account/2fa/confirm", { method: "POST", cookie: account.cookie,
      body: { currentPassword: password, code: totpCode(setup.data.secret, Date.now() - (previousStep ? 30000 : 0)) } });
    assert.equal(confirmed.status, 200);
    return { secret: setup.data.secret, codes: confirmed.data.recoveryCodes };
  }
  return { request, register, login, activate, db, realtime, directory };
}

test("accounts: profile name persists and rejects empty/control/oversized/non-string input", async (t) => {
  const { request, register } = await fixture(t);
  assert.equal((await request("/account/profile", { method: "PATCH", body: { name: "No" } })).status, 401);
  const alice = await register();
  for (const name of ["", "   ", null, 12, "x".repeat(101), "Bad\u0000Name", "New\nline"]) {
    assert.equal((await request("/account/profile", { method: "PATCH", cookie: alice.cookie, body: { name } })).status, 400);
  }
  const saved = await request("/account/profile", { method: "PATCH", cookie: alice.cookie, body: { name: "  Анна Дизайнер  ", email: "changed@example.test" } });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.user.name, "Анна Дизайнер");
  assert.equal(saved.data.user.email, alice.email);
  assert.equal(saved.data.user.password, undefined);
  assert.equal((await request("/auth/me", { cookie: alice.cookie })).data.user.name, "Анна Дизайнер");
});

test("accounts: session IDs cannot authenticate or reveal stored token hashes; current/expired sessions annotated", async (t) => {
  const { request, register, login, db } = await fixture(t);
  const alice = await register();
  const mobile = await login(alice);
  assert.equal(mobile.status, 200);
  db.prepare("INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)").run("expired-token", alice.user.id, Date.now() - 1);
  const listed = await request("/account/sessions", { cookie: alice.cookie });
  assert.equal(listed.status, 200);
  assert.equal(listed.data.sessions.length, 2);
  assert.equal(listed.data.sessions.filter((session) => session.current).length, 1);
  const current = listed.data.sessions.find((session) => session.current);
  assert.ok(current.created);
  assert.match(current.userAgent, /Chrome/);
  assert.match(current.id, /^[a-f0-9]{64}$/);
  const stored = createHash("sha256").update(alice.cookie.slice(14)).digest("hex");
  assert.notEqual(current.id, stored);
  assert.equal(JSON.stringify(listed.data).includes(stored), false);
  assert.equal((await request("/auth/me", { cookie: "forma_session=" + current.id })).status, 401);
  assert.equal((await request("/account/sessions/" + current.id, { method: "DELETE", cookie: alice.cookie })).status, 409);
});

test("accounts: individual revocation is owner-scoped and immediately invalidates the selected session", async (t) => {
  const { request, register, login, realtime } = await fixture(t);
  const alice = await register();
  const bob = await register("account-other@example.test");
  const mobile = await login(alice);
  let refreshes = 0;
  const refresh = realtime.refreshAccess;
  realtime.refreshAccess = (...args) => { refreshes++; return refresh(...args); };
  const sessions = (await request("/account/sessions", { cookie: alice.cookie })).data.sessions;
  const mobileId = sessions.find((session) => !session.current).id;
  assert.equal((await request("/account/sessions/" + mobileId, { method: "DELETE", cookie: bob.cookie })).status, 404);
  assert.equal((await request("/auth/me", { cookie: mobile.cookie })).status, 200);
  assert.equal((await request("/account/sessions/" + mobileId, { method: "DELETE", cookie: alice.cookie })).status, 200);
  assert.equal((await request("/auth/me", { cookie: mobile.cookie })).status, 401);
  assert.equal((await request("/auth/me", { cookie: bob.cookie })).status, 200);
  assert.equal((await request("/auth/me", { cookie: alice.cookie })).status, 200);
  assert.equal((await request("/account/sessions/" + mobileId, { method: "DELETE", cookie: alice.cookie })).status, 404);
  assert.equal(refreshes, 1);
});

test("accounts: password requires valid current password, changes scrypt hash, preserves current and other users", async (t) => {
  const { request, register, login, db } = await fixture(t);
  const alice = await register();
  const bob = await register("account-bob@example.test");
  const mobile = await login(alice);
  const before = db.prepare("SELECT password FROM users WHERE id=?").get(alice.user.id).password;
  const change = (currentPassword, newPassword) => request("/account/password", { method: "POST", cookie: alice.cookie, body: { currentPassword, newPassword } });
  assert.equal((await change("wrong-current", updatedPassword)).status, 403);
  for (const candidate of ["short", "a".repeat(257), null, 99, password]) {
    assert.equal((await change(password, candidate)).status, 400);
  }
  assert.equal((await request("/auth/me", { cookie: mobile.cookie })).status, 200);
  const changed = await change(password, updatedPassword);
  assert.equal(changed.status, 200);
  assert.equal(changed.data.revoked, 1);
  const after = db.prepare("SELECT password FROM users WHERE id=?").get(alice.user.id).password;
  assert.match(after, /^[a-f0-9]{32}:[a-f0-9]{128}$/);
  assert.notEqual(after, before);
  assert.equal((await request("/auth/me", { cookie: mobile.cookie })).status, 401);
  assert.equal((await request("/auth/me", { cookie: alice.cookie })).status, 200);
  assert.equal((await request("/auth/me", { cookie: bob.cookie })).status, 200);
  assert.equal((await login(alice)).status, 401);
  assert.equal((await login(alice, undefined, updatedPassword)).status, 200);
});

test("accounts: logout-all clears cookie and all own sessions without affecting another user", async (t) => {
  const { request, register, login } = await fixture(t);
  const alice = await register();
  const bob = await register("account-survivor@example.test");
  const mobile = await login(alice);
  const result = await request("/account/logout-all", { method: "POST", cookie: alice.cookie, body: {} });
  assert.equal(result.status, 200);
  assert.equal(result.data.revoked, 2);
  assert.equal(result.cookie, "forma_session=");
  assert.equal((await request("/auth/me", { cookie: alice.cookie })).status, 401);
  assert.equal((await request("/auth/me", { cookie: mobile.cookie })).status, 401);
  assert.equal((await request("/auth/me", { cookie: bob.cookie })).status, 200);
});

test("accounts: TOTP matches independent RFC 6238 SHA-1 reference vectors", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  for (const [seconds, expected] of [[59, "287082"], [1111111109, "081804"], [1111111111, "050471"],
    [1234567890, "005924"], [2000000000, "279037"], [20000000000, "353130"]]) {
    assert.equal(totpCode(secret, seconds * 1000), expected);
  }
});

test("accounts: TOTP enrollment validates password/code, expires, encrypts secrets and revokes other sessions", async (t) => {
  const { request, register, login, db, directory } = await fixture(t);
  const alice = await register();
  const mobile = await login(alice);
  const post = (route, body) => request("/account/2fa/" + route, { method: "POST", cookie: alice.cookie, body });
  assert.equal((await post("setup", { currentPassword: "wrong" })).status, 403);
  let setup = await post("setup", { currentPassword: password });
  assert.equal(setup.status, 200);
  assert.match(setup.data.secret, /^[A-Z2-7]{32}$/);
  assert.match(setup.data.otpauthUri, /^otpauth:\/\/totp\/Forma/);
  assert.equal(setup.headers.get("cache-control"), "no-store");
  assert.equal(statSync(path.join(directory, "account-security.key")).mode & 0o777, 0o600);
  const pending = db.prepare("SELECT * FROM account_security WHERE user_id=?").get(alice.user.id);
  assert.equal(JSON.stringify(pending).includes(setup.data.secret), false);
  assert.equal((await request("/account/security", { cookie: alice.cookie })).data.twoFactorEnabled, false);
  assert.equal((await post("confirm", { currentPassword: password, code: "not-a-code" })).status, 400);
  db.prepare("UPDATE account_security SET pending_until=? WHERE user_id=?").run(Date.now() - 1, alice.user.id);
  assert.equal((await post("confirm", { currentPassword: password, code: totpCode(setup.data.secret) })).status, 400);
  setup = await post("setup", { currentPassword: password });
  const result = await post("confirm", { currentPassword: password, code: totpCode(setup.data.secret) });
  assert.equal(result.status, 200);
  assert.equal(result.data.recoveryCodes.length, 10);
  assert.equal(new Set(result.data.recoveryCodes).size, 10);
  assert.equal((await request("/auth/me", { cookie: mobile.cookie })).status, 401);
  const security = (await request("/account/security", { cookie: alice.cookie })).data;
  assert.equal(security.twoFactorEnabled, true);
  assert.equal(security.recoveryCodesRemaining, 10);
  assert.equal(security.secret, undefined);
  const saved = db.prepare("SELECT * FROM account_security WHERE user_id=?").get(alice.user.id);
  assert.equal(JSON.stringify(saved).includes(setup.data.secret), false);
  assert.equal(JSON.stringify(saved).includes(result.data.recoveryCodes[0].replaceAll("-", "")), false);
  assert.equal((await post("setup", { currentPassword: password })).status, 409);
});

test("accounts: enabled TOTP blocks password-only and invalid-factor login, accepts fresh codes and rejects replay", async (t) => {
  // Freeze the OTP clock so a real 30-second boundary cannot make this test flaky.
  const stamp = Math.floor(Date.now() / 30000) * 30000 + 15000;
  t.mock.method(Date, "now", () => stamp);
  const { request, register, login, activate } = await fixture(t);
  const alice = await register();
  const { secret } = await activate(alice, true);
  const missing = await login(alice);
  assert.equal(missing.status, 401);
  assert.equal(missing.data.requiresTwoFactor, true);
  assert.equal(missing.cookie, undefined);
  assert.equal((await login(alice, "invalid")).status, 401);
  const code = totpCode(secret);
  const valid = await login(alice, code);
  assert.equal(valid.status, 200);
  assert.equal((await request("/auth/me", { cookie: valid.cookie })).status, 200);
  assert.equal((await login(alice, code)).status, 401);
});

test("accounts: recovery codes work once; rotation invalidates old codes and disabling requires password + factor", async (t) => {
  const { request, register, login, activate } = await fixture(t);
  const alice = await register();
  const { codes } = await activate(alice);
  assert.equal((await login(alice, codes[0].toLowerCase())).status, 200);
  assert.equal((await login(alice, codes[0])).status, 401);
  assert.equal((await request("/account/security", { cookie: alice.cookie })).data.recoveryCodesRemaining, 9);
  const post = (route, currentPassword, code) => request("/account/2fa/" + route, { method: "POST", cookie: alice.cookie, body: { currentPassword, code } });
  assert.equal((await post("disable", "wrong", codes[1])).status, 403);
  assert.equal((await post("disable", password, "invalid")).status, 403);
  const rotated = await post("recovery", password, codes[1]);
  assert.equal(rotated.status, 200);
  assert.equal(rotated.data.recoveryCodes.length, 10);
  assert.equal((await login(alice, codes[2])).status, 401);
  assert.equal((await login(alice, rotated.data.recoveryCodes[0])).status, 200);
  assert.equal((await post("disable", password, rotated.data.recoveryCodes[1])).status, 200);
  assert.equal((await request("/account/security", { cookie: alice.cookie })).data.twoFactorEnabled, false);
  assert.equal((await login(alice)).status, 200);
});

test("accounts: all security endpoints require authentication", async (t) => {
  const { request } = await fixture(t);
  for (const [method, route] of [["GET", "sessions"], ["GET", "security"], ["POST", "password"],
    ["POST", "logout-all"], ["POST", "2fa/setup"], ["POST", "2fa/confirm"], ["POST", "2fa/disable"],
    ["POST", "2fa/recovery"], ["DELETE", "sessions/" + "0".repeat(64)]]) {
    assert.equal((await request("/account/" + route, { method, ...(method === "GET" ? {} : { body: {} }) })).status, 401);
  }
});

test("accounts: additive migration preserves legacy users and existing three-column sessions", async (t) => {
  const bearer = "legacy-session-token";
  const { request, login, db } = await fixture(t, (directory) => {
    const legacy = new DatabaseSync(path.join(directory, "forma.sqlite"));
    legacy.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,brand TEXT NOT NULL DEFAULT '{}',created TEXT NOT NULL);
      CREATE TABLE sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires INTEGER NOT NULL);`);
    const salt = "a".repeat(32);
    legacy.prepare("INSERT INTO users(id,email,name,password,created) VALUES(?,?,?,?,?)")
      .run("legacy-user", "legacy@example.test", "Original Name", `${salt}:${scryptSync(password, salt, 64).toString("hex")}`, new Date().toISOString());
    legacy.prepare("INSERT INTO sessions VALUES(?,?,?)")
      .run(createHash("sha256").update(bearer).digest("hex"), "legacy-user", Date.now() + 3600000);
    legacy.close();
  });
  const cookie = "forma_session=" + bearer;
  assert.equal((await request("/auth/me", { cookie })).data.user.name, "Original Name");
  const listed = await request("/account/sessions", { cookie });
  assert.equal(listed.data.sessions.length, 1);
  assert.equal(listed.data.sessions[0].current, true);
  assert.equal(listed.data.sessions[0].created, null);
  assert.equal((await login({ email: "legacy@example.test" })).status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM users").get().count, 1);
  assert.equal((await request("/account/sessions", { cookie })).data.sessions.length, 2);
});

test("accounts: encrypted authenticator state and unused recovery codes survive app restart", async (t) => {
  const { register, activate, directory } = await fixture(t);
  const alice = await register();
  const factor = await activate(alice);
  const second = createApp({ dataDir: directory });
  const server = second.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    second.realtime.close(); server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve)); second.db.close();
  });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`, { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: alice.email, password, twoFactorCode: factor.codes[0] }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.id, alice.user.id);
  const record = second.db.prepare("SELECT recovery FROM account_security WHERE user_id=?").get(alice.user.id);
  assert.equal(JSON.parse(record.recovery).length, 9);
});
