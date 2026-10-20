import { randomBytes } from "node:crypto";

export const PERSONAL_TEMPLATE_LIMITS = Object.freeze({ maxTemplates: 100, maxStorageBytes: 50 * 1024 * 1024 });
const previewPattern = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const label = (value, maximum, empty = false) => typeof value === "string" &&
  (empty || !!value.trim()) && value.trim().length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
const problem = (status, message) => Object.assign(new Error(message), { status });

export function registerPersonalTemplates(app, { db, auth, access, validDocument }) {
  db.exec(`CREATE TABLE IF NOT EXISTS personal_templates(
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL,
    width INTEGER NOT NULL, height INTEGER NOT NULL, document TEXT NOT NULL,
    thumbnail TEXT, page_count INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
    bytes INTEGER NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS personal_templates_owner ON personal_templates(owner_id,updated);`);
  const fail = (res, status, error) => res.status(status).json({ error });
  const noCache = (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); };
  const find = db.prepare("SELECT * FROM personal_templates WHERE id=? AND owner_id=?");
  const usage = (owner) => db.prepare("SELECT COUNT(*) AS count,COALESCE(SUM(bytes),0) AS storageBytes FROM personal_templates WHERE owner_id=?").get(owner);
  const describe = (row) => ({ id: row.id, title: row.title, category: row.category, kind: row.kind,
    width: row.width, height: row.height, thumbnail: row.thumbnail, pageCount: row.page_count,
    revision: row.revision, created: row.created, updated: row.updated });
  function owned(req) {
    const row = find.get(req.params.id, req.user.id);
    if (!row) throw problem(404, "Личный шаблон не найден");
    return row;
  }
  function quota(owner, bytes, old = null) {
    const existing = usage(owner);
    if (!old && existing.count >= PERSONAL_TEMPLATE_LIMITS.maxTemplates)
      throw problem(409, "Можно сохранить до 100 личных шаблонов. Удалите ненужные шаблоны.");
    if (existing.storageBytes - (old?.bytes || 0) + bytes > PERSONAL_TEMPLATE_LIMITS.maxStorageBytes)
      throw problem(409, "Библиотека шаблонов превышает 50 МБ. Удалите ненужные шаблоны или уменьшите изображения.");
  }
  function snapshot(req, res) {
    const projectId = req.body?.projectId;
    if (typeof projectId !== "string" || !projectId || projectId.length > 128)
      throw problem(400, "Выберите исходный проект");
    // Use the application's access policy without replacing the template's :id.
    const sourceRequest = Object.create(req);
    sourceRequest.params = { id: projectId };
    let source = null;
    access(sourceRequest, res, () => { source = sourceRequest.project; });
    if (!source) return null; // access has already sent its 404 response.
    if (sourceRequest.role === "viewer") throw problem(403, "Для сохранения шаблона нужен доступ редактора или владельца");
    if (source.deleted) throw problem(410, "Сначала восстановите исходный проект из корзины");
    let document;
    try {
      document = JSON.parse(source.document);
      if (!validDocument(document)) throw new Error("invalid");
    } catch { throw problem(400, "Исходный документ некорректен или превышает допустимый размер"); }
    if (!Number.isInteger(source.width) || !Number.isInteger(source.height) || source.width < 100 || source.height < 100 ||
      source.width > 6000 || source.height > 6000 || typeof source.kind !== "string" || source.kind.length > 40)
      throw problem(400, "Некорректные размеры или тип исходного проекта");
    const thumbnail = typeof source.thumbnail === "string" && source.thumbnail.length <= 1000000 && previewPattern.test(source.thumbnail)
      ? source.thumbnail : null;
    return { kind: source.kind, width: source.width, height: source.height, document: source.document,
      thumbnail, pageCount: document.pages.length, bytes: Buffer.byteLength(source.document) + Buffer.byteLength(thumbnail || "") };
  }
  function transaction(req, res, next, operation) {
    let started = false;
    try {
      db.exec("BEGIN IMMEDIATE"); started = true;
      const result = operation();
      if (res.headersSent) { db.exec("ROLLBACK"); return; }
      db.exec("COMMIT"); started = false;
      res.status(result.status || 200).json(result.body);
    } catch (error) {
      if (started) db.exec("ROLLBACK");
      if (error.status) return fail(res, error.status, error.message);
      next(error);
    }
  }
  app.get("/api/personal-templates", auth, noCache, (req, res) => {
    const { q = "", category } = req.query;
    if (!label(q, 200, true) || (category !== undefined && !label(category, 60, true)))
      return fail(res, 400, "Проверьте поисковый запрос и категорию");
    const rows = db.prepare("SELECT id,title,category,kind,width,height,thumbnail,page_count,revision,created,updated FROM personal_templates WHERE owner_id=? ORDER BY updated DESC,id DESC").all(req.user.id);
    const query = q.trim().normalize("NFKC").toLocaleLowerCase("ru");
    const templates = rows.filter((row) => (category === undefined || row.category === category) &&
      (!query || `${row.title} ${row.category}`.normalize("NFKC").toLocaleLowerCase("ru").includes(query))).map(describe);
    const categories = [...new Set(rows.map((row) => row.category))].sort((a, b) => a.localeCompare(b, "ru"));
    res.json({ templates, categories, limits: PERSONAL_TEMPLATE_LIMITS, usage: usage(req.user.id) });
  });
  app.post("/api/personal-templates", auth, noCache, (req, res, next) => transaction(req, res, next, () => {
    const { title, category = "" } = req.body || {};
    if (!label(title, 200) || !label(category, 60, true)) throw problem(400, "Название: 1–200 символов; категория: до 60 символов");
    const source = snapshot(req, res);
    if (!source) return null;
    quota(req.user.id, source.bytes);
    const id = randomBytes(16).toString("hex"), now = new Date().toISOString();
    db.prepare("INSERT INTO personal_templates(id,owner_id,title,category,kind,width,height,document,thumbnail,page_count,bytes,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, req.user.id, title.trim(), category.trim(), source.kind, source.width, source.height, source.document, source.thumbnail, source.pageCount, source.bytes, now, now);
    return { status: 201, body: { template: describe(find.get(id, req.user.id)) } };
  }));
  app.patch("/api/personal-templates/:id", auth, noCache, (req, res, next) => transaction(req, res, next, () => {
    const old = owned(req), body = req.body || {};
    if (!Number.isInteger(body.revision) || body.revision < 1) throw problem(400, "Укажите текущую версию шаблона");
    if (body.revision !== old.revision) throw problem(409, "Шаблон изменён в другой вкладке. Обновите библиотеку перед сохранением.");
    if (!["title", "category", "projectId"].some((field) => body[field] !== undefined)) throw problem(400, "Нет изменений для сохранения");
    const title = body.title ?? old.title, category = body.category ?? old.category;
    if (!label(title, 200) || !label(category, 60, true) || body.title === null || body.category === null)
      throw problem(400, "Название: 1–200 символов; категория: до 60 символов");
    let source;
    if (body.projectId !== undefined) {
      source = snapshot(req, res);
      if (!source) return null;
    } else source = { kind: old.kind, width: old.width, height: old.height, document: old.document,
      thumbnail: old.thumbnail, pageCount: old.page_count, bytes: old.bytes };
    quota(req.user.id, source.bytes, old);
    db.prepare("UPDATE personal_templates SET title=?,category=?,kind=?,width=?,height=?,document=?,thumbnail=?,page_count=?,bytes=?,revision=revision+1,updated=? WHERE id=? AND owner_id=? AND revision=?")
      .run(title.trim(), category.trim(), source.kind, source.width, source.height, source.document, source.thumbnail, source.pageCount, source.bytes,
        new Date().toISOString(), old.id, req.user.id, old.revision);
    return { body: { template: describe(find.get(old.id, req.user.id)) } };
  }));
  app.delete("/api/personal-templates/:id", auth, noCache, (req, res, next) => transaction(req, res, next, () => {
    const old = owned(req);
    if (req.body?.revision !== undefined && req.body.revision !== old.revision)
      throw problem(409, "Шаблон изменился. Обновите библиотеку перед удалением.");
    db.prepare("DELETE FROM personal_templates WHERE id=? AND owner_id=?").run(old.id, req.user.id);
    return { body: { ok: true } };
  }));
  app.post("/api/personal-templates/:id/instantiate", auth, noCache, (req, res, next) => transaction(req, res, next, () => {
    const template = owned(req);
    const title = req.body?.title === undefined ? template.title : req.body.title;
    if (!label(title, 200)) throw problem(400, "Название дизайна должно содержать от 1 до 200 символов");
    // A standalone private copy owns no relation to the original source project.
    let document;
    try { document = JSON.parse(template.document); if (!validDocument(document)) throw new Error("invalid"); }
    catch { throw problem(400, "Сохранённый документ шаблона некорректен"); }
    const id = randomBytes(16).toString("hex"), now = new Date().toISOString();
    db.prepare("INSERT INTO projects(id,owner_id,title,kind,width,height,document,thumbnail,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(id, req.user.id, title.trim(), template.kind, template.width, template.height, template.document, template.thumbnail, now, now);
    const project = db.prepare("SELECT * FROM projects WHERE id=?").get(id);
    return { status: 201, body: { project: { ...project, document, role: "owner" } } };
  }));
}
