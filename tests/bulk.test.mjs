import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.mjs';

const dir = mkdtempSync(path.join(os.tmpdir(), 'forma-bulk-'));
let db, realtime, server, base, owner, editor, viewer, outsider;
async function request(endpoint, { cookie = owner, body, method = 'GET' } = {}) {
  const response = await fetch(base + endpoint, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function register(name) {
  const response = await request('/auth/register', { cookie: null, method: 'POST', body: { name, email: `bulk-${name}@example.test`, password: 'bulk-testing-password-2026' } });
  assert.equal(response.status, 200);
  return response.cookie;
}
const document = { pages: [{ id: 'bulk-page', canvas: { background: '#fff', objects: [
  { id: 'title', type: 'Textbox', text: 'Привет, {{имя}}', fontSize: 60, fill: '#7048ed' },
  { id: 'group', type: 'Group', objects: [{ type: 'Textbox', text: 'Город: {{город}}' }] },
  { id: 'image', type: 'Image', src: '/api/assets/{{literal}}/file' },
] } }] };
async function source() {
  const response = await request('/projects', { method: 'POST', body: { title: 'Рассылка', width: 800, height: 600, document } });
  assert.equal(response.status, 201);
  return response.data.project;
}
const bulk = (id, body, cookie = owner) => request(`/projects/${id}/bulk`, { cookie, method: 'POST', body });
const total = () => db.prepare('SELECT COUNT(*) AS n FROM projects').get().n;
before(async () => {
  const created = createApp({ dataDir: dir });
  db = created.db; realtime = created.realtime;
  server = created.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
  owner = await register('owner'); editor = await register('editor'); viewer = await register('viewer'); outsider = await register('outsider');
});
after(async () => {
  realtime.close();
  await new Promise((resolve) => server.close(resolve));
  db.close(); rmSync(dir, { recursive: true, force: true });
});

test('bulk API: real route creates independent personalized owned projects and leaves the source untouched', async () => {
  const original = await source();
  const before = await request('/projects/' + original.id);
  const result = await bulk(original.id, { csv: '\uFEFFимя;город\r\n"Анна; Петрова";"Москва\nЦентр"\r\n"Иван ""Иваныч""";Казань', titlePattern: 'Письмо — {{имя}}' });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  assert.equal(result.data.count, 2);
  assert.deepEqual(result.data.variables, ['имя', 'город']);
  const [anna, ivan] = result.data.projects;
  assert.notEqual(anna.id, ivan.id);
  assert.notEqual(anna.id, original.id);
  assert.equal(anna.title, 'Письмо — Анна; Петрова');
  assert.equal(ivan.title, 'Письмо — Иван "Иваныч"');
  assert.equal(anna.role, 'owner');
  assert.equal(anna.width, 800); assert.equal(anna.height, 600);
  assert.equal(anna.document.pages[0].canvas.objects[0].text, 'Привет, Анна; Петрова');
  assert.equal(anna.document.pages[0].canvas.objects[1].objects[0].text, 'Город: Москва\nЦентр');
  assert.equal(anna.document.pages[0].canvas.objects[2].src, '/api/assets/{{literal}}/file');
  assert.deepEqual((await request('/projects/' + original.id)).data, before.data);
  const changed = structuredClone(anna.document); changed.pages[0].canvas.objects[0].text = 'Changed';
  assert.equal((await request('/projects/' + anna.id, { method: 'PUT', body: { revision: anna.revision, document: changed } })).status, 200);
  assert.equal((await request('/projects/' + ivan.id)).data.project.document.pages[0].canvas.objects[0].text, 'Привет, Иван "Иваныч"');
  assert.deepEqual((await request('/projects/' + original.id)).data.project.document, document);
});

test('bulk API: authentication, source ACL, viewer, editor ownership and revoked access are enforced', async () => {
  const original = await source();
  const body = { csv: 'имя,город\nАнна,Москва' };
  assert.equal((await bulk(original.id, body, null)).status, 401);
  assert.equal((await bulk(original.id, body, outsider)).status, 404);
  for (const [name, role] of [['editor', 'editor'], ['viewer', 'viewer']])
    assert.equal((await request(`/projects/${original.id}/members`, { method: 'POST', body: { email: `bulk-${name}@example.test`, role } })).status, 200);
  assert.equal((await bulk(original.id, body, viewer)).status, 403);
  const copied = await bulk(original.id, body, editor);
  assert.equal(copied.status, 201);
  const copy = copied.data.projects[0];
  assert.notEqual(copy.owner_id, original.owner_id);
  assert.equal(copy.role, 'owner');
  assert.equal((await request('/projects/' + copy.id, { cookie: owner })).status, 404);
  assert.equal((await request('/projects/' + copy.id, { cookie: viewer })).status, 404);
  assert.equal((await request('/projects/' + copy.id + '/members', { cookie: editor })).data.members.length, 0);
  const editorId = (await request('/auth/me', { cookie: editor })).data.user.id;
  assert.equal((await request(`/projects/${original.id}/members/${editorId}`, { method: 'DELETE' })).status, 200);
  assert.equal((await bulk(original.id, body, editor)).status, 404);
});

test('bulk API: validation failures create nothing, including a late invalid title', async () => {
  const original = await source();
  const before = total();
  for (const body of [
    { csv: 'имя\nАнна' },
    { csv: 'имя,имя\nА,Б' },
    { csv: 'имя,город\nАнна' },
    { csv: 'имя,город\nАнна,Москва', titlePattern: '{{нет}}' },
    { csv: 'имя,город,название\nАнна,Москва,Good\nИван,Казань,', titlePattern: '{{название}}' },
    { csv: 'имя,город\nАнна,Москва', mode: 'pages' },
    { csv: 'имя,город\n' + Array(51).fill('Анна,Москва').join('\n') },
    { csv: null },
  ]) {
    assert.equal((await bulk(original.id, body)).status, 400, JSON.stringify(body));
    assert.equal(total(), before);
  }
  assert.equal((await request('/projects/' + original.id, { method: 'PUT', body: { revision: original.revision, deleted: true } })).status, 200);
  assert.equal((await bulk(original.id, { csv: 'имя,город\nА,Б' })).status, 410);
  assert.equal(total(), before);
});

test('bulk API: database insert failure rolls back the complete batch', async () => {
  const original = await source();
  const before = total();
  db.exec("CREATE TRIGGER bulk_test_failure BEFORE INSERT ON projects WHEN NEW.title='REJECT' BEGIN SELECT RAISE(ABORT,'bulk test insert failure'); END");
  try {
    const result = await bulk(original.id, { csv: 'имя,город,название\nАнна,Москва,Good\nИван,Казань,REJECT', titlePattern: '{{название}}' });
    assert.equal(result.status, 500);
    assert.equal(total(), before);
  } finally { db.exec('DROP TRIGGER bulk_test_failure'); }
});

test('bulk API: replacements preserve unsafe-looking strings as literal data without recursive evaluation', async () => {
  const original = await source();
  const value = '$& <script>alert(1)</script> {{город}}';
  const result = await bulk(original.id, { csv: 'имя,город\n' + value + ',Москва', titlePattern: '{{имя}}' });
  assert.equal(result.status, 201);
  assert.equal(result.data.projects[0].title, value);
  assert.equal(result.data.projects[0].document.pages[0].canvas.objects[0].text, 'Привет, ' + value);
});
