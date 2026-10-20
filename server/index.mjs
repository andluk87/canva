import express from "express";
import { createServer } from "node:http";
import { createRealtime } from "./realtime.mjs";
import {registerBulk} from "./bulk.mjs";
import {registerPublications} from "./publications.mjs";
import {registerAccounts} from "./accounts.mjs";
import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import multer from "multer";
import sharp from "sharp";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export function createApp({
  dataDir = process.env.DATA_DIR || path.join(root, "data"),
} = {}) {
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(path.join(dataDir, "uploads"), { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, "forma.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,brand TEXT NOT NULL DEFAULT '{}',created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,owner_id TEXT REFERENCES users(id),title TEXT NOT NULL,kind TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,document TEXT NOT NULL,thumbnail TEXT,folder TEXT DEFAULT '',favorite INTEGER DEFAULT 0,deleted INTEGER DEFAULT 0,revision INTEGER DEFAULT 1,created TEXT NOT NULL,updated TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS members(project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,user_id TEXT REFERENCES users(id),role TEXT CHECK(role IN ('viewer','editor')),PRIMARY KEY(project_id,user_id));
    CREATE TABLE IF NOT EXISTS versions(id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,document TEXT NOT NULL,title TEXT NOT NULL,created TEXT NOT NULL,revision INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,owner_id TEXT REFERENCES users(id),name TEXT NOT NULL,file TEXT NOT NULL,created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS comments(id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,user_id TEXT REFERENCES users(id),body TEXT NOT NULL,created TEXT NOT NULL);
  `);
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "20mb" }));
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "X-Frame-Options": "DENY",
    });
    if (
      req.method !== "GET" &&
      req.headers.origin &&
      new URL(req.headers.origin).host !== req.headers.host
    )
      return res.status(403).json({ error: "Недопустимый источник запроса" });
    next();
  });
  const id = () => randomBytes(16).toString("hex");
  const now = () => new Date().toISOString();
  const err = (res, status, error) => res.status(status).json({ error });
  const safeUser = (u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    brand: JSON.parse(u.brand),
  });
  const sha = (s) => createHash("sha256").update(s).digest("hex");
  app.use((req, res, next) => {
    const token = (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("forma_session="))
      ?.slice(14);
    if (token) {
      const s = db
        .prepare("SELECT * FROM sessions WHERE token=? AND expires>?")
        .get(sha(token), Date.now());
      if (s)
        req.user = db.prepare("SELECT * FROM users WHERE id=?").get(s.user_id);
    }
    next();
  });
  const auth = (req, res, next) =>
    req.user ? next() : err(res, 401, "Войдите в аккаунт");
  const attempts = new Map();
  const throttle = (req, res, next) => {
    const key = req.ip;
    const a = attempts.get(key) || { n: 0, until: Date.now() + 900000 };
    if (a.until < Date.now()) {
      a.n = 0;
      a.until = Date.now() + 900000;
    }
    a.n++;
    attempts.set(key, a);
    if (a.n > 60)
      return err(res, 429, "Слишком много попыток. Повторите через 15 минут.");
    next();
  };
  const login = (req,res, u) => {
    const token = randomBytes(32).toString("hex");
    db.prepare("INSERT INTO sessions(token,user_id,expires,created,user_agent) VALUES(?,?,?,?,?)").run(
      sha(token),
      u.id,
      Date.now() + 604800000,Date.now(),String(req.headers["user-agent"]||"").slice(0,300),
    );
    res.cookie("forma_session", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.COOKIE_SECURE === "true",
      maxAge: 604800000,
      path: "/",
    });
    res.json({ user: safeUser(u) });
  };
  app.get("/api/health", (_, res) =>
    res.json({
      status: "ok",
      version: "0.3.0",
      database: !!db.prepare("SELECT 1").get(),
    }),
  );
  app.post("/api/auth/register", throttle, (req, res) => {
    const { email, name, password } = req.body;
    if (
      typeof email !== "string" ||
      !/^\S+@\S+\.\S+$/.test(email) ||
      email.length > 254 ||
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 100 ||
      typeof password !== "string" ||
      password.length < 10 ||
      password.length > 256
    )
      return err(
        res,
        400,
        "Укажите имя, email и пароль длиной от 10 до 256 символов",
      );
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, salt, 64).toString("hex");
    try {
      const uid = id();
      db.prepare(
        "INSERT INTO users(id,email,name,password,created) VALUES(?,?,?,?,?)",
      ).run(
        uid,
        email.toLowerCase().trim(),
        name.trim(),
        `${salt}:${hash}`,
        now(),
      );
      login(req,res, db.prepare("SELECT * FROM users WHERE id=?").get(uid));
    } catch (e) {
      if (String(e).includes("UNIQUE"))
        return err(res, 409, "Этот email уже зарегистрирован");
      throw e;
    }
  });
  app.post("/api/auth/login", throttle, (req, res) => {
    const { email, password } = req.body;
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      password.length > 256
    )
      return err(res, 400, "Проверьте email и пароль");
    const u = db
      .prepare("SELECT * FROM users WHERE email=?")
      .get(email.toLowerCase().trim());
    const [salt, hash] = (u?.password || "dummy:" + "0".repeat(128)).split(":");
    const check = scryptSync(password, salt, 64);
    if (!u || !timingSafeEqual(check, Buffer.from(hash, "hex")))
      return err(res, 401, "Неверный email или пароль");
    if(!accounts.verifyLogin(req,res,u))return;
    login(req,res, u);
  });
  app.post("/api/auth/logout", auth, (req, res) => {
    const token = (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("forma_session="))
      ?.slice(14);
    if (token) db.prepare("DELETE FROM sessions WHERE token=?").run(sha(token));
    realtime.refreshAccess();
    res.clearCookie("forma_session", { path: "/" }).json({ ok: true });
  });
  app.get("/api/auth/me", auth, (req, res) =>
    res.json({ user: safeUser(req.user) }),
  );
  app.put("/api/brand", auth, (req, res) => {
    const { colors, font, name } = req.body;
    if (
      !Array.isArray(colors) ||
      colors.length > 10 ||
      colors.some((c) => !/^#[0-9a-f]{6}$/i.test(c)) ||
      typeof font !== "string" ||
      font.length > 100 ||
      typeof name !== "string" ||
      name.length > 100
    )
      return err(res, 400, "Некорректный бренд-набор");
    db.prepare("UPDATE users SET brand=? WHERE id=?").run(
      JSON.stringify({ colors, font, name }),
      req.user.id,
    );
    res.json({ ok: true });
  });
  function access(req, res, next) {
    const p = db
      .prepare("SELECT * FROM projects WHERE id=?")
      .get(req.params.id);
    if (!p) return err(res, 404, "Проект не найден");
    const role =
      p.owner_id === req.user.id
        ? "owner"
        : db
            .prepare(
              "SELECT role FROM members WHERE project_id=? AND user_id=?",
            )
            .get(p.id, req.user.id)?.role;
    if (!role) return err(res, 404, "Проект не найден");
    req.project = p;
    req.role = role;
    next();
  }
  const write = (req, res, next) =>
    req.role === "viewer"
      ? err(res, 403, "У вас доступ только для просмотра")
      : next();
  const owner = (req, res, next) =>
    req.role === "owner"
      ? next()
      : err(res, 403, "Действие доступно только владельцу");
  const summary = (p, user) => {
    const { document, ...rest } = p;
    return {
      ...rest,
      role:
        p.owner_id === user
          ? "owner"
          : db
              .prepare(
                "SELECT role FROM members WHERE project_id=? AND user_id=?",
              )
              .get(p.id, user)?.role,
    };
  };
  function validDocument(d) {
    return (
      d &&
      Array.isArray(d.pages) &&
      new Set(d.pages.map((p) => p?.id)).size === d.pages.length &&
      d.pages.length > 0 &&
      d.pages.length <= 100 &&
      d.pages.every(
        (p) =>
          p &&
          typeof p.id === "string" &&
          p.id.length > 0 &&
          p.id.length <= 128 &&
          p.canvas &&
          typeof p.canvas === "object" &&
          Array.isArray(p.canvas.objects) &&
          p.canvas.objects.length <= 2000 &&
          p.canvas.objects.every(
            (o) =>
              o &&
              typeof o === "object" &&
              !Array.isArray(o) &&
              typeof o.type === "string" &&
              (!o.id || (typeof o.id === "string" && o.id.length <= 128)),
          ) &&
          new Set(p.canvas.objects.filter((o) => o.id).map((o) => o.id))
            .size === p.canvas.objects.filter((o) => o.id).length,
      ) &&
      Buffer.byteLength(JSON.stringify(d)) < 15000000
    );
  }
  const realtime = createRealtime(db, validDocument);
  const accounts=registerAccounts(app,{db,auth,realtime,safeUser});
  registerBulk(app,{db,auth,access,write,validDocument});
  registerPublications(app,{db,auth,access,owner,validDocument});
  app.get("/api/projects", auth, (req, res) => {
    const ps = db
      .prepare(
        "SELECT DISTINCT p.* FROM projects p LEFT JOIN members m ON p.id=m.project_id WHERE p.owner_id=? OR m.user_id=? ORDER BY updated DESC",
      )
      .all(req.user.id, req.user.id);
    res.json({ projects: ps.map((p) => summary(p, req.user.id)) });
  });
  app.post("/api/projects", auth, (req, res) => {
    const {
      title = "Новый дизайн",
      kind = "design",
      width = 1080,
      height = 1080,
      document = {
        pages: [
          {
            id: id(),
            canvas: { version: "6.7.1", objects: [], background: "#ffffff" },
          },
        ],
      },
    } = req.body;
    if (
      typeof title !== "string" ||
      !title.trim() ||
      title.length > 200 ||
      typeof kind !== "string" ||
      kind.length > 40 ||
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 100 ||
      height < 100 ||
      width > 6000 ||
      height > 6000 ||
      !validDocument(document)
    )
      return err(
        res,
        400,
        "Проверьте название, размеры (100–6000 px) и документ",
      );
    const pid = id(),
      t = now();
    db.prepare(
      "INSERT INTO projects(id,owner_id,title,kind,width,height,document,created,updated) VALUES(?,?,?,?,?,?,?,?,?)",
    ).run(
      pid,
      req.user.id,
      title.trim(),
      kind,
      width,
      height,
      JSON.stringify(document),
      t,
      t,
    );
    res.status(201).json({
      project: {
        ...db.prepare("SELECT * FROM projects WHERE id=?").get(pid),
        document,
        role: "owner",
      },
    });
  });
  app.get("/api/projects/:id", auth, access, (req, res) =>
    res.json({
      project: {
        ...req.project,
        document: JSON.parse(req.project.document),
        role: req.role,
      },
    }),
  );
  app.put("/api/projects/:id", auth, access, write, (req, res) => {
    const p = req.project,
      b = req.body;
    if (b.revision !== p.revision)
      return err(
        res,
        409,
        "Проект изменён в другой вкладке. Перезагрузите страницу, чтобы не перезаписать изменения.",
      );
    if (b.document !== undefined && !validDocument(b.document))
      return err(res, 400, "Некорректный документ");
    if (
      b.title !== undefined &&
      (typeof b.title !== "string" || !b.title.trim() || b.title.length > 200)
    )
      return err(res, 400, "Некорректное название");
    if (
      b.thumbnail !== undefined &&
      (typeof b.thumbnail !== "string" ||
        b.thumbnail.length > 400000 ||
        !b.thumbnail.startsWith("data:image/png;base64,"))
    )
      return err(res, 400, "Некорректное превью");
    if (
      b.folder !== undefined &&
      (typeof b.folder !== "string" || b.folder.length > 100)
    )
      return err(res, 400, "Некорректная папка");
    if (b.deleted !== undefined && req.role !== "owner")
      return err(res, 403, "Только владелец может удалять проект");
    db.exec("BEGIN");
    try {
      if (b.document) {
        db.prepare("INSERT INTO versions VALUES(?,?,?,?,?,?)").run(
          id(),
          p.id,
          p.document,
          p.title,
          now(),
          p.revision,
        );
        db.prepare(
          "DELETE FROM versions WHERE project_id=? AND id NOT IN (SELECT id FROM versions WHERE project_id=? ORDER BY revision DESC LIMIT 30)",
        ).run(p.id, p.id);
      }
      db.prepare(
        "UPDATE projects SET title=?,document=?,thumbnail=?,folder=?,favorite=?,deleted=?,revision=revision+1,updated=? WHERE id=?",
      ).run(
        b.title?.trim() || p.title,
        b.document ? JSON.stringify(b.document) : p.document,
        b.thumbnail ?? p.thumbnail,
        b.folder ?? p.folder,
        b.favorite === undefined ? p.favorite : b.favorite ? 1 : 0,
        b.deleted === undefined ? p.deleted : b.deleted ? 1 : 0,
        now(),
        p.id,
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    realtime.restChanged(p.id, b);
    res.json({ revision: p.revision + 1 });
  });
  app.delete("/api/projects/:id", auth, access, owner, (req, res) => {
    db.prepare("DELETE FROM projects WHERE id=?").run(req.project.id);
    realtime.refreshAccess(req.project.id);
    res.json({ ok: true });
  });
  app.get("/api/projects/:id/versions", auth, access, (req, res) =>
    res.json({
      versions: db
        .prepare(
          "SELECT id,title,created,revision FROM versions WHERE project_id=? ORDER BY revision DESC",
        )
        .all(req.project.id),
    }),
  );
  app.get("/api/projects/:id/versions/:version", auth, access, (req, res) => {
    const v = db
      .prepare("SELECT * FROM versions WHERE id=? AND project_id=?")
      .get(req.params.version, req.project.id);
    if (!v) return err(res, 404, "Версия не найдена");
    res.json({ document: JSON.parse(v.document), title: v.title });
  });
  app.get("/api/projects/:id/members", auth, access, (req, res) =>
    res.json({
      members: db
        .prepare(
          "SELECT u.id,u.email,u.name,m.role FROM members m JOIN users u ON u.id=m.user_id WHERE m.project_id=?",
        )
        .all(req.project.id),
    }),
  );
  app.post("/api/projects/:id/members", auth, access, owner, (req, res) => {
    const { email, role } = req.body;
    if (typeof email !== "string" || !["editor", "viewer"].includes(role))
      return err(res, 400, "Укажите email и роль");
    const u = db
      .prepare("SELECT id FROM users WHERE email=?")
      .get(email.toLowerCase().trim());
    if (!u)
      return err(res, 404, "Пользователь должен сначала зарегистрироваться");
    if (u.id === req.user.id) return err(res, 400, "Вы уже владелец");
    db.prepare(
      "INSERT INTO members VALUES(?,?,?) ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role",
    ).run(req.project.id, u.id, role);
    realtime.refreshAccess(req.project.id);
    res.json({ ok: true });
  });
  app.delete(
    "/api/projects/:id/members/:user",
    auth,
    access,
    owner,
    (req, res) => {
      db.prepare("DELETE FROM members WHERE project_id=? AND user_id=?").run(
        req.project.id,
        req.params.user,
      );
      realtime.refreshAccess(req.project.id);
      res.json({ ok: true });
    },
  );
  app.get("/api/projects/:id/comments", auth, access, (req, res) =>
    res.json({
      comments: db
        .prepare(
          "SELECT c.id,c.body,c.created,u.name FROM comments c JOIN users u ON u.id=c.user_id WHERE project_id=? ORDER BY c.created",
        )
        .all(req.project.id),
    }),
  );
  app.post("/api/projects/:id/comments", auth, access, write, (req, res) => {
    const { body } = req.body;
    if (typeof body !== "string" || !body.trim() || body.length > 2000)
      return err(res, 400, "Комментарий: от 1 до 2000 символов");
    db.prepare("INSERT INTO comments VALUES(?,?,?,?,?)").run(
      id(),
      req.project.id,
      req.user.id,
      body.trim(),
      now(),
    );
    res.status(201).json({ ok: true });
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  });
  app.post(
    "/api/assets",
    auth,
    upload.single("file"),
    async (req, res, next) => {
      try {
        if (!req.file) return err(res, 400, "Выберите изображение");
        const aid = id(),
          file = aid + ".png";
        await sharp(req.file.buffer, { limitInputPixels: 25000000 })
          .rotate()
          .resize({
            width: 2400,
            height: 2400,
            fit: "inside",
            withoutEnlargement: true,
          })
          .png()
          .toFile(path.join(dataDir, "uploads", file));
        db.prepare("INSERT INTO assets VALUES(?,?,?,?,?)").run(
          aid,
          req.user.id,
          req.file.originalname.slice(0, 150),
          file,
          now(),
        );
        res.status(201).json({
          asset: {
            id: aid,
            name: req.file.originalname,
            url: "/api/assets/" + aid + "/file",
          },
        });
      } catch (e) {
        if (/Input|unsupported|pixel|corrupt/i.test(String(e)))
          return err(
            res,
            400,
            "Не удалось прочитать изображение. Используйте PNG, JPG или WebP до 10 МБ / 25 Мп.",
          );
        next(e);
      }
    },
  );
  app.get("/api/assets", auth, (req, res) =>
    res.json({
      assets: db
        .prepare(
          "SELECT id,name,created FROM assets WHERE owner_id=? ORDER BY created DESC",
        )
        .all(req.user.id)
        .map((a) => ({ ...a, url: "/api/assets/" + a.id + "/file" })),
    }),
  );
  app.get("/api/assets/:asset/file", auth, (req, res) => {
    const a = db
      .prepare("SELECT * FROM assets WHERE id=? AND owner_id=?")
      .get(req.params.asset, req.user.id);
    if (!a) return err(res, 404, "Изображение не найдено");
    res.sendFile(path.join(dataDir, "uploads", a.file));
  });
  app.use("/api", (_, res) => err(res, 404, "Метод API не найден"));
  if (existsSync(path.join(root, "dist"))) {
    app.use(express.static(path.join(root, "dist")));
    app.get("/{*path}", (_, res) =>
      res.sendFile(path.join(root, "dist", "index.html")),
    );
  }
  app.use((e, req, res, next) => {
    console.error(e.message);
    err(
      res,
      e.status || (e instanceof multer.MulterError ? 400 : 500),
      e instanceof multer.MulterError
        ? "Файл слишком большой (максимум 10 МБ)"
        : "Ошибка сервера",
    );
  });
  return { app, db, realtime };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { app, realtime } = createApp();
  const server = createServer(app);
  realtime.attach(server);
  server.on("error", (error) => {
    console.error("Forma startup failed:", error.code);
    realtime.close();
    process.exitCode = 1;
  });
  server.listen(Number(process.env.PORT || 8192), "0.0.0.0", () =>
    console.log("Forma listening on port " + (process.env.PORT || 8192)),
  );
}
