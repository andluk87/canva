import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
const settings = {
  name: "Студия Север",
  colors: ["#e02030", "#123456", "#fff2cc"],
  font: "Georgia",
  typography: {
    headingSize: 54,
    bodySize: 22,
    headingWeight: "bold",
    bodyWeight: "normal",
    lineHeight: 1.4,
  },
};
async function register(page: Page, suffix = "") {
  const email = `brand-ui-${Date.now()}-${Math.random().toString(16).slice(2)}${suffix}@example.test`;
  expect(
    (
      await page.request.post("/api/auth/register", {
        data: {
          email,
          name: "Brand designer",
          password: "brand-browser-password-2026",
        },
      })
    ).ok(),
  ).toBe(true);
  return email;
}
async function kitWithLogo(page: Page) {
  let kit = (
    await (
      await page.request.post("/api/brand-kits", { data: settings })
    ).json()
  ).kit;
  const png = await sharp({
    create: { width: 100, height: 50, channels: 4, background: "#00aa44" },
  })
    .png()
    .toBuffer();
  const r = await page.request.post("/api/brand-kits/" + kit.id + "/logos", {
    multipart: {
      revision: String(kit.revision),
      file: { name: "north.png", mimeType: "image/png", buffer: png },
    },
  });
  expect(r.status()).toBe(201);
  return (await r.json()).kit;
}
test("brand library: multiple brands, typography, logo upload, activation and optimistic conflict", async ({
  page,
}) => {
  await register(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Бренд", exact: true }).click();
  await page
    .getByRole("button", { name: "Создать бренд", exact: true })
    .click();
  let dialog = page.getByRole("dialog", { name: "Создать бренд", exact: true });
  await dialog
    .getByLabel("Название бренда", { exact: true })
    .fill("Студия Север");
  await dialog
    .getByLabel("Шрифт бренда", { exact: true })
    .selectOption("Georgia");
  await dialog.getByLabel("Размер заголовка", { exact: true }).fill("54");
  await dialog
    .getByLabel("Размер основного текста", { exact: true })
    .fill("22");
  const created = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/brand-kits") && r.request().method() === "POST",
  );
  await dialog
    .getByRole("button", { name: "Сохранить бренд-набор", exact: true })
    .click();
  const kit = (await (await created).json()).kit;
  await expect(page.locator(".brand-detail h2")).toHaveText("Студия Север");
  const logo = await sharp({
    create: { width: 80, height: 40, channels: 4, background: "#00aa44" },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel("Загрузить логотип бренда", { exact: true })
    .setInputFiles({ name: "north.png", mimeType: "image/png", buffer: logo });
  await expect(page.locator(".brand-logo-grid img")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Использовать по умолчанию", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Используется по умолчанию",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Создать бренд", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Создать бренд", exact: true });
  await dialog
    .getByLabel("Название бренда", { exact: true })
    .fill("Второй бренд");
  await dialog
    .getByRole("button", { name: "Сохранить бренд-набор", exact: true })
    .click();
  await expect(page.locator(".brand-detail h2")).toHaveText("Второй бренд");
  await expect(page.locator(".brand-list>button")).toHaveCount(2);
  await page
    .locator(".brand-list>button")
    .filter({ hasText: "Студия Север" })
    .click();
  await expect(page.locator(".brand-logo-grid img")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Редактировать бренд", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Редактировать бренд",
    exact: true,
  });
  const current = (
    await (await page.request.get("/api/brand-kits/" + kit.id)).json()
  ).kit;
  await page.request.put("/api/brand-kits/" + kit.id, {
    data: { ...current, name: "Изменено в другой вкладке" },
  });
  await dialog
    .getByLabel("Название бренда", { exact: true })
    .fill("Не перезаписывать");
  await dialog
    .getByRole("button", { name: "Сохранить бренд-набор", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("другой вкладке");
  await dialog.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page
    .getByRole("button", { name: "Обновить библиотеку брендов", exact: true })
    .click();
  await expect(page.locator(".brand-detail h2")).toHaveText(
    "Изменено в другой вкладке",
  );
  await expect(page.locator(".brand-detail")).toContainText("north.png");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Бренд", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Бренд", exact: true }).click();
  await expect(page.locator(".brand-list")).toContainText(
    "Изменено в другой вкладке",
  );
  await expect(page.locator(".brand-list")).toContainText("Второй бренд");
});
test("brand editor: nested text, typography, locked/data preservation, real logo pixels and one-step undo", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await register(page);
  let kit = await kitWithLogo(page);
  const objects = [
    {
      id: "heading",
      type: "Textbox",
      text: "Заголовок",
      fontFamily: "Arial",
      fontSize: 40,
      left: 10,
      top: 5,
      width: 300,
      fill: "#111111",
    },
    {
      id: "body",
      type: "Textbox",
      text: "Основной текст",
      fontFamily: "Arial",
      fontSize: 20,
      left: 10,
      top: 100,
      width: 280,
      fill: "#222222",
    },
    {
      id: "shape",
      type: "Rect",
      left: 200,
      top: 180,
      width: 80,
      height: 70,
      fill: "#333333",
    },
    {
      id: "locked",
      type: "Rect",
      left: 330,
      top: 180,
      width: 50,
      height: 50,
      fill: "#444444",
      lockMovementX: true,
      lockMovementY: true,
    },
    {
      id: "group",
      type: "Group",
      left: 10,
      top: 220,
      objects: [
        {
          id: "nested",
          type: "Textbox",
          text: "В группе",
          fontSize: 16,
          width: 150,
          left: 0,
          top: 0,
          fill: "#555555",
        },
      ],
    },
    {
      id: "data",
      type: "Group",
      left: 300,
      top: 100,
      formaData: { kind: "test" },
      objects: [
        {
          id: "data-shape",
          type: "Rect",
          width: 30,
          height: 30,
          left: 0,
          top: 0,
          fill: "#abcdef",
        },
      ],
    },
  ];
  const { project } = await (
    await page.request.post("/api/projects", {
      data: {
        title: "Brand proof",
        width: 400,
        height: 300,
        document: {
          pages: [
            {
              id: "page",
              notes: "Keep",
              canvas: { background: "#ffffff", objects },
            },
          ],
        },
      },
    })
  ).json();
  const saved = async () =>
    (await (await page.request.get("/api/projects/" + project.id)).json())
      .project.document.pages[0];
  await page.goto("/?project=" + project.id);
  await expect(page.locator(".live-presence")).toContainText("онлайн");
  await page
    .locator(".editor-nav")
    .getByRole("button", { name: "Бренд", exact: true })
    .click();
  await page.getByLabel("Бренд дизайна", { exact: true }).selectOption(kit.id);
  await expect(page.locator(".brand-editor-panel")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page
    .getByLabel("Применять размеры и начертания бренда", { exact: true })
    .check();
  await page.getByLabel("Применять фон бренда", { exact: true }).check();
  await page
    .getByRole("button", { name: "Применить бренд к странице", exact: true })
    .click();
  await expect
    .poll(async () => {
      const p = await saved();
      return [
        p.canvas.background,
        p.canvas.objects[0].fontFamily,
        p.canvas.objects[0].fontSize,
        p.canvas.objects[1].fontSize,
      ];
    })
    .toEqual(["#fff2cc", "Georgia", 54, 22]);
  let p = await saved();
  expect(p.notes).toBe("Keep");
  expect(p.canvas.objects.find((o: any) => o.id === "locked").fill).toBe(
    "#444444",
  );
  expect(
    p.canvas.objects.find((o: any) => o.id === "data").objects[0].fill,
  ).toBe("#abcdef");
  expect(
    p.canvas.objects.find((o: any) => o.id === "group").objects[0].fontFamily,
  ).toBe("Georgia");
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect
    .poll(async () => {
      const p = await saved();
      return [
        p.canvas.background,
        p.canvas.objects[0].fontFamily,
        p.canvas.objects[0].fontSize,
        p.canvas.objects[1].fontSize,
      ];
    })
    .toEqual(["#ffffff", "Arial", 40, 20]);
  await page
    .getByRole("button", { name: "Вставить логотип north.png", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await saved()).canvas.objects.filter((o: any) => o.type === "Image")
          .length,
    )
    .toBe(1);
  const inserted = (await saved()).canvas.objects.find(
    (o: any) => o.type === "Image",
  );
  expect(inserted.src).toMatch(/^data:image\/png;base64,/);
  expect(
    (
      await page.request.delete("/api/brand-kits/" + kit.id, {
        data: { revision: kit.revision },
      })
    ).ok(),
  ).toBe(true);
  await page.reload();
  await expect(page.locator(".live-presence")).toContainText("онлайн");
  await page.getByRole("button", { name: "Скачать", exact: true }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("dialog", { name: "Скачать дизайн" })
    .getByRole("button", { name: "Скачать", exact: true })
    .click();
  const file = await download;
  const pixel = await sharp(await readFile((await file.path())!))
    .extract({ left: 50, top: 40, width: 1, height: 1 })
    .raw()
    .toBuffer();
  expect([...pixel.subarray(0, 3)]).toEqual([0, 170, 68]);
  expect(errors).toEqual([]);
});
test("brand editor: selection applies independently and viewer controls cannot mutate project", async ({
  page,
  browser,
}) => {
  await register(page);
  const kit = await kitWithLogo(page);
  const { project } = await (
    await page.request.post("/api/projects", {
      data: {
        title: "Selection brand",
        width: 400,
        height: 300,
        document: {
          pages: [
            {
              id: "page",
              canvas: {
                objects: [
                  {
                    id: "one",
                    type: "Rect",
                    left: 40,
                    top: 40,
                    width: 80,
                    height: 80,
                    fill: "#111111",
                  },
                  {
                    id: "two",
                    type: "Rect",
                    left: 200,
                    top: 40,
                    width: 80,
                    height: 80,
                    fill: "#222222",
                  },
                ],
              },
            },
          ],
        },
      },
    })
  ).json();
  await page.goto("/?project=" + project.id);
  await expect(page.locator(".live-presence")).toContainText("онлайн");
  await page
    .locator(".editor-nav")
    .getByRole("button", { name: "Бренд", exact: true })
    .click();
  await page.getByLabel("Бренд дизайна", { exact: true }).selectOption(kit.id);
  const canvas = page.locator(".upper-canvas");
  const box = (await canvas.boundingBox())!;
  const zoom = box.width / 400;
  await canvas.click({ position: { x: 80 * zoom, y: 80 * zoom } });
  await page
    .getByRole("button", { name: "Применить бренд к выделению", exact: true })
    .click();
  await expect
    .poll(async () => {
      const p = (
        await (await page.request.get("/api/projects/" + project.id)).json()
      ).project;
      return p.document.pages[0].canvas.objects.map((o: any) => o.fill);
    })
    .toEqual(["#e02030", "#222222"]);
  const context = await browser.newContext();
  const viewer = await context.newPage();
  const email = await register(viewer, "-viewer");
  expect(
    (
      await page.request.post("/api/projects/" + project.id + "/members", {
        data: { email, role: "viewer" },
      })
    ).ok(),
  ).toBe(true);
  await viewer.goto("/?project=" + project.id);
  await expect(viewer.locator(".live-presence")).toContainText("онлайн");
  await viewer
    .locator(".editor-nav")
    .getByRole("button", { name: "Бренд", exact: true })
    .click();
  await expect(
    viewer.getByRole("button", {
      name: "Применить бренд к странице",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    viewer.getByRole("button", {
      name: "Применить бренд к выделению",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    viewer.getByLabel("Применять фон бренда", { exact: true }),
  ).toBeDisabled();
  await context.close();
});

test("brand logo: delayed decoding cannot insert into a different page", async ({
  page,
}) => {
  await register(page);
  const kit = await kitWithLogo(page);
  const { project } = await (
    await page.request.post("/api/projects", {
      data: {
        title: "Delayed logo",
        width: 400,
        height: 300,
        document: {
          pages: [
            { id: "one", canvas: { objects: [] } },
            { id: "two", canvas: { objects: [] } },
          ],
        },
      },
    })
  ).json();
  await page.goto("/?project=" + project.id);
  await expect(page.locator(".live-presence")).toContainText("онлайн");
  await page
    .locator(".editor-nav")
    .getByRole("button", { name: "Бренд", exact: true })
    .click();
  await page.getByLabel("Бренд дизайна", { exact: true }).selectOption(kit.id);
  await expect(page.locator(".brand-editor-panel")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.evaluate(() => {
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLImageElement.prototype,
      "src",
    )!;
    const setter = descriptor.set!;
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      ...descriptor,
      set(value: string) {
        if (
          value.startsWith("data:image/png") &&
          !(window as any).releaseBrandLogo
        ) {
          const target = this;
          (window as any).releaseBrandLogo = () => {
            Object.defineProperty(
              HTMLImageElement.prototype,
              "src",
              descriptor,
            );
            setter.call(target, value);
          };
        } else setter.call(this, value);
      },
    });
  });
  await page
    .getByRole("button", { name: "Вставить логотип north.png", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).releaseBrandLogo))
    .toBe("function");
  await page
    .getByRole("button", { name: "Следующая страница", exact: true })
    .click();
  await expect(page.locator(".page-caption")).toContainText("Страница 2");
  await page.evaluate(() => (window as any).releaseBrandLogo());
  await expect(page.locator(".brand-editor-panel")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  // A real edit flushes the current page so absence is checked after the delayed task completes.
  await page
    .locator(".editor-nav")
    .getByRole("button", { name: "Элементы", exact: true })
    .click();
  await page.getByLabel("Добавить circle", { exact: true }).click();
  await expect
    .poll(async () => {
      const p = (
        await (await page.request.get("/api/projects/" + project.id)).json()
      ).project;
      return p.document.pages.map((p: any) =>
        p.canvas.objects.map((o: any) => o.type),
      );
    })
    .toEqual([[], ["Circle"]]);
});

test("brand picker: failed selection cannot apply the previously selected brand", async ({
  page,
}) => {
  await register(page);
  const first = await kitWithLogo(page);
  const second = (
    await (
      await page.request.post("/api/brand-kits", {
        data: { ...settings, name: "Другой бренд", font: "Verdana" },
      })
    ).json()
  ).kit;
  const { project } = await (
    await page.request.post("/api/projects", {
      data: { title: "Unavailable brand", width: 400, height: 300 },
    })
  ).json();
  await page.goto("/?project=" + project.id);
  await expect(page.locator(".live-presence")).toContainText("онлайн");
  await page
    .locator(".editor-nav")
    .getByRole("button", { name: "Бренд", exact: true })
    .click();
  await page
    .getByLabel("Бренд дизайна", { exact: true })
    .selectOption(first.id);
  await expect(
    page.getByRole("button", {
      name: "Вставить логотип north.png",
      exact: true,
    }),
  ).toBeVisible();
  await page.route("**/api/brand-kits/" + second.id, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Бренд временно недоступен" }),
    }),
  );
  await page
    .getByLabel("Бренд дизайна", { exact: true })
    .selectOption(second.id);
  await expect(
    page.locator(".brand-editor-panel").getByRole("alert"),
  ).toContainText("временно недоступен");
  await expect(
    page.getByRole("button", {
      name: "Применить бренд к странице",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", {
      name: "Вставить логотип north.png",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.unroute("**/api/brand-kits/" + second.id);
  await page
    .getByRole("button", { name: "Обновить бренды", exact: true })
    .click();
  await expect(page.locator(".brand-editor-panel>strong")).toHaveText(
    "Другой бренд",
  );
  await expect(
    page.getByRole("button", {
      name: "Применить бренд к странице",
      exact: true,
    }),
  ).toBeEnabled();
});
