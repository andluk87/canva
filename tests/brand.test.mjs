import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { randomBytes } from "node:crypto";
import { createApp } from "../server/index.mjs";
import {
  brandSettings,
  brandObjectStyle,
  BRAND_LIMITS,
} from "../shared/brand.mjs";
const dir = mkdtempSync(path.join(os.tmpdir(), "forma-brand-"));
let db, realtime, server, base, owner, other;
const settings = {
  name: "Студия",
  colors: ["#AABBCC", "#112233", "#ffffff"],
  font: "Georgia",
  typography: {
    headingSize: 56,
    bodySize: 22,
    headingWeight: "bold",
    bodyWeight: "normal",
    lineHeight: 1.4,
  },
};
async function request(
  endpoint,
  { cookie = owner, body, method = "GET" } = {},
) {
  const r = await fetch(base + endpoint, {
    method,
    headers: {
      ...(body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...(cookie ? { cookie } : {}),
    },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
  return {
    status: r.status,
    data: await r.json(),
    cookie: r.headers.get("set-cookie")?.split(";")[0],
    cache: r.headers.get("cache-control"),
  };
}
async function create() {
  const r = await request("/brand-kits", { method: "POST", body: settings });
  assert.equal(r.status, 201);
  return r.data.kit;
}
async function upload(kit, buffer, name = "logo.png", cookie = owner) {
  const form = new FormData();
  form.set("revision", String(kit.revision));
  form.set("file", new Blob([buffer]), name);
  return request("/brand-kits/" + kit.id + "/logos", {
    method: "POST",
    body: form,
    cookie,
  });
}
before(async () => {
  ({ db, realtime, app: server } = createApp({ dataDir: dir }));
  server = server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = "http://127.0.0.1:" + server.address().port + "/api";
  for (const name of ["owner", "other"]) {
    const r = await request("/auth/register", {
      method: "POST",
      cookie: null,
      body: {
        email: `brand-${name}@example.test`,
        name,
        password: "brand-testing-password-2026",
      },
    });
    if (name === "owner") owner = r.cookie;
    else other = r.cookie;
  }
});
after(async () => {
  realtime.close();
  await new Promise((resolve) => server.close(resolve));
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
test("brand settings validate exact colors, supported fonts and bounded typography", () => {
  assert.equal(brandSettings(settings).colors[0], "#aabbcc");
  for (const patch of [
    { name: "" },
    { name: "x\n" },
    { name: 123 },
    { colors: [] },
    { colors: ["red"] },
    { colors: [null] },
    { font: "url(https://example.test/font)" },
    { typography: null },
    { typography: { ...settings.typography, bodySize: 201 } },
    { typography: { ...settings.typography, lineHeight: NaN } },
    { typography: { ...settings.typography, headingWeight: "999" } },
  ])
    assert.throws(() => brandSettings({ ...settings, ...patch }));
  const original = structuredClone(settings);
  brandSettings(settings);
  assert.deepEqual(settings, original);
});
test("brand per-object patches preserve images, groups, data and locked objects", () => {
  const brand = brandSettings(settings);
  for (const o of [
    { type: "Image" },
    { type: "Group" },
    { type: "Rect", formaData: {} },
    { type: "Textbox", lockMovementX: true, lockMovementY: true },
  ])
    assert.equal(brandObjectStyle(o, brand), null);
  assert.deepEqual(brandObjectStyle({ type: "Rect", left: 55 }, brand, 2), {
    fill: "#ffffff",
  });
  assert.deepEqual(
    brandObjectStyle({ type: "Textbox", fontSize: 40 }, brand, 0, true),
    {
      fill: "#112233",
      fontFamily: "Georgia",
      fontSize: 56,
      fontWeight: "bold",
      lineHeight: 1.4,
    },
  );
  assert.equal(
    brandObjectStyle({ type: "Textbox", fontSize: 20 }, brand, 0, true)
      .fontSize,
    22,
  );
});
test("brand CRUD is private, no-store and optimistic; list omits image content", async () => {
  const kit = await create();
  assert.equal(kit.revision, 1);
  const list = await request("/brand-kits");
  assert.equal(list.cache, "no-store");
  assert.equal(list.data.kits.find((k) => k.id === kit.id).logos, undefined);
  for (const method of ["GET", "PUT", "DELETE"])
    assert.equal(
      (
        await request("/brand-kits/" + kit.id, {
          cookie: other,
          method,
          ...(method !== "GET" ? { body: { ...settings, revision: 1 } } : {}),
        })
      ).status,
      404,
    );
  assert.equal(
    (await request("/brand-kits/" + kit.id, { cookie: null })).status,
    401,
  );
  const updated = await request("/brand-kits/" + kit.id, {
    method: "PUT",
    body: { ...settings, name: "Новое имя", revision: 1 },
  });
  assert.equal(updated.data.kit.revision, 2);
  assert.equal(
    (
      await request("/brand-kits/" + kit.id, {
        method: "PUT",
        body: { ...settings, revision: 1 },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request("/brand-kits/" + kit.id, {
        method: "DELETE",
        body: { revision: 1 },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request("/brand-kits/" + kit.id, {
        method: "DELETE",
        body: { revision: 2 },
      })
    ).status,
    200,
  );
  assert.equal((await request("/brand-kits/" + kit.id)).status, 404);
});
test("brand activation synchronizes preferences and deletion keeps last applied style", async () => {
  const kit = await create();
  const activate = await request("/brand-kits/" + kit.id + "/activate", {
    method: "POST",
    body: { revision: 1 },
  });
  assert.equal(activate.data.user.brand.kitId, kit.id);
  assert.equal(activate.data.user.brand.font, "Georgia");
  await request("/brand-kits/" + kit.id, {
    method: "PUT",
    body: { ...settings, font: "Verdana", revision: 1 },
  });
  assert.equal((await request("/auth/me")).data.user.brand.font, "Verdana");
  assert.equal(
    (
      await request("/brand-kits/" + kit.id + "/activate", {
        method: "POST",
        body: { revision: 1 },
      })
    ).status,
    409,
  );
  await request("/brand-kits/" + kit.id, {
    method: "DELETE",
    body: { revision: 2 },
  });
  const brand = (await request("/auth/me")).data.user.brand;
  assert.equal(brand.kitId, undefined);
  assert.equal(brand.font, "Verdana");
});
test("logo decoding normalizes actual pixels, rejects SVG/spoofs and enforces ownership", async () => {
  let kit = await create();
  const png = await sharp({
    create: { width: 1600, height: 800, channels: 4, background: "#ff000080" },
  })
    .png()
    .toBuffer();
  assert.equal((await upload(kit, png, "x.png", other)).status, 404);
  for (const buffer of [
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20"/></svg>',
    ),
    Buffer.from("not a png"),
  ])
    assert.equal((await upload(kit, buffer)).status, 400);
  const r = await upload(kit, png, "<logo>.png");
  assert.equal(r.status, 201);
  kit = r.data.kit;
  const logo = kit.logos[0];
  assert.deepEqual([logo.width, logo.height], [1200, 600]);
  const data = Buffer.from(logo.src.split(",")[1], "base64");
  const metadata = await sharp(data).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.exif, undefined);
  const pixel = await sharp(data)
    .extract({ left: 0, top: 0, width: 1, height: 1 })
    .raw()
    .toBuffer();
  assert.ok(
    pixel[0] > 245 && pixel[1] < 10 && pixel[3] > 120 && pixel[3] < 140,
  );
  assert.equal(
    (
      await request("/brand-kits/" + kit.id + "/logos/" + logo.id, {
        method: "DELETE",
        body: { revision: 1 },
      })
    ).status,
    409,
  );
  const removed = await request("/brand-kits/" + kit.id + "/logos/" + logo.id, {
    method: "DELETE",
    body: { revision: kit.revision },
  });
  assert.equal(removed.data.kit.logos.length, 0);
});
test("concurrent logo uploads cannot overwrite each other with the same revision", async () => {
  const kit = await create(),
    png = await sharp({
      create: { width: 20, height: 20, channels: 4, background: "#123456" },
    })
      .png()
      .toBuffer();
  const result = await Promise.all([
    upload(kit, png, "a.png"),
    upload(kit, png, "b.png"),
  ]);
  assert.deepEqual(result.map((r) => r.status).sort(), [201, 409]);
  assert.equal(
    (await request("/brand-kits/" + kit.id)).data.kit.logos.length,
    1,
  );
});
test("logo resource limits reject large uploads, pixel bombs and large normalized PNG without writes", async () => {
  const kit = await create();
  const tooManyPixels = await sharp({
    create: { width: 5001, height: 5000, channels: 3, background: "#ffffff" },
  })
    .png()
    .toBuffer();
  const entropy = await sharp(randomBytes(1200 * 1200 * 4), {
    raw: { width: 1200, height: 1200, channels: 4 },
  })
    .png()
    .toBuffer();
  for (const data of [
    Buffer.alloc(10 * 1024 * 1024 + 1),
    tooManyPixels,
    entropy,
  ])
    assert.equal((await upload(kit, data)).status, 400);
  const unchanged = (await request("/brand-kits/" + kit.id)).data.kit;
  assert.equal(unchanged.revision, 1);
  assert.equal(unchanged.logos.length, 0);
});
test("invalid brand updates leave settings, revision and active preferences intact", async () => {
  const kit = await create();
  await request("/brand-kits/" + kit.id + "/activate", {
    method: "POST",
    body: { revision: 1 },
  });
  for (const patch of [
    { colors: [] },
    { font: "External Font" },
    { typography: { ...settings.typography, bodySize: 0 } },
    { name: null },
  ])
    assert.equal(
      (
        await request("/brand-kits/" + kit.id, {
          method: "PUT",
          body: { ...settings, ...patch, revision: 1 },
        })
      ).status,
      400,
    );
  const unchanged = (await request("/brand-kits/" + kit.id)).data.kit;
  assert.equal(unchanged.revision, 1);
  assert.equal(unchanged.font, "Georgia");
  assert.equal((await request("/auth/me")).data.user.brand.kitId, kit.id);
});
test("brand count, logo count and byte quotas reject without partial writes", async () => {
  const kit = await create();
  const original = db
    .prepare("SELECT * FROM brand_kits WHERE id=?")
    .get(kit.id);
  const fakeLogos = Array.from({ length: BRAND_LIMITS.logos }, (_, i) => ({
    id: String(i),
  }));
  db.prepare("UPDATE brand_kits SET logos=? WHERE id=?").run(
    JSON.stringify(fakeLogos),
    kit.id,
  );
  const png = await sharp({
    create: { width: 1, height: 1, channels: 4, background: "red" },
  })
    .png()
    .toBuffer();
  assert.equal((await upload(kit, png)).status, 409);
  db.prepare("UPDATE brand_kits SET logos=?,bytes=? WHERE id=?").run(
    original.logos,
    BRAND_LIMITS.storageBytes,
    kit.id,
  );
  assert.equal(
    (await request("/brand-kits", { method: "POST", body: settings })).status,
    409,
  );
  db.prepare("UPDATE brand_kits SET bytes=? WHERE id=?").run(
    original.bytes,
    kit.id,
  );
  const ownerId = original.owner_id;
  while (
    db
      .prepare("SELECT COUNT(*) AS n FROM brand_kits WHERE owner_id=?")
      .get(ownerId).n < 20
  )
    await create();
  const count = db.prepare("SELECT COUNT(*) AS n FROM brand_kits").get().n;
  assert.equal(
    (await request("/brand-kits", { method: "POST", body: settings })).status,
    409,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM brand_kits").get().n,
    count,
  );
});
