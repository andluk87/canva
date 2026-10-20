import { createHash, randomBytes } from "node:crypto";
import sharp from "sharp";

// Publications contain a separate, inert copy. Never deserialize a private
// document directly in the public viewer or fetch its image URLs on the server.
const objectTypes = new Set([
  "Rect", "Circle", "Triangle", "Ellipse", "Line", "Polyline", "Polygon",
  "Path", "Text", "IText", "Textbox", "Image", "Group", "ActiveSelection",
  "rect", "circle", "triangle", "ellipse", "line", "polyline", "polygon",
  "path", "text", "i-text", "textbox", "image", "group", "activeSelection",
  "linear", "radial", "Shadow", "Brightness", "Contrast", "Saturation",
  "Blur", "Grayscale", "Invert", "Sepia", "Noise", "Pixelate", "HueRotation",
  "Vibrance", "Gamma", "RemoveColor", "BlendColor", "Composed", "ColorMatrix",
  "Brownie", "Vintage", "Kodachrome", "Technicolor", "Polaroid", "BlackWhite",
  "Resize", "layoutManager", "LayoutManager",
]);
const fields = new Set([
  "type", "version", "originX", "originY", "left", "top", "width", "height",
  "fill", "stroke", "strokeWidth", "strokeDashArray", "strokeLineCap",
  "strokeDashOffset", "strokeLineJoin", "strokeUniform", "strokeMiterLimit",
  "scaleX", "scaleY", "angle", "flipX", "flipY", "opacity", "shadow",
  "visible", "backgroundColor", "fillRule", "paintFirst", "globalCompositeOperation",
  "skewX", "skewY", "rx", "ry", "radius", "startAngle", "endAngle", "clockwise",
  "points", "path", "pathOffset", "x", "y", "x1", "x2", "y1", "y2", "src",
  "cropX", "cropY", "crossOrigin", "filters", "resizeFilter", "fontFamily",
  "fontWeight", "fontSize", "text", "underline", "overline", "linethrough",
  "textAlign", "fontStyle", "lineHeight", "textBackgroundColor", "charSpacing",
  "styles", "direction", "minWidth", "splitByGrapheme", "objects", "clipPath",
  "absolutePositioned", "inverted", "excludeFromExport", "offsetX", "offsetY",
  "blur", "color", "affectStroke", "nonScaling", "gradientUnits", "coords",
  "colorStops", "offset", "gradientTransform", "brightness", "contrast",
  "saturation", "mode", "alpha", "noise", "blocksize", "rotation", "vibrance",
  "gamma", "distance", "useAlpha", "colorsOnly", "matrix", "subFilters",
  "resizeType", "lanczosLobes", "scaleX", "scaleY", "background", "backgroundImage",
  "overlayImage", "overlayColor", "textDecorationThickness", "deltaY", "r1", "r2",
  "layoutManager", "strategy",
]);
const unsafe = /<\s*(?:script|iframe|object|embed|svg|link|meta)\b|(?:javascript|vbscript)\s*:|url\s*\(/i;
const external = /(?:https?|ftp|file|blob)\s*:|^\s*\/\//i;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

const canonical = (value) => JSON.stringify(value, function (_key, item) {
  if (item && typeof item === "object" && !Array.isArray(item)) {
    return Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]));
  }
  return item;
});

