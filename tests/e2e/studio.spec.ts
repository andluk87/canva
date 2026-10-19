import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
const unique = () =>
  `designer-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
test("AT-01/02/03/06/07/08/09/10/11: real editor, save/reload, undo and exports", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Что создадим сегодня?" }),
  ).toBeVisible();
  await page.screenshot({
    path: "/tmp/forma-home-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Создать дизайн", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Ваше имя").fill("Тестовый дизайнер");
  await dialog.getByLabel("Email", { exact: true }).fill(unique());
  await dialog.getByLabel("Пароль", { exact: true }).fill("correct-horse-2026");
  await dialog.getByRole("button", { name: "Создать аккаунт" }).click();
  await expect(dialog).toHaveCount(0);
  await page.locator(".template-cover").first().click();
  await expect(page.locator(".upper-canvas")).toBeVisible();
  await expect(page.getByLabel("Название проекта")).toHaveValue(
    "Тише. Ближе к природе.",
  );
  const id = new URL(page.url()).searchParams.get("project");
  expect(id).toBeTruthy();
  await page.getByLabel("Название проекта").fill("Мой первый дизайн");
  await page
    .locator(".editor-nav")
    .getByRole("button", { name: "Текст", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Добавить заголовок", exact: true })
    .click();
  await expect(page.getByLabel("Размер шрифта", { exact: true })).toHaveValue(
    "80",
  );
  await page.getByLabel("Размер шрифта", { exact: true }).fill("72");
  const box = (await page.locator(".upper-canvas").boundingBox())!;
  await page
    .locator(".upper-canvas")
    .dblclick({ position: { x: box.width * 0.18, y: box.height * 0.23 } });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Hello Forma");
  await page.keyboard.press("Escape");
  await page.locator(".editor-panel-heading").click();
  await expect
    .poll(
      async () => {
        const d = await (await page.request.get("/api/projects/" + id)).json();
        return d.project.document.pages[0].canvas.objects.some(
          (o: any) => o.text === "Hello Forma",
        );
      },
      { timeout: 15000 },
    )
    .toBe(true);
  await page
    .locator(".editor-nav")
    .getByRole("button", { name: "Элементы", exact: true })
    .click();
  await page.getByLabel("Добавить circle", { exact: true }).click();
  await page.getByLabel("Поворот", { exact: true }).fill("23");
  await expect
    .poll(async () => {
      const d = await (await page.request.get("/api/projects/" + id)).json();
      return d.project.document.pages[0].canvas.objects.some(
        (o: any) => o.type === "Circle" && o.angle === 23,
      );
    })
    .toBe(true);
  await page.getByLabel("Отменить", { exact: true }).click();
  await page.getByLabel("Повторить", { exact: true }).click();
  await page
    .getByRole("button", { name: "Добавить страницу", exact: true })
    .click();
  await expect(page.locator(".page-controls")).toContainText("Страница 2 из 2");
  await page
    .locator(".editor-nav")
    .getByRole("button", { name: "Текст", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Добавить основной текст", exact: true })
    .click();
  await expect
    .poll(async () => {
      const d = await (await page.request.get("/api/projects/" + id)).json();
      return d.project.document.pages.length;
    })
    .toBe(2);
  await expect(page.locator(".save-status")).toContainText("Сохранено");
  await page.reload();
  await expect(page.locator(".upper-canvas")).toBeVisible();
  await expect(page.getByLabel("Название проекта")).toHaveValue(
    "Мой первый дизайн",
  );
  await expect(page.locator(".page-controls")).toContainText("из 2");
  await page.screenshot({
    path: "/tmp/forma-editor-desktop.png",
    fullPage: true,
  });
  for (const format of ["png", "jpg", "pdf", "json"]) {
    await page.getByRole("button", { name: "Скачать", exact: true }).click();
    const modal = page.getByRole("dialog");
    await modal.getByLabel("Формат файла").selectOption(format);
    const downloadPromise = page.waitForEvent("download");
    await modal.getByRole("button", { name: "Скачать", exact: true }).click();
    const file = await downloadPromise;
    const contents = await readFile((await file.path())!);
    if (format === "png" || format === "jpg") {
      const meta = await sharp(contents).metadata();
      expect(meta.width).toBe(1080);
      expect(meta.height).toBe(1080);
      expect(meta.format).toBe(format === "jpg" ? "jpeg" : "png");
    } else if (format === "pdf") {
      expect(contents.subarray(0, 5).toString()).toBe("%PDF-");
      expect(contents.toString("latin1")).toContain("/Count 2");
    } else {
      expect(JSON.parse(contents.toString()).document.pages).toHaveLength(2);
    }
    await expect(modal).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});
test("AT-04/05/17: upload image, transform, group/ungroup and brand persistence", async ({
  page,
}) => {
  const email = unique();
  await page.request.post("/api/auth/register", {
    data: { email, name: "Media designer", password: "correct-horse-2026" },
  });
  await page.request.put("/api/brand", {
    data: {
      name: "Brand",
      colors: ["#f01234", "#212121", "#fafafa"],
      font: "Georgia",
    },
  });
  const created = await (
    await page.request.post("/api/projects", {
      data: { title: "Media project", width: 800, height: 800 },
    })
  ).json();
  const id = created.project.id;
  await page.goto("/?project=" + id);
  await expect(page.locator(".upper-canvas")).toBeVisible();
  await page
    .locator(".editor-nav")
    .getByRole("button", { name: "Загрузки", exact: true })
    .click();
  const buffer = await sharp({
    create: { width: 100, height: 60, channels: 3, background: "#f01234" },
  })
    .png()
    .toBuffer();
  await page
    .locator(".editor-panel input[type=file]")
    .setInputFiles({ name: "test.png", mimeType: "image/png", buffer });
  await expect
    .poll(async () => {
      const d = await (await page.request.get("/api/projects/" + id)).json();
      return d.project.document.pages[0].canvas.objects.filter(
        (o: any) => o.type === "Image",
      ).length;
    })
    .toBe(1);
  await page.getByLabel("Поворот", { exact: true }).fill("42");
  await page.getByRole("button", { name: "Отразить по горизонтали" }).click();
  await page
    .locator(".editor-nav")
    .getByRole("button", { name: "Элементы", exact: true })
    .click();
  await page.getByLabel("Добавить rect", { exact: true }).click();
  await page.getByLabel("Положение X", { exact: true }).fill("30");
  await page.getByLabel("Положение Y", { exact: true }).fill("30");
  await expect
    .poll(async () => {
      const d = await (await page.request.get("/api/projects/" + id)).json();
      return d.project.document.pages[0].canvas.objects.length;
    })
    .toBe(2);
  await page.getByRole("button", { name: "Слои", exact: true }).click();
  await page.locator(".layer-name").filter({ hasText: "Изображение" }).click();
  await page.getByLabel("Дублировать объект", { exact: true }).click();
  await expect
    .poll(async () => {
      const d = await (await page.request.get("/api/projects/" + id)).json();
      return d.project.document.pages[0].canvas.objects.length;
    })
    .toBe(3);
  await page.getByLabel("Удалить объект", { exact: true }).click();
  await expect
    .poll(async () => {
      const d = await (await page.request.get("/api/projects/" + id)).json();
      return d.project.document.pages[0].canvas.objects.length;
    })
    .toBe(2);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+g");
  await expect
    .poll(async () => {
      const d = await (await page.request.get("/api/projects/" + id)).json();
      return d.project.document.pages[0].canvas.objects.map((o: any) => o.type);
    })
    .toEqual(["Group"]);
  await page.keyboard.press("ControlOrMeta+Shift+g");
  await expect
    .poll(async () => {
      const d = await (await page.request.get("/api/projects/" + id)).json();
      return d.project.document.pages[0].canvas.objects.length;
    })
    .toBe(2);
  await page
    .locator(".editor-nav")
    .getByRole("button", { name: "Фон", exact: true })
    .click();
  await page.getByRole("button", { name: "Применить стиль бренда" }).click();
  await expect
    .poll(async () => {
      const d = await (await page.request.get("/api/projects/" + id)).json();
      return d.project.document.pages[0].canvas.objects.find(
        (o: any) => o.type === "Rect",
      )?.fill;
    })
    .toBe("#212121");
});
test("AT-23 mobile: registration, custom dimensions, editing controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.screenshot({ path: "/tmp/forma-home-mobile.png", fullPage: true });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.getByRole("button", { name: "Меню", exact: true }).click();
  await page
    .getByRole("button", { name: "Создать дизайн", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Ваше имя").fill("Mobile");
  await dialog.getByLabel("Email", { exact: true }).fill(unique());
  await dialog.getByLabel("Пароль", { exact: true }).fill("correct-horse-2026");
  await dialog.getByRole("button", { name: "Создать аккаунт" }).click();
  await expect(dialog).toHaveCount(0);
  await page
    .getByRole("button", { name: "Создать дизайн", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Ширина", { exact: true })
    .fill("800");
  await page
    .getByRole("dialog")
    .getByLabel("Высота", { exact: true })
    .fill("600");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Создать дизайн", exact: true })
    .click();
  await expect(page.locator(".upper-canvas")).toBeVisible();
  await page.getByRole("button", { name: "Скрыть панель" }).click();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({
    path: "/tmp/forma-editor-mobile.png",
    fullPage: true,
  });
});
