import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { createApp } from "../server/index.mjs";

const dir = mkdtempSync(path.join(tmpdir(), "forma-publications-"));
let db, server, base, alice, bob, outsider, bobId;
const document = (text = "Published original") => ({ pages: [
  { id: "private-page-id", canvas: { version: "6.7.1", background: "#2255aa", ownerEmail: "private@example.test",
    objects: [{ id: "private-object-id", type: "Textbox", text, left: 20, top: 20, width: 300, fontSize: 28, fill: "#fff" }] } },
  { id: "private-page-2", canvas: { background: "#cc5544", objects: [] } },
] });
async function request(endpoint, { cookie, body, method = "GET", headers = {} } = {}) {
  const response = await fetch(base + endpoint, { method, headers: {
    "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...headers,
  }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json(), headers: response.headers,
    cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
async function register(email) {
  return request("/auth/register", { method: "POST", body: { email, name: "Publication designer", password: "correct-horse-2026" } });
}
async function project(doc = document()) {
  const result = await request("/projects", { cookie: alice, method: "POST",
    body: { title: "Public design", kind: "presentation", width: 800, height: 600, document: doc } });
  assert.equal(result.status, 201);
  return result.data.project;
}
const publish = (projectId, body = {}, cookie = alice) => request(`/projects/${projectId}/publications`, { cookie, body, method: "POST" });

before(async () => {
  const created = createApp({ dataDir: dir }); db = created.db;
  server = created.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
  alice = (await register("publish-owner@example.test")).cookie;
  const member = await register("publish-member@example.test"); bob = member.cookie; bobId = member.data.user.id;
  outsider = (await register("publish-outsider@example.test")).cookie;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve)); db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("PUB-01 publication is explicit, owner-only and independent from shared viewer/editor roles", async () => {
  const p = await project();
  assert.deepEqual((await request(`/projects/${p.id}/publications`, { cookie: alice })).data.publications, []);
  assert.equal((await request(`/projects/${p.id}/members`, { cookie: alice, method: "POST",
    body: { email: "publish-member@example.test", role: "editor" } })).status, 200);
  assert.equal((await request(`/projects/${p.id}/publications`, { cookie: bob })).status, 403);
  assert.equal((await publish(p.id, {}, bob)).status, 403);
  assert.equal((await publish(p.id, {}, outsider)).status, 404);
  assert.equal((await request(`/projects/${p.id}/publications`, { method: "POST", body: {} })).status, 401);
  const blocked = await request(`/projects/${p.id}/publications`, { method: "POST", cookie: alice,
    headers: { Origin: "https://foreign.example" }, body: {} });
  assert.equal(blocked.status, 403);
  assert.equal((await request("/publications/guess")).status, 404);
  assert.ok(bobId);
});

test("PUB-02 guest sees an isolated snapshot and only explicitly updated immutable versions", async () => {
  const p = await project();
  const result = await publish(p.id, { expiresInDays: 7 });
  assert.equal(result.status, 201);
  const publication = result.data.publication;
  assert.match(publication.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(publication.url, `/?view=${publication.token}`);
  assert.equal(publication.sourceRevision, p.revision);
  const guest = await request(`/publications/${publication.token}`);
  assert.equal(guest.status, 200);
  assert.match(guest.headers.get("cache-control"), /no-store/);
  assert.match(guest.headers.get("x-robots-tag"), /noindex/);
  assert.equal(guest.data.publication.title, p.title);
  assert.equal(guest.data.publication.document.pages[0].canvas.objects[0].text, "Published original");
  assert.equal(guest.data.publication.document.pages[0].canvas.ownerEmail, undefined);
  assert.equal(guest.data.publication.owner_id, undefined);
  assert.equal(guest.data.publication.members, undefined);
  assert.equal(guest.data.publication.project_id, undefined);
  assert.equal(JSON.stringify(guest.data).includes("private@example.test"), false);
  assert.equal(JSON.stringify(guest.data).includes("private-page-id"), false);
  const edit = await request(`/projects/${p.id}`, { cookie: alice, method: "PUT",
    body: { revision: p.revision, title: "Private edited title", document: document("Private new text") } });
  assert.equal(edit.status, 200);
  assert.equal((await request(`/publications/${publication.token}`)).data.publication.title, "Public design");
  assert.equal((await request(`/publications/${publication.token}`)).data.publication.document.pages[0].canvas.objects[0].text, "Published original");
  const update = await request(`/projects/${p.id}/publications/${publication.token}`, {
    cookie: alice, method: "PUT", body: { expiresInDays: null },
  });
  assert.equal(update.status, 200); assert.equal(update.data.publication.version, 2);
  const latest = await request(`/publications/${publication.token}`);
  assert.equal(latest.data.publication.title, "Private edited title");
  assert.equal(latest.data.publication.document.pages[0].canvas.objects[0].text, "Private new text");
  assert.equal(latest.data.publication.expiresAt, null);
  const versions = db.prepare("SELECT * FROM publication_snapshots WHERE token=? ORDER BY version").all(publication.token);
  assert.equal(versions.length, 2);
  assert.equal(JSON.parse(versions[0].document).pages[0].canvas.objects[0].text, "Published original");
  assert.equal(versions[1].content_hash, createHash("sha256").update(versions[1].document).digest("hex"));
  assert.equal((await request(`/projects/${p.id}/publications`, { cookie: alice })).data.publications[0].version, 2);
});

test("PUB-03 expiry, revocation and ownership are enforced for every public request", async () => {
  const p = await project();
  for (const body of [{ expiresInDays: 0 }, { expiresInDays: 366 }, { expiresAt: "yesterday" }, { expiresAt: "2000-01-01T00:00:00Z" }])
    assert.equal((await publish(p.id, body)).status, 400);
  const token = (await publish(p.id, { expiresInDays: 1 })).data.publication.token;
  db.prepare("UPDATE publications SET expires=? WHERE token=?").run(Date.now() - 1, token);
  const expired = await request(`/publications/${token}`);
  assert.equal(expired.status, 410); assert.match(expired.data.error, /истёк/);
  assert.equal((await request(`/projects/${p.id}/publications/${token}`, { cookie: outsider, method: "DELETE" })).status, 404);
  assert.equal((await request(`/projects/${p.id}/publications/${token}`, { cookie: alice, method: "PUT", body: { expiresInDays: 7 } })).status, 200);
  assert.equal((await request(`/publications/${token}`)).status, 200);
  assert.equal((await request(`/projects/${p.id}/publications/${token}`, { cookie: alice, method: "DELETE" })).status, 200);
  assert.equal((await request(`/publications/${token}`)).status, 410);
  assert.equal((await request(`/projects/${p.id}/publications/${token}`, { cookie: alice, method: "PUT", body: {} })).status, 410);
  const replacement = (await publish(p.id)).data.publication.token;
  assert.notEqual(replacement, token); assert.equal((await request(`/publications/${replacement}`)).status, 200);
});

test("PUB-04 embedded raster images are verified and normalized without private asset requests", async () => {
  const image = await sharp({ create: { width: 16, height: 12, channels: 3, background: "#2b75aa" } }).webp().toBuffer();
  const d = document();
  d.pages[0].canvas.objects.push({ type: "Image", width: 16, height: 12, src: `data:image/webp;base64,${image.toString("base64")}` });
  const p = await project(d); const publication = await publish(p.id);
  assert.equal(publication.status, 201);
  const guest = await request(`/publications/${publication.data.publication.token}`);
  const src = guest.data.publication.document.pages[0].canvas.objects[1].src;
  assert.match(src, /^data:image\/png;base64,/);
  const meta = await sharp(Buffer.from(src.split(",")[1], "base64")).metadata();
  assert.equal(meta.width, 16); assert.equal(meta.height, 12); assert.equal(meta.format, "png");
});

test("PUB-05 malicious script, SVG, corrupt images and remote resources are rejected", async () => {
  const cases = [
    { type: "Textbox", text: "<script>alert(1)</script>" },
    { type: "Image", src: "https://evil.example/track.png" },
    { type: "Image", src: "/api/assets/another-users-asset/file" },
    { type: "Image", src: "data:image/svg+xml;base64,PHN2Zy8+" },
    { type: "Image", src: "data:image/png;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=" },
    { type: "Image", src: "data:image/png;base64,YmFk" },
    { type: "Group", objects: [{ type: "Image", src: "//evil.example/track.png" }] },
    { type: "Rect", fill: { type: "Pattern", source: "https://evil.example/pattern" } },
    { type: "Rect", fill: "url(https://evil.example/paint)" },
    { type: "Rect", custom: { script: "javascript:alert(1)" } },
  ];
  for (const object of cases) {
    const d = document(); d.pages[0].canvas.objects = [object];
    const p = await project(d); const result = await publish(p.id);
    assert.equal(result.status, 400, JSON.stringify(object));
    assert.equal(db.prepare("SELECT count(*) n FROM publications WHERE project_id=?").get(p.id).n, 0);
  }
});

test("PUB-06 trashed or permanently deleted projects stop public access and snapshots cascade", async () => {
  const p = await project(); const token = (await publish(p.id)).data.publication.token;
  assert.equal((await request(`/projects/${p.id}`, { cookie: alice, method: "PUT", body: { revision: p.revision, deleted: true } })).status, 200);
  assert.equal((await request(`/publications/${token}`)).status, 404);
  assert.equal((await publish(p.id)).status, 409);
  assert.equal((await request(`/projects/${p.id}`, { cookie: alice, method: "DELETE" })).status, 200);
  assert.equal((await request(`/publications/${token}`)).status, 404);
  assert.equal(db.prepare("SELECT count(*) n FROM publication_snapshots WHERE token=?").get(token).n, 0);
});

test("PUB-08 safe nested groups, clip paths, radial gradients and image filters survive publication", async () => {
  const d = document();
  d.pages[0].canvas.objects = [{ type: "Group", left: 40, top: 30, width: 300, height: 200,
    layoutManager: { type: "layoutManager", strategy: "fit-content" },
    clipPath: { type: "Circle", radius: 80 }, objects: [{ type: "Rect", width: 300, height: 200,
      fill: { type: "radial", gradientUnits: "percentage", coords: { x1: 0.5, y1: 0.5, r1: 0, x2: 0.5, y2: 0.5, r2: 0.5 },
        colorStops: [{ offset: 0, color: "#ffffff" }, { offset: 1, color: "#000000" }] },
    }] }];
  const p = await project(d); const published = await publish(p.id);
  assert.equal(published.status, 201);
  const result = (await request(`/publications/${published.data.publication.token}`)).data.publication.document.pages[0].canvas.objects[0];
  assert.equal(result.layoutManager.strategy, "fit-content");
  assert.equal(result.clipPath.type, "Circle");
  assert.equal(result.objects[0].fill.coords.r2, 0.5);
  assert.equal(result.objects[0].fill.colorStops.length, 2);
});

test('PUB-09 speaker notes and backing chart data stay private in public snapshots',async()=>{
 const d=document('Visible chart title');d.pages[0].notes='Private speaker instructions';d.pages[0].transition='fade';d.pages[0].canvas.objects[0].formaData={kind:'table',csv:'Private backing metadata'};const p=await project(d);const published=await publish(p.id);assert.equal(published.status,201);const guest=await request('/publications/'+published.data.publication.token);const serialized=JSON.stringify(guest.data);assert.equal(serialized.includes('Private speaker instructions'),false);assert.equal(serialized.includes('Private backing metadata'),false);assert.equal(guest.data.publication.document.pages[0].notes,undefined);assert.equal(guest.data.publication.document.pages[0].transition,undefined);assert.equal(guest.data.publication.document.pages[0].canvas.objects[0].text,'Visible chart title');
});