async function safeDocument(document, validDocument) {
  if (!validDocument(document)) throw new Error("Некорректный документ");
  let nodes = 0;
  const images = new Map();
  function inspect(value, key = "", depth = 0) {
    if (++nodes > 200000 || depth > 40) throw new Error("Слишком сложный документ");
    if (typeof value === "string") {
      if (unsafe.test(value)) throw new Error("Скрипты и SVG недопустимы в публикации");
      if (key === "src") {
        if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value))
          throw new Error("Для публикации нужны встроенные PNG, JPG или WebP; загрузите изображение в редактор");
        images.set(value, null);
      } else if (external.test(value) || /^\s*data:/i.test(value)) {
        throw new Error("Внешние ссылки и ресурсы недопустимы в снимке");
      }
      return;
    }
    if (typeof value === "number" && (!Number.isFinite(value) || Math.abs(value) > 10000000))
      throw new Error("Некорректное числовое значение");
    if (!value || typeof value !== "object") return;
    if (value.type !== undefined && (typeof value.type !== "string" || !objectTypes.has(value.type)))
      throw new Error("Этот тип объекта нельзя опубликовать");
    if (["Image", "image"].includes(value.type) && typeof value.src !== "string")
      throw new Error("Изображение должно быть встроено в документ");
    for (const [name, child] of Object.entries(value)) {
      if (["__proto__", "constructor", "prototype"].includes(name))
        throw new Error("Небезопасное свойство документа");
      inspect(child, name, depth + 1);
    }
  }
  // Page identifiers and unrelated private metadata are not part of the viewer.
  for (const page of document.pages) inspect(page.canvas);
  if (images.size > 100) throw new Error("В одном снимке допустимо до 100 разных изображений");
  for (const source of images.keys()) {
    const buffer = Buffer.from(source.slice(source.indexOf(",") + 1), "base64");
    if (buffer.length > 10 * 1024 * 1024) throw new Error("Слишком большое изображение");
    try {
      const image = sharp(buffer, { limitInputPixels: 25000000, animated: false });
      const meta = await image.metadata();
      if (!["png", "jpeg", "webp"].includes(meta.format)) throw new Error("not raster");
      const normalized = await image.rotate().png().toBuffer();
      images.set(source, "data:image/png;base64," + normalized.toString("base64"));
    } catch {
      throw new Error("Не удалось проверить встроенное изображение");
    }
  }
  function pick(value, key = "") {
    if (key === "src") return images.get(value);
    if (Array.isArray(value)) return value.map((child) => pick(child));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value)
      .filter(([name]) => fields.has(name) || /^\d+$/.test(name))
      .map(([name, child]) => [name, pick(child, name)]));
  }
  const snapshot = { pages: document.pages.map((page, index) => ({
    id: `page-${index + 1}`, canvas: pick(page.canvas),
  })) };
  if (Buffer.byteLength(canonical(snapshot)) > 18000000) throw new Error("Публикация слишком велика");
  return snapshot;
}

