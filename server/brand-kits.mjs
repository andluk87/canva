import { randomBytes } from "node:crypto";
import multer from "multer";
import sharp from "sharp";
import { brandSettings, BRAND_LIMITS } from "../shared/brand.mjs";
const problem = (status, message) =>
  Object.assign(new Error(message), { status });
export function registerBrandKits(app, { db, auth, safeUser }) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS brand_kits(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,settings TEXT NOT NULL,logos TEXT NOT NULL DEFAULT '[]',bytes INTEGER NOT NULL,revision INTEGER NOT NULL DEFAULT 1,created TEXT NOT NULL,updated TEXT NOT NULL);CREATE INDEX IF NOT EXISTS brand_kits_owner ON brand_kits(owner_id,updated);`,
  );
  const find = db.prepare("SELECT * FROM brand_kits WHERE id=? AND owner_id=?");
  const usage = (owner) =>
    db
      .prepare(
        "SELECT COUNT(*) AS count,COALESCE(SUM(bytes),0) AS storageBytes FROM brand_kits WHERE owner_id=?",
      )
      .get(owner);
  const full = (row) => ({
    id: row.id,
    ...JSON.parse(row.settings),
    logos: JSON.parse(row.logos),
    revision: row.revision,
    created: row.created,
    updated: row.updated,
  });
  const owned = (req) => {
    const row = find.get(req.params.id, req.user.id);
    if (!row) throw problem(404, "Бренд-набор не найден");
    return row;
  };
  const revision = (value, row) => {
    if (!Number.isInteger(value) || value < 1)
      throw problem(400, "Укажите текущую версию бренд-набора");
    if (value !== row.revision)
      throw problem(
        409,
        "Бренд изменён в другой вкладке. Обновите библиотеку перед сохранением.",
      );
  };
  const noCache = (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  };
  function quota(owner, bytes, old) {
    const u = usage(owner);
    if (!old && u.count >= BRAND_LIMITS.kits)
      throw problem(409, "Можно сохранить до 20 брендов");
    if (u.storageBytes - (old?.bytes || 0) + bytes > BRAND_LIMITS.storageBytes)
      throw problem(409, "Библиотека брендов превышает 30 МиБ");
  }
  const activeBrand = (row) => {
    const kit = full(row);
    return { ...JSON.parse(row.settings), kitId: kit.id };
  };
  function update(row, settings, logos) {
    const settingsJSON = JSON.stringify(settings),
      logosJSON = JSON.stringify(logos),
      bytes = Buffer.byteLength(settingsJSON) + Buffer.byteLength(logosJSON);
    quota(row.owner_id, bytes, row);
    db.prepare(
      "UPDATE brand_kits SET settings=?,logos=?,bytes=?,revision=revision+1,updated=? WHERE id=?",
    ).run(settingsJSON, logosJSON, bytes, new Date().toISOString(), row.id);
    const current = find.get(row.id, row.owner_id),
      brand = JSON.parse(
        db.prepare("SELECT brand FROM users WHERE id=?").get(row.owner_id)
          .brand,
      );
    if (brand.kitId === row.id)
      db.prepare("UPDATE users SET brand=? WHERE id=?").run(
        JSON.stringify(activeBrand(current)),
        row.owner_id,
      );
    return { kit: full(current) };
  }
  function transaction(req, res, next, fn) {
    let started = false;
    try {
      db.exec("BEGIN IMMEDIATE");
      started = true;
      const result = fn();
      db.exec("COMMIT");
      started = false;
      res.status(result.status || 200).json(result.body ?? result);
    } catch (e) {
      if (started) db.exec("ROLLBACK");
      if (e.status) res.status(e.status).json({ error: e.message });
      else next(e);
    }
  }
  function validated(value) {
    try {
      return brandSettings(value);
    } catch (e) {
      throw problem(400, e.message);
    }
  }
  app.get("/api/brand-kits", auth, noCache, (req, res) => {
    const kits = db
      .prepare(
        "SELECT * FROM brand_kits WHERE owner_id=? ORDER BY updated DESC,id",
      )
      .all(req.user.id)
      .map((row) => {
        const kit = full(row);
        return {
          id: kit.id,
          name: kit.name,
          colors: kit.colors,
          font: kit.font,
          logoCount: kit.logos.length,
          revision: kit.revision,
          updated: kit.updated,
        };
      });
    res.json({ kits, usage: usage(req.user.id), limits: BRAND_LIMITS });
  });
  app.post("/api/brand-kits", auth, noCache, (req, res, next) =>
    transaction(req, res, next, () => {
      const settings = validated(req.body),
        serialized = JSON.stringify(settings),
        bytes = Buffer.byteLength(serialized) + 2;
      quota(req.user.id, bytes);
      const id = randomBytes(16).toString("hex"),
        now = new Date().toISOString();
      db.prepare(
        "INSERT INTO brand_kits(id,owner_id,settings,bytes,created,updated) VALUES(?,?,?,?,?,?)",
      ).run(id, req.user.id, serialized, bytes, now, now);
      return { status: 201, body: { kit: full(find.get(id, req.user.id)) } };
    }),
  );
  app.get("/api/brand-kits/:id", auth, noCache, (req, res) => {
    const row = find.get(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: "Бренд-набор не найден" });
    res.json({ kit: full(row) });
  });
  app.put("/api/brand-kits/:id", auth, noCache, (req, res, next) =>
    transaction(req, res, next, () => {
      const row = owned(req);
      revision(req.body?.revision, row);
      return update(row, validated(req.body), JSON.parse(row.logos));
    }),
  );
  app.delete("/api/brand-kits/:id", auth, noCache, (req, res, next) =>
    transaction(req, res, next, () => {
      const row = owned(req);
      revision(req.body?.revision, row);
      db.prepare("DELETE FROM brand_kits WHERE id=?").run(row.id);
      const brand = JSON.parse(
        db.prepare("SELECT brand FROM users WHERE id=?").get(req.user.id).brand,
      );
      // Keep the last applied palette as a standalone legacy preference; existing designs are independent.
      if (brand.kitId === row.id) {
        delete brand.kitId;
        db.prepare("UPDATE users SET brand=? WHERE id=?").run(
          JSON.stringify(brand),
          req.user.id,
        );
      }
      return { ok: true };
    }),
  );
  app.post("/api/brand-kits/:id/activate", auth, noCache, (req, res, next) =>
    transaction(req, res, next, () => {
      const row = owned(req);
      revision(req.body?.revision, row);
      db.prepare("UPDATE users SET brand=? WHERE id=?").run(
        JSON.stringify(activeBrand(row)),
        req.user.id,
      );
      return {
        user: safeUser(
          db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id),
        ),
      };
    }),
  );
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 1 },
  }).single("file");
  // Check ownership before buffering/decoding, then re-read revision after asynchronous image work.
  app.post(
    "/api/brand-kits/:id/logos",
    auth,
    noCache,
    (req, res, next) => {
      try {
        owned(req);
        next();
      } catch (e) {
        res.status(e.status).json({ error: e.message });
      }
    },
    upload,
    async (req, res, next) => {
      try {
        if (!req.file) throw problem(400, "Выберите логотип PNG, JPG или WebP");
        const initial = owned(req);
        const rev = Number(req.body?.revision);
        revision(rev, initial);
        if (JSON.parse(initial.logos).length >= BRAND_LIMITS.logos)
          throw problem(409, "В одном бренде допустимо до 10 логотипов");
        let data, info;
        try {
          const image = sharp(req.file.buffer, {
            limitInputPixels: 25_000_000,
            animated: false,
          });
          const metadata = await image.metadata();
          if (
            !["png", "jpeg", "webp"].includes(metadata.format) ||
            metadata.pages > 1
          )
            throw new Error("unsupported");
          ({ data, info } = await image
            .rotate()
            .resize({
              width: 1200,
              height: 1200,
              fit: "inside",
              withoutEnlargement: true,
            })
            .png()
            .toBuffer({ resolveWithObject: true }));
        } catch {
          throw problem(
            400,
            "Логотип: PNG, JPG или WebP до 10 МиБ / 25 Мп; без анимации",
          );
        }
        if (data.length > BRAND_LIMITS.logoBytes)
          throw problem(
            400,
            "Логотип после обработки превышает 1 МиБ. Уменьшите изображение",
          );
        transaction(req, res, next, () => {
          const row = owned(req);
          revision(rev, row);
          const logos = JSON.parse(row.logos);
          if (logos.length >= BRAND_LIMITS.logos)
            throw problem(409, "В одном бренде допустимо до 10 логотипов");
          logos.push({
            id: randomBytes(16).toString("hex"),
            name:
              req.file.originalname
                .replace(/[\u0000-\u001f\u007f]/g, "")
                .slice(0, 150) || "Логотип",
            src: "data:image/png;base64," + data.toString("base64"),
            width: info.width,
            height: info.height,
          });
          return {
            status: 201,
            body: update(row, JSON.parse(row.settings), logos),
          };
        });
      } catch (e) {
        if (e.status) res.status(e.status).json({ error: e.message });
        else next(e);
      }
    },
  );
  app.delete(
    "/api/brand-kits/:id/logos/:logoId",
    auth,
    noCache,
    (req, res, next) =>
      transaction(req, res, next, () => {
        const row = owned(req);
        revision(req.body?.revision, row);
        const logos = JSON.parse(row.logos),
          remaining = logos.filter((l) => l.id !== req.params.logoId);
        if (remaining.length === logos.length)
          throw problem(404, "Логотип не найден");
        return update(row, JSON.parse(row.settings), remaining);
      }),
  );
}
