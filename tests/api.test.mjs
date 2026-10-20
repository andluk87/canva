import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createApp } from "../server/index.mjs";
const dir = mkdtempSync(path.join(os.tmpdir(), "forma-test-"));
let app, db, server, base, alice, bob, outsider, pid;
async function request(
  endpoint,
  { cookie, body, method = "GET", headers = {} } = {},
) {
  const response = await fetch(base + endpoint, {
    method,
    headers: {
      ...(body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    ...(body
      ? { body: body instanceof FormData ? body : JSON.stringify(body) }
      : {}),
  });
  return {
    status: response.status,
    data: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}
async function register(email) {
  const r = await request("/auth/register", {
    method: "POST",
    body: { name: email.split("@")[0], email, password: "correct-horse-2026" },
  });
  assert.equal(r.status, 200);
  assert.ok(r.cookie.includes("forma_session="));
  assert.ok(r.data.user.id);
  assert.equal(r.data.user.password, undefined);
  return r.cookie;
}
before(async () => {
  ({ app, db } = createApp({ dataDir: dir }));
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  alice = await register("alice@example.com");
  bob = await register("bob@example.com");
  outsider = await register("outsider@example.com");
});
after(async () => {
  await new Promise((r) => server.close(r));
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
test("AT-01 authentication: registration, login, validation, private session, logout", async () => {
  assert.equal((await request("/auth/me")).status, 401);
  assert.equal(
    (
      await request("/auth/register", {
        method: "POST",
        body: { name: "x", email: "bad", password: "123" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/auth/login", {
        method: "POST",
        body: { email: "alice@example.com", password: "wrong" },
      })
    ).status,
    401,
  );
  const login = await request("/auth/login", {
    method: "POST",
    body: { email: "alice@example.com", password: "correct-horse-2026" },
  });
  assert.equal(login.status, 200);
  assert.equal(
    (await request("/auth/me", { cookie: login.cookie })).data.user.email,
    "alice@example.com",
  );
  assert.equal(
    (
      await request("/auth/logout", {
        cookie: login.cookie,
        method: "POST",
        body: {},
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("/auth/me", { cookie: login.cookie })).status,
    401,
  );
  assert.equal(
    (
      await request("/auth/register", {
        method: "POST",
        body: {
          name: "duplicate",
          email: "alice@example.com",
          password: "correct-horse-2026",
        },
      })
    ).status,
    409,
  );
});
test("AT-02/06/11/19 create, preserve pages, revisions and recover prior document", async () => {
  const r = await request("/projects", {
    cookie: alice,
    method: "POST",
    body: { title: "First design", width: 1080, height: 1080 },
  });
  assert.equal(r.status, 201);
  pid = r.data.project.id;
  assert.equal(r.data.project.document.pages.length, 1);
  const document = {
    pages: [
      {
        id: "page-1",
        canvas: {
          objects: [
            {
              type: "Textbox",
              text: "Точный текст",
              left: 12.5,
              top: 44.25,
              angle: 17,
            },
          ],
          background: "#fff",
        },
      },
      { id: "page-2", canvas: { objects: [], background: "#f00" } },
    ],
  };
  const save = await request("/projects/" + pid, {
    cookie: alice,
    method: "PUT",
    body: { revision: 1, title: "Saved design", document },
  });
  assert.equal(save.status, 200);
  assert.equal(save.data.revision, 2);
  const get = await request("/projects/" + pid, { cookie: alice });
  assert.deepEqual(get.data.project.document, document);
  assert.equal(get.data.project.title, "Saved design");
  const stale = await request("/projects/" + pid, {
    cookie: alice,
    method: "PUT",
    body: { revision: 1, title: "stale write" },
  });
  assert.equal(stale.status, 409);
  const versions = await request("/projects/" + pid + "/versions", {
    cookie: alice,
  });
  assert.equal(versions.data.versions.length, 1);
  const prior = await request(
    "/projects/" + pid + "/versions/" + versions.data.versions[0].id,
    { cookie: alice },
  );
  assert.equal(prior.data.document.pages.length, 1);
  assert.equal(prior.data.title, "First design");
  assert.equal(
    (
      await request("/projects", {
        cookie: alice,
        method: "POST",
        body: { title: "bad", width: 99999 },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/projects/" + pid, {
        cookie: alice,
        method: "PUT",
        body: { revision: 2, document: { pages: [] } },
      })
    ).status,
    400,
  );
});
test("AT-13/24 server enforces owner/editor/viewer and revocation", async () => {
  assert.equal(
    (await request("/projects/" + pid, { cookie: outsider })).status,
    404,
  );
  assert.equal(
    (await request("/projects", { cookie: outsider })).data.projects.length,
    0,
  );
  assert.equal(
    (
      await request("/projects/" + pid + "/members", {
        cookie: alice,
        method: "POST",
        body: { email: "bob@example.com", role: "viewer" },
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("/projects/" + pid, { cookie: bob })).data.project.role,
    "viewer",
  );
  assert.equal(
    (
      await request("/projects/" + pid, {
        cookie: bob,
        method: "PUT",
        body: { revision: 2, title: "no" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await request("/projects/" + pid, { cookie: bob, method: "DELETE" }))
      .status,
    403,
  );
  assert.equal(
    (
      await request("/projects/" + pid + "/members", {
        cookie: bob,
        method: "POST",
        body: { email: "outsider@example.com", role: "editor" },
      })
    ).status,
    403,
  );
  await request("/projects/" + pid + "/members", {
    cookie: alice,
    method: "POST",
    body: { email: "bob@example.com", role: "editor" },
  });
  assert.equal(
    (
      await request("/projects/" + pid, {
        cookie: bob,
        method: "PUT",
        body: { revision: 2, title: "Edited by Bob" },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("/projects/" + pid, {
        cookie: bob,
        method: "PUT",
        body: { revision: 3, deleted: true },
      })
    ).status,
    403,
  );
  const members = await request("/projects/" + pid + "/members", {
    cookie: alice,
  });
  await request("/projects/" + pid + "/members/" + members.data.members[0].id, {
    cookie: alice,
    method: "DELETE",
  });
  assert.equal(
    (await request("/projects/" + pid, { cookie: bob })).status,
    404,
  );
});
test("AT-04 image upload: conversion, ownership and malformed images", async () => {
  const img = await sharp({
    create: { width: 20, height: 10, channels: 3, background: "#7048ed" },
  })
    .png()
    .toBuffer();
  const form = new FormData();
  form.append("file", new Blob([img], { type: "image/png" }), "test.png");
  const r = await request("/assets", {
    cookie: alice,
    method: "POST",
    body: form,
  });
  assert.equal(r.status, 201);
  const image = await fetch(base.replace("/api", "") + r.data.asset.url, {
    headers: { Cookie: alice },
  });
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  const metadata = await sharp(
    Buffer.from(await image.arrayBuffer()),
  ).metadata();
  assert.equal(metadata.width, 20);
  assert.equal(
    (
      await fetch(base.replace("/api", "") + r.data.asset.url, {
        headers: { Cookie: bob },
      })
    ).status,
    404,
  );
  const bad = new FormData();
  bad.append("file", new Blob(["<script>alert(1)</script>"]), "bad.png");
  assert.equal(
    (await request("/assets", { cookie: alice, method: "POST", body: bad }))
      .status,
    400,
  );
});
test("brand, comments, favorites, folders, trash, restore and permanent deletion", async () => {
  assert.equal(
    (
      await request("/brand", {
        cookie: alice,
        method: "PUT",
        body: {
          name: "Studio",
          colors: ["#7048ed", "#ffffff"],
          font: "Georgia",
        },
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("/auth/me", { cookie: alice })).data.user.brand.font,
    "Georgia",
  );
  assert.equal(
    (
      await request("/brand", {
        cookie: alice,
        method: "PUT",
        body: { name: "X", colors: ["bad"], font: "Arial" },
      })
    ).status,
    400,
  );
  const endpoint = "/projects/" + pid;
  await request(endpoint + "/comments", {
    cookie: alice,
    method: "POST",
    body: { body: "Комментарий сохранён" },
  });
  assert.equal(
    (await request(endpoint + "/comments", { cookie: alice })).data.comments[0]
      .body,
    "Комментарий сохранён",
  );
  assert.equal(
    (
      await request(endpoint, {
        cookie: alice,
        method: "PUT",
        body: { revision: 3, favorite: true, folder: "Клиент", deleted: true },
      })
    ).status,
    200,
  );
  let p = (await request(endpoint, { cookie: alice })).data.project;
  assert.equal(p.favorite, 1);
  assert.equal(p.folder, "Клиент");
  assert.equal(p.deleted, 1);
  await request(endpoint, {
    cookie: alice,
    method: "PUT",
    body: { revision: 4, deleted: false },
  });
  assert.equal(
    (await request(endpoint, { cookie: alice })).data.project.deleted,
    0,
  );
  assert.equal(
    (await request(endpoint, { cookie: alice, method: "DELETE" })).status,
    200,
  );
  assert.equal((await request(endpoint, { cookie: alice })).status, 404);
});
test("reject cross-origin mutations", async () => {
  assert.equal(
    (
      await request("/auth/login", {
        method: "POST",
        headers: { Origin: "https://evil.example" },
        body: { email: "alice@example.com", password: "correct-horse-2026" },
      })
    ).status,
    403,
  );
});

test('AT-16 slide notes and transitions persist while invalid metadata is rejected',async()=>{
 const document={pages:[{id:'slide-meta',notes:'Private notes\nSecond line',transition:'fade',canvas:{objects:[],background:'#ffffff'}}]};const made=await request('/projects',{cookie:alice,method:'POST',body:{title:'Slide metadata',width:1280,height:720,document}});assert.equal(made.status,201);const id=made.data.project.id;assert.deepEqual((await request('/projects/'+id,{cookie:alice})).data.project.document,document);
 for(const patch of [{notes:'x'.repeat(10001)},{notes:45},{transition:'arbitrary-animation'},{transition:{type:'fade'}}]){const bad=structuredClone(document);Object.assign(bad.pages[0],patch);assert.equal((await request('/projects/'+id,{cookie:alice,method:'PUT',body:{revision:1,document:bad}})).status,400);}assert.equal((await request('/projects/'+id,{cookie:alice})).data.project.revision,1);
});