export function registerPublications(app, { db, auth, access, owner, validDocument }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS publications(
      token TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      version INTEGER NOT NULL DEFAULT 1,
      created TEXT NOT NULL,
      updated TEXT NOT NULL,
      expires INTEGER,
      revoked INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS publications_project ON publications(project_id);
    CREATE TABLE IF NOT EXISTS publication_snapshots(
      token TEXT NOT NULL REFERENCES publications(token) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      document TEXT NOT NULL,
      source_revision INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      created TEXT NOT NULL,
      PRIMARY KEY(token, version)
    );
  `);
  const fail = (res, code, error) => res.status(code).json({ error });
  const noCache = (res) => res.set({
    "Cache-Control": "no-store, max-age=0", "Pragma": "no-cache",
    "X-Robots-Tag": "noindex, nofollow, noarchive", "Referrer-Policy": "no-referrer",
  });
  const describe = (row) => ({
    token: row.token, version: row.version, created: row.created, updated: row.updated,
    expiresAt: row.expires === null ? null : new Date(row.expires).toISOString(),
    revoked: !!row.revoked, expired: row.expires !== null && row.expires <= Date.now(),
    url: "/?view=" + row.token, sourceRevision: row.source_revision,
  });
  const find = db.prepare(`SELECT p.*,s.source_revision FROM publications p
    JOIN publication_snapshots s ON s.token=p.token AND s.version=p.version
    WHERE p.token=? AND p.project_id=?`);
  function expiry(body, fallback = null) {
    if (body.expiresInDays === undefined && body.expiresAt === undefined) return fallback;
    if (body.expiresInDays !== undefined && body.expiresAt !== undefined)
      throw new Error("Укажите один срок публикации");
    if (body.expiresInDays === null || body.expiresAt === null) return null;
    const expires = body.expiresAt !== undefined
      ? typeof body.expiresAt === "string" ? Date.parse(body.expiresAt) : NaN
      : Number.isInteger(body.expiresInDays) && body.expiresInDays >= 1 && body.expiresInDays <= 365
        ? Date.now() + body.expiresInDays * 86400000 : NaN;
    if (!Number.isFinite(expires) || expires <= Date.now() || expires > Date.now() + 366 * 86400000)
      throw new Error("Срок публикации должен быть в пределах ближайшего года");
    return expires;
  }
  async function publish(req, res, next) {
    try {
      if (req.project.deleted) return fail(res, 409, "Сначала восстановите проект из корзины");
      const old = req.params.token ? find.get(req.params.token, req.project.id) : null;
      if (req.params.token && !old) return fail(res, 404, "Публикация не найдена");
      if (old?.revoked) return fail(res, 410, "Ссылка отозвана. Создайте новую публикацию");
      if (!old && db.prepare("SELECT COUNT(*) AS n FROM publications WHERE project_id=? AND revoked=0").get(req.project.id).n >= 50)
        return fail(res, 409, "Отзовите старые ссылки перед созданием новых");
      const expires = expiry(req.body || {}, old?.expires ?? null);
      if (unsafe.test(req.project.title)) return fail(res, 400, "Недопустимое название публикации");
      const document = canonical(await safeDocument(JSON.parse(req.project.document), validDocument));
      // Sharp decoding is asynchronous. Recheck both authority and the revision
      // after it finishes, so concurrent changes cannot publish a stale request.
      const project = db.prepare("SELECT * FROM projects WHERE id=?").get(req.project.id);
      if (!project || project.owner_id !== req.user.id) return fail(res, 404, "Проект не найден");
      if (project.deleted || project.revision !== req.project.revision)
        return fail(res, 409, "Проект изменился во время публикации. Повторите действие");
      if (old) {
        const current = find.get(old.token, project.id);
        if (!current || current.revoked || current.version !== old.version)
          return fail(res, 409, "Публикация изменилась. Обновите список");
      }
      const token = old?.token || randomBytes(32).toString("base64url");
      const version = old ? old.version + 1 : 1;
      const now = new Date().toISOString();
      db.exec("BEGIN");
      try {
        if (!old) db.prepare("INSERT INTO publications(token,project_id,version,created,updated,expires) VALUES(?,?,?,?,?,?)")
          .run(token, project.id, version, now, now, expires);
        else db.prepare("UPDATE publications SET version=?,updated=?,expires=? WHERE token=?")
          .run(version, now, expires, token);
        db.prepare("INSERT INTO publication_snapshots VALUES(?,?,?,?,?,?,?,?,?,?)").run(
          token, version, project.title, project.kind, project.width, project.height,
          document, project.revision, createHash("sha256").update(document).digest("hex"), now,
        );
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      noCache(res);
      res.status(old ? 200 : 201).json({ publication: describe(find.get(token, project.id)) });
    } catch (error) {
      if (error instanceof Error && !/SQLITE|database|no such/i.test(error.message))
        return fail(res, 400, error.message);
      next(error);
    }
  }
  app.get("/api/projects/:id/publications", auth, access, owner, (req, res) => {
    noCache(res);
    res.json({ publications: db.prepare(`SELECT p.*,s.source_revision FROM publications p
      JOIN publication_snapshots s ON s.token=p.token AND s.version=p.version
      WHERE p.project_id=? ORDER BY p.updated DESC LIMIT 100`).all(req.project.id).map(describe) });
  });
  app.post("/api/projects/:id/publications", auth, access, owner, publish);
  app.put("/api/projects/:id/publications/:token", auth, access, owner, publish);
  app.delete("/api/projects/:id/publications/:token", auth, access, owner, (req, res) => {
    const publication = find.get(req.params.token, req.project.id);
    if (!publication) return fail(res, 404, "Публикация не найдена");
    db.prepare("UPDATE publications SET revoked=1,updated=? WHERE token=?")
      .run(new Date().toISOString(), publication.token);
    noCache(res);
    res.json({ ok: true });
  });
  app.get("/api/publications/:token", (req, res) => {
    noCache(res);
    if (!tokenPattern.test(req.params.token)) return fail(res, 404, "Публикация не найдена");
    const publication = db.prepare(`SELECT p.*,s.title,s.kind,s.width,s.height,s.document,s.content_hash
      FROM publications p JOIN publication_snapshots s ON s.token=p.token AND s.version=p.version
      JOIN projects project ON project.id=p.project_id WHERE p.token=? AND project.deleted=0`).get(req.params.token);
    if (!publication) return fail(res, 404, "Публикация не найдена");
    if (publication.revoked) return fail(res, 410, "Владелец отозвал эту ссылку");
    if (publication.expires !== null && publication.expires <= Date.now())
      return fail(res, 410, "Срок действия ссылки истёк");
    res.json({ publication: {
      title: publication.title, kind: publication.kind,
      width: publication.width, height: publication.height,
      version: publication.version, created: publication.created, updated: publication.updated,
      expiresAt: publication.expires === null ? null : new Date(publication.expires).toISOString(),
      contentHash: publication.content_hash, document: JSON.parse(publication.document),
    } });
  });
}
