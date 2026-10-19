import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import WebSocket from "ws";
import { createApp } from "../server/index.mjs";
import {
  normalize,
  readSnapshot,
  writeSnapshot,
} from "../shared/collaboration.mjs";
const seed = () => ({
  title: "Shared design",
  pages: [
    {
      id: "page-a",
      canvas: {
        objects: [
          {
            id: "object-a",
            type: "Rect",
            left: 10,
            top: 20,
            width: 100,
            height: 80,
            fill: "#7048ed",
          },
        ],
        background: "#fff",
      },
    },
  ],
});
const encode = (b) => Buffer.from(b).toString("base64");
const decode = (b) => new Uint8Array(Buffer.from(b, "base64"));
const fork = (doc) => {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  return copy;
};
test("CRDT: concurrent changes to different properties and inserted objects converge in either order", () => {
  const base = new Y.Doc();
  writeSnapshot(base, seed());
  const alice = fork(base),
    bob = fork(base);
  const before = readSnapshot(base);
  const nextA = structuredClone(before),
    nextB = structuredClone(before);
  nextA.pages[0].canvas.objects[0].left = 17.5;
  nextB.pages[0].canvas.objects[0].fill = "#ff0011";
  nextA.pages[0].canvas.objects.push({
    id: "alice-object",
    type: "Circle",
    radius: 30,
  });
  nextB.pages[0].canvas.objects.push({
    id: "bob-object",
    type: "Triangle",
    width: 50,
    height: 40,
  });
  writeSnapshot(alice, nextA, before);
  writeSnapshot(bob, nextB, before);
  const updateA = Y.encodeStateAsUpdate(alice),
    updateB = Y.encodeStateAsUpdate(bob);
  Y.applyUpdate(alice, updateB);
  Y.applyUpdate(bob, updateA);
  assert.deepEqual(readSnapshot(alice), readSnapshot(bob));
  const objects = readSnapshot(alice).pages[0].canvas.objects;
  assert.equal(objects.length, 3);
  assert.equal(objects[0].left, 17.5);
  assert.equal(objects[0].fill, "#ff0011");
  for (const d of [base, alice, bob]) d.destroy();
});
test("CRDT: local undo preserves another editor changes and unseen objects", () => {
  const base = new Y.Doc();
  writeSnapshot(base, seed());
  const doc = fork(base),
    remote = fork(base);
  const origin = {};
  const undo = new Y.UndoManager([doc.getMap("project"), doc.getMap("pages")], {
    trackedOrigins: new Set([origin]),
  });
  const before = readSnapshot(doc),
    next = structuredClone(before);
  next.pages[0].canvas.objects[0].left = 222;
  writeSnapshot(doc, next, before, origin);
  const theirs = readSnapshot(remote);
  theirs.pages[0].canvas.objects.push({
    id: "remote-object",
    type: "Circle",
    radius: 5,
  });
  writeSnapshot(remote, theirs, before);
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote), "remote");
  undo.undo();
  assert.equal(readSnapshot(doc).pages[0].canvas.objects[0].left, 10);
  assert.equal(readSnapshot(doc).pages[0].canvas.objects.length, 2);
  const localOldView = readSnapshot(base),
    localEdit = structuredClone(localOldView);
  localEdit.title = "New title";
  writeSnapshot(doc, localEdit, localOldView, origin);
  assert.equal(readSnapshot(doc).pages[0].canvas.objects.length, 2);
  undo.destroy();
  for (const d of [base, doc, remote]) d.destroy();
});
async function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "forma-live-"));
  const sockets = [];
  let runtime, server, base;
  async function start() {
    runtime = createApp({ dataDir: dir });
    server = runtime.app.listen(0, "127.0.0.1");
    runtime.realtime.attach(server);
    await new Promise((r) => server.once("listening", r));
    base = "http://127.0.0.1:" + server.address().port;
  }
  async function stop() {
    for (const ws of sockets) ws.terminate();
    runtime.realtime.close();
    await new Promise((r) => server.close(r));
    runtime.db.close();
  }
  await start();
  const req = async (url, cookie, body, method = body ? "POST" : "GET") => {
    const res = await fetch(base + "/api" + url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json();
    return { res, data, cookie: res.headers.get("set-cookie")?.split(";")[0] };
  };
  const register = async (email) => {
    const result = await req("/auth/register", null, {
      email,
      name: email.split("@")[0],
      password: "test-password-2026",
    });
    assert.equal(result.res.status, 200);
    return result.cookie;
  };
  const alice = await register("alice@example.test"),
    bob = await register("bob@example.test");
  const created = await req("/projects", alice, {
    title: seed().title,
    document: { pages: seed().pages },
  });
  assert.equal(created.res.status, 201);
  const id = created.data.project.id;
  function connect(cookie = alice, origin = base) {
    const ws = new WebSocket(
      base.replace("http", "ws") + "/api/projects/" + id + "/live",
      { headers: { ...(cookie ? { Cookie: cookie } : {}), Origin: origin } },
    );
    sockets.push(ws);
    const queue = [],
      waiters = [];
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      const i = waiters.findIndex((w) => w.type === m.type && w.match(m));
      if (i >= 0) {
        const w = waiters.splice(i, 1)[0];
        clearTimeout(w.timer);
        w.resolve(m);
      } else queue.push(m);
    });
    ws.on("error", () => {});
    return {
      ws,
      wait(type, match = () => true) {
        const i = queue.findIndex((m) => m.type === type && match(m));
        if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
        return new Promise((resolve, reject) => {
          const w = {
            type,
            match,
            resolve,
            timer: setTimeout(
              () => reject(new Error("Timeout waiting for " + type)),
              4000,
            ),
          };
          waiters.push(w);
        });
      },
    };
  }
  return {
    get base() {
      return base;
    },
    get runtime() {
      return runtime;
    },
    alice,
    bob,
    id,
    req,
    connect,
    async restart() {
      await stop();
      await start();
    },
    async close() {
      await stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
function clientDoc(hello) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, decode(hello.update));
  return doc;
}
function publish(channel, hello, doc, change, seq = 1) {
  const before = readSnapshot(doc),
    next = structuredClone(before),
    vector = Y.encodeStateVector(doc);
  change(next);
  writeSnapshot(doc, next, before);
  channel.ws.send(
    JSON.stringify({
      type: "update",
      epoch: hello.epoch,
      seq,
      update: encode(Y.encodeStateAsUpdate(doc, vector)),
    }),
  );
}
test("WebSocket: concurrent edits broadcast, persist and survive a new server instance", async () => {
  const f = await fixture();
  try {
    await f.req("/projects/" + f.id + "/members", f.alice, {
      email: "bob@example.test",
      role: "editor",
    });
    const a = f.connect(),
      b = f.connect(f.bob);
    const ha = await a.wait("hello"),
      hb = await b.wait("hello");
    const da = clientDoc(ha),
      db = clientDoc(hb);
    publish(a, ha, da, (s) => (s.pages[0].canvas.objects[0].left = 123.5));
    await a.wait("ack");
    await b.wait("update");
    publish(b, hb, db, (s) => (s.pages[0].canvas.objects[0].fill = "#00bb99"));
    await b.wait("ack");
    await a.wait("update");
    const result = await f.req("/projects/" + f.id, f.alice);
    assert.equal(
      result.data.project.document.pages[0].canvas.objects[0].left,
      123.5,
    );
    assert.equal(
      result.data.project.document.pages[0].canvas.objects[0].fill,
      "#00bb99",
    );
    const versions = await f.req("/projects/" + f.id + "/versions", f.alice);
    assert.equal(versions.data.versions.length, 1);
    await f.restart();
    const fresh = f.connect();
    const hello = await fresh.wait("hello");
    assert.equal(hello.epoch, ha.epoch);
    const snapshot = readSnapshot(clientDoc(hello));
    assert.equal(snapshot.pages[0].canvas.objects[0].left, 123.5);
    assert.equal(snapshot.pages[0].canvas.objects[0].fill, "#00bb99");
    da.destroy();
    db.destroy();
  } finally {
    await f.close();
  }
});
test("WebSocket: reject guests, outsiders, cross-origin connections, viewer writes and revoked sockets", async () => {
  const f = await fixture();
  try {
    for (const [cookie, origin, status] of [
      [undefined, f.base, 401],
      [f.bob, f.base, 404],
      [f.alice, "https://other.example", 403],
    ]) {
      const channel = f.connect(cookie === undefined ? "" : cookie, origin);
      const actual = await new Promise((resolve, reject) => {
        channel.ws.once("unexpected-response", (_, response) => {
          resolve(response.statusCode);
          response.destroy();
          channel.ws.terminate();
        });
        channel.ws.once("open", () =>
          reject(new Error("Unauthorized WebSocket opened")),
        );
      });
      assert.equal(actual, status);
    }
    await f.req("/projects/" + f.id + "/members", f.alice, {
      email: "bob@example.test",
      role: "viewer",
    });
    const owner = f.connect(),
      reader = f.connect(f.bob);
    const ho = await owner.wait("hello"),
      hr = await reader.wait("hello");
    assert.equal(hr.role, "viewer");
    const bad = clientDoc(hr);
    publish(reader, hr, bad, (s) => (s.title = "Unauthorized"));
    assert.match((await reader.wait("error")).error, /просмотр/);
    assert.equal(
      (await f.req("/projects/" + f.id, f.alice)).data.project.title,
      "Shared design",
    );
    const ownerDoc = clientDoc(ho);
    publish(owner, ho, ownerDoc, (s) => (s.title = "Allowed"));
    await owner.wait("ack");
    await reader.wait("update");
    const member = (await f.req("/projects/" + f.id + "/members", f.alice)).data
      .members[0];
    const closed = new Promise((r) =>
      reader.ws.once("close", (code) => r(code)),
    );
    await f.req(
      "/projects/" + f.id + "/members/" + member.id,
      f.alice,
      null,
      "DELETE",
    );
    assert.equal(await closed, 4003);
    await owner.wait("presence", (m) => m.peers.length === 1);
    const ownerClosed = new Promise((resolve) =>
      owner.ws.once("close", resolve),
    );
    await f.req("/auth/logout", f.alice, {});
    assert.equal(await ownerClosed, 4003);
    bad.destroy();
    ownerDoc.destroy();
  } finally {
    await f.close();
  }
});
test("WebSocket: malformed or invalid updates never poison the accepted document", async () => {
  const f = await fixture();
  try {
    const channel = f.connect();
    const hello = await channel.wait("hello");
    const doc = clientDoc(hello);
    publish(channel, hello, doc, (s) => (s.pages = []));
    await channel.wait("error");
    const result = await f.req("/projects/" + f.id, f.alice);
    assert.equal(result.data.project.document.pages.length, 1);
    const fresh = f.connect();
    const state = readSnapshot(clientDoc(await fresh.wait("hello")));
    assert.equal(state.pages.length, 1);
    doc.destroy();
  } finally {
    await f.close();
  }
});
test("WebSocket: legacy IDs and epoch survive an idle reconnect and metadata-only REST write", async () => {
  const f = await fixture();
  try {
    const document = { pages: seed().pages };
    delete document.pages[0].canvas.objects[0].id;
    const update = await f.req(
      "/projects/" + f.id,
      f.alice,
      { revision: 1, document },
      "PUT",
    );
    assert.equal(update.res.status, 200);
    const first = f.connect();
    const hello = await first.wait("hello");
    const initial = clientDoc(hello),
      objectId = readSnapshot(initial).pages[0].canvas.objects[0].id;
    assert.ok(objectId);
    const closed = new Promise((r) => first.ws.once("close", r));
    first.ws.close();
    await closed;
    const patch = await f.req(
      "/projects/" + f.id,
      f.alice,
      { revision: 2, favorite: true },
      "PUT",
    );
    assert.equal(patch.res.status, 200);
    const second = f.connect();
    const next = await second.wait("hello");
    assert.equal(next.epoch, hello.epoch);
    const doc = clientDoc(next);
    assert.equal(readSnapshot(doc).pages[0].canvas.objects[0].id, objectId);
    initial.destroy();
    doc.destroy();
  } finally {
    await f.close();
  }
});

test("Runtime: an occupied port exits with failure instead of reporting a successful startup", async () => {
  const f = await fixture(),
    dir = mkdtempSync(path.join(os.tmpdir(), "forma-startup-"));
  try {
    await assert.rejects(
      promisify(execFile)(process.execPath, ["server/index.mjs"], {
        cwd: process.cwd(),
        env: { ...process.env, PORT: new URL(f.base).port, DATA_DIR: dir },
        timeout: 5000,
      }),
      (error) =>
        error.code === 1 &&
        error.stderr.includes("EADDRINUSE") &&
        !error.stdout.includes("Forma listening"),
    );
  } finally {
    await f.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
