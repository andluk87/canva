import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../server/index.mjs";
import { PERSONAL_TEMPLATE_LIMITS } from "../server/personal-templates.mjs";

const directory = mkdtempSync(path.join(tmpdir(), "forma-personal-templates-"));
let db, realtime, server, base, owner, editor, viewer, outsider;
const document = (text = "Исходная надпись") => ({ pages: [
  { id: "template-page-1", canvas: { version: "6.7.1", background: "#f0eaff", objects: [
    { id: "template-text", type: "Textbox", text, left: 20, top: 30, width: 500, fontSize: 40, fill: "#7048ed" },
    { id: "template-group", type: "Group", objects: [{ type: "Rect", width: 20, height: 30 }, { type: "Textbox", text: "Группа" }] },
  ] } },
  { id: "template-page-2", canvas: { background: "#f5e2aa", objects: [] } },
], projectCustomSetting: { preserve: true } });
async function request(route, { cookie = owner?.cookie, method = "GET", body } = {}) {
  const response = await fetch(base + route, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, data: await response.json(), headers: response.headers,
    cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
async function register(name) {
  const response = await request("/auth/register", { cookie: null, method: "POST", body: {
    name, email: `personal-template-${name}@example.test`, password: "personal-template-password-2026",
  } });
  assert.equal(response.status, 200);
  return { cookie: response.cookie, ...response.data.user };
}
async function project({ cookie = owner.cookie, title = "Исходный дизайн", doc = document(), width = 800, height = 600 } = {}) {
  const response = await request("/projects", { cookie, method: "POST", body: { title, kind: "presentation", width, height, document: doc } });
  assert.equal(response.status, 201);
  return response.data.project;
}
async function save(source, { cookie = owner.cookie, title = "Мой шаблон", category = "Встречи" } = {}) {
  return request("/personal-templates", { cookie, method: "POST", body: { projectId: source.id, title, category } });
}
const instantiate = (id, options = {}) => request(`/personal-templates/${id}/instantiate`, { method: "POST", body: {}, ...options });
const templateCount = () => db.prepare("SELECT COUNT(*) AS n FROM personal_templates").get().n;
const projectCount = () => db.prepare("SELECT COUNT(*) AS n FROM projects").get().n;
before(async () => {
  const application = createApp({ dataDir: directory }); db = application.db; realtime = application.realtime;
  server = application.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
  owner = await register("owner"); editor = await register("editor"); viewer = await register("viewer"); outsider = await register("outsider");
});
after(async () => {
  realtime.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
  db.close(); rmSync(directory, { recursive: true, force: true });
});

test("personal templates: save full private snapshot and instantiate independent projects without source metadata", async () => {
  const original = await project();
  await request(`/projects/${original.id}/members`, { method: "POST", body: { email: editor.email, role: "editor" } });
  await request(`/projects/${original.id}/comments`, { method: "POST", body: { body: "Private source comment" } });
  const saved = await save(original);
  assert.equal(saved.status, 201);
  const template = saved.data.template;
  assert.equal(template.title, "Мой шаблон");
  assert.equal(template.pageCount, 2);
  assert.equal(template.revision, 1);
  assert.equal(template.document, undefined);
  assert.equal(template.owner_id, undefined);
  assert.equal(template.projectId, undefined);
  assert.equal(template.source_id, undefined);
  assert.equal(template.width, original.width);
  assert.equal(template.height, original.height);
  assert.equal(template.kind, original.kind);
  const changedSource = await request(`/projects/${original.id}`, { method: "PUT", body: { revision: original.revision, title: "Изменённый исходник", document: document("Изменённый текст") } });
  assert.equal(changedSource.status, 200);
  const copied = await instantiate(template.id, { body: { title: "Проект из библиотеки", owner_id: outsider.id, deleted: true, favorite: 1, folder: "ignored" } });
  assert.equal(copied.status, 201);
  const first = copied.data.project;
  assert.notEqual(first.id, original.id);
  assert.equal(first.title, "Проект из библиотеки");
  assert.equal(first.owner_id, owner.id);
  assert.equal(first.role, "owner");
  assert.equal(first.revision, 1);
  assert.equal(first.deleted, 0);
  assert.equal(first.favorite, 0);
  assert.equal(first.folder, "");
  assert.deepEqual(first.document, original.document);
  assert.deepEqual((await request(`/projects/${first.id}/members`)).data.members, []);
  assert.deepEqual((await request(`/projects/${first.id}/comments`)).data.comments, []);
  assert.deepEqual((await request(`/projects/${first.id}/versions`)).data.versions, []);
  assert.equal((await request(`/projects/${first.id}`, { cookie: editor.cookie })).status, 404);
  assert.equal((await request(`/projects/${first.id}`, { method: "PUT", body: { revision: first.revision, document: document("Независимый текст") } })).status, 200);
  const second = (await instantiate(template.id)).data.project;
  assert.notEqual(second.id, first.id);
  assert.deepEqual(second.document, original.document);
  assert.equal((await request(`/projects/${original.id}`)).data.project.document.pages[0].canvas.objects[0].text, "Изменённый текст");
});

test("personal templates: every route enforces authentication and template ownership", async () => {
  const original = await project();
  const template = (await save(original)).data.template;
  for (const [method, suffix, body] of [["GET", "", undefined], ["POST", "", { projectId: original.id, title: "No" }],
    ["PATCH", "/" + template.id, { revision: 1, title: "No" }], ["DELETE", "/" + template.id, {}],
    ["POST", "/" + template.id + "/instantiate", {}]]) {
    assert.equal((await request("/personal-templates" + suffix, { cookie: null, method, body })).status, 401);
  }
  assert.deepEqual((await request("/personal-templates", { cookie: outsider.cookie })).data.templates, []);
  for (const cookie of [editor.cookie, viewer.cookie, outsider.cookie]) {
    assert.equal((await request(`/personal-templates/${template.id}`, { cookie, method: "PATCH", body: { revision: 1, title: "Takeover" } })).status, 404);
    assert.equal((await request(`/personal-templates/${template.id}`, { cookie, method: "DELETE" })).status, 404);
    assert.equal((await instantiate(template.id, { cookie })).status, 404);
  }
});

test("personal templates: only source owners/editors can save; their copies survive later source revocation/deletion", async () => {
  const original = await project();
  assert.equal((await save(original, { cookie: outsider.cookie })).status, 404);
  for (const [user, role] of [[editor, "editor"], [viewer, "viewer"]]) {
    assert.equal((await request(`/projects/${original.id}/members`, { method: "POST", body: { email: user.email, role } })).status, 200);
  }
  assert.equal((await save(original, { cookie: viewer.cookie })).status, 403);
  const saved = await save(original, { cookie: editor.cookie, title: "Моя копия общего дизайна" });
  assert.equal(saved.status, 201);
  const template = saved.data.template;
  assert.equal((await instantiate(template.id, { cookie: owner.cookie })).status, 404);
  assert.equal((await request(`/projects/${original.id}/members/${editor.id}`, { method: "DELETE" })).status, 200);
  assert.equal((await save(original, { cookie: editor.cookie })).status, 404);
  assert.equal((await request(`/personal-templates/${template.id}`, { cookie: editor.cookie, method: "PATCH", body: { revision: 1, projectId: original.id } })).status, 404);
  const copy = await instantiate(template.id, { cookie: editor.cookie });
  assert.equal(copy.status, 201);
  assert.equal(copy.data.project.owner_id, editor.id);
  assert.equal((await request(`/projects/${original.id}`, { method: "PUT", body: { revision: original.revision, deleted: true } })).status, 200);
  assert.equal((await save(original)).status, 410);
  assert.equal((await instantiate(template.id, { cookie: editor.cookie })).status, 201);
});

test("personal templates: search handles Cyrillic and literal wildcards; categories and metadata stay private", async () => {
  const original = await project();
  const first = (await save(original, { title: "Праздничная открытка 100%_", category: "Особая категория" })).data.template;
  await save(original, { title: "Не совпадает", category: "Другая" });
  await save(await project({ cookie: outsider.cookie }), { cookie: outsider.cookie, title: "Праздничная открытка чужая", category: "Секретная" });
  const found = await request("/personal-templates?q=" + encodeURIComponent("ПРАЗДНИЧНАЯ ОТКРЫТКА"));
  assert.equal(found.status, 200);
  assert.deepEqual(found.data.templates.map((template) => template.id), [first.id]);
  assert.equal(found.data.categories.includes("Секретная"), false);
  assert.match(found.headers.get("cache-control"), /no-store/);
  const literal = await request("/personal-templates?q=" + encodeURIComponent("%_"));
  assert.deepEqual(literal.data.templates.map((template) => template.id), [first.id]);
  const category = await request("/personal-templates?category=" + encodeURIComponent("Особая категория"));
  assert.deepEqual(category.data.templates.map((template) => template.id), [first.id]);
  for (const query of ["?q=" + "x".repeat(201), "?category=" + "x".repeat(61), "?q=first&q=second", "?category=first&category=second"]) {
    assert.equal((await request("/personal-templates" + query)).status, 400);
  }
});

test("personal templates: PATCH guards stale revisions and changes snapshots only after explicit projectId", async () => {
  const original = await project();
  const template = (await save(original)).data.template;
  const newer = await project({ title: "Новый источник", doc: document("Обновлённый снимок"), width: 1200, height: 900 });
  const rename = await request(`/personal-templates/${template.id}`, { method: "PATCH", body: { revision: 1, title: "Новое имя", category: "Новая категория" } });
  assert.equal(rename.status, 200);
  assert.equal(rename.data.template.revision, 2);
  assert.deepEqual((await instantiate(template.id)).data.project.document, original.document);
  assert.equal((await request(`/personal-templates/${template.id}`, { method: "PATCH", body: { revision: 1, projectId: newer.id } })).status, 409);
  const refreshed = await request(`/personal-templates/${template.id}`, { method: "PATCH", body: { revision: 2, projectId: newer.id } });
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.data.template.revision, 3);
  assert.equal(refreshed.data.template.title, "Новое имя");
  const copy = (await instantiate(template.id)).data.project;
  assert.equal(copy.width, 1200); assert.equal(copy.height, 900);
  assert.deepEqual(copy.document, newer.document);
  assert.equal((await request(`/personal-templates/${template.id}`, { method: "DELETE", body: { revision: 2 } })).status, 409);
  assert.equal((await request(`/personal-templates/${template.id}`, { method: "DELETE", body: { revision: 3 } })).status, 200);
  assert.equal((await instantiate(template.id)).status, 404);
  assert.equal((await request(`/projects/${copy.id}`)).status, 200);
  assert.equal((await request(`/projects/${original.id}`)).status, 200);
});

test("personal templates: invalid titles/categories/sources/revisions create or change nothing", async () => {
  const original = await project();
  const template = (await save(original)).data.template;
  const before = templateCount(), beforeProjects = projectCount();
  for (const body of [{ title: "", projectId: original.id }, { title: 22, projectId: original.id }, { title: "x".repeat(201), projectId: original.id },
    { title: "A\nB", projectId: original.id }, { title: "Fine", category: null, projectId: original.id }, { title: "Fine", category: "x".repeat(61), projectId: original.id },
    { title: "Fine", projectId: null }, { title: "Fine", projectId: "" }, { title: "Fine", projectId: "missing" }]) {
    const response = await request("/personal-templates", { method: "POST", body });
    assert.ok([400, 404].includes(response.status));
    assert.equal(templateCount(), before);
  }
  for (const body of [{ title: "No revision" }, { revision: 0, title: "Invalid revision" }, { revision: "1", title: "Invalid revision" },
    { revision: 1 }, { revision: 1, title: null }, { revision: 1, category: null }, { revision: 1, projectId: null }]) {
    assert.equal((await request(`/personal-templates/${template.id}`, { method: "PATCH", body })).status, 400);
  }
  for (const title of ["", " ", null, 42, "x".repeat(201), "Bad\u0000title"]) {
    assert.equal((await instantiate(template.id, { body: { title } })).status, 400);
    assert.equal(projectCount(), beforeProjects);
  }
  assert.equal((await instantiate(template.id)).data.project.document.pages[0].canvas.objects[0].text, "Исходная надпись");
});

test("personal templates: only bounded embedded raster thumbnails appear in summaries; external/SVG previews are dropped", async () => {
  const original = await project();
  for (const thumbnail of ["https://tracker.example/preview.png", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", "data:image/png;base64," + "a".repeat(1000001)]) {
    db.prepare("UPDATE projects SET thumbnail=? WHERE id=?").run(thumbnail, original.id);
    assert.equal((await save(original)).data.template.thumbnail, null);
  }
  const thumbnail = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=";
  db.prepare("UPDATE projects SET thumbnail=? WHERE id=?").run(thumbnail, original.id);
  const result = await save(original);
  assert.equal(result.status, 201);
  assert.equal(result.data.template.thumbnail, thumbnail);
  assert.equal((await instantiate(result.data.template.id)).data.project.thumbnail, thumbnail);
});

test("personal templates: count and storage quotas are owner-scoped; replacement releases old snapshot bytes", async () => {
  const user = await register("quota");
  const original = await project({ cookie: user.cookie });
  const template = (await save(original, { cookie: user.cookie })).data.template;
  const seed = db.prepare("INSERT INTO personal_templates(id,owner_id,title,category,kind,width,height,document,thumbnail,page_count,bytes,created,updated) SELECT ?,owner_id,title,category,kind,width,height,document,thumbnail,page_count,bytes,created,updated FROM personal_templates WHERE id=?");
  for (let index = 1; index < PERSONAL_TEMPLATE_LIMITS.maxTemplates; index++) seed.run("quota-template-" + index, template.id);
  assert.equal((await save(original, { cookie: user.cookie })).status, 409);
  assert.equal((await request("/personal-templates", { cookie: user.cookie })).data.usage.count, 100);
  assert.equal((await request(`/personal-templates/${template.id}`, { cookie: user.cookie, method: "PATCH", body: { revision: 1, title: "Allowed at quota" } })).status, 200);
  db.prepare("DELETE FROM personal_templates WHERE owner_id=? AND id<>?").run(user.id, template.id);
  db.prepare("UPDATE personal_templates SET bytes=? WHERE id=?").run(PERSONAL_TEMPLATE_LIMITS.maxStorageBytes, template.id);
  assert.equal((await save(original, { cookie: user.cookie })).status, 409);
  const replaced = await request(`/personal-templates/${template.id}`, { cookie: user.cookie, method: "PATCH", body: { revision: 2, projectId: original.id } });
  assert.equal(replaced.status, 200);
  assert.equal((await save(original, { cookie: user.cookie })).status, 201);
  assert.equal((await save(await project())).status, 201);
});

test("personal templates: insert failures roll back template/project creation and leave the database usable", async () => {
  const original = await project();
  const before = templateCount();
  db.exec("CREATE TRIGGER personal_template_test_fail BEFORE INSERT ON personal_templates WHEN NEW.title='REJECT' BEGIN SELECT RAISE(ABORT,'template insert failure'); END");
  try {
    assert.equal((await save(original, { title: "REJECT" })).status, 500);
    assert.equal(templateCount(), before);
  } finally { db.exec("DROP TRIGGER personal_template_test_fail"); }
  const template = (await save(original)).data.template;
  const beforeProjects = projectCount();
  db.exec("CREATE TRIGGER personal_template_project_fail BEFORE INSERT ON projects WHEN NEW.title='REJECT' BEGIN SELECT RAISE(ABORT,'template project insert failure'); END");
  try {
    assert.equal((await instantiate(template.id, { body: { title: "REJECT" } })).status, 500);
    assert.equal(projectCount(), beforeProjects);
  } finally { db.exec("DROP TRIGGER personal_template_project_fail"); }
  assert.equal((await instantiate(template.id)).status, 201);
});

test("personal templates: corrupt source/snapshot documents fail validation without partial writes", async () => {
  const original = await project();
  const template = (await save(original)).data.template;
  const before = templateCount(), beforeProjects = projectCount();
  db.prepare("UPDATE projects SET document=? WHERE id=?").run('{"pages":[]}', original.id);
  assert.equal((await save(original)).status, 400);
  assert.equal(templateCount(), before);
  db.prepare("UPDATE personal_templates SET document=? WHERE id=?").run("invalid-json", template.id);
  assert.equal((await instantiate(template.id)).status, 400);
  assert.equal(projectCount(), beforeProjects);
});
