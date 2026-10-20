import { test, expect, type Page, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";
import sharp from "sharp";

async function project(page: Page, objects: any[] = [], width = 800, height = 600) {
  const response = await page.request.post("/api/auth/register", { data: {
    name: "Advanced designer", email: `advanced-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`,
    password: "advanced-design-password-2026",
  } });
  expect(response.ok()).toBeTruthy();
  const created = await page.request.post("/api/projects", { data: {
    title: "Advanced tools", width, height,
    document: { pages: [{ id: "page-advanced", canvas: { background: "#ffffff", objects } }] },
  } });
  expect(created.ok()).toBeTruthy();
  const id = (await created.json()).project.id;
  await page.goto("/?project=" + id);
  await expect(page.locator(".upper-canvas")).toBeVisible();
  await expect(page.locator(".save-status")).toContainText("Сохранено");
  return id as string;
}
async function tools(page: Page) {
  await page.locator(".editor-nav").getByRole("button", { name: "Инструменты", exact: true }).click();
  await expect(page.getByTestId("advanced-tools")).toBeVisible();
}
async function objects(page: Page, id: string) {
  return (await (await page.request.get("/api/projects/" + id)).json()).project.document.pages[0].canvas.objects;
}
async function range(locator: Locator, value: number) {
  await locator.evaluate((element, number) => {
    const input = element as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, String(number));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

test("AT-advanced: gradient, stroke, round corners, shadow, alignment, persistence and full-size SVG", async ({ page }) => {
  const id = await project(page);
  await page.locator(".editor-nav").getByRole("button", { name: "Элементы", exact: true }).click();
  await page.getByLabel("Добавить rect", { exact: true }).click();
  await tools(page);
  const panel = page.getByTestId("advanced-tools");
  await panel.getByLabel("Первый цвет градиента").fill("#123456");
  await panel.getByLabel("Второй цвет градиента").fill("#fedcba");
  await panel.getByLabel("Угол градиента").fill("90");
  await panel.getByRole("button", { name: "Применить градиент", exact: true }).click();
  await panel.getByLabel("Толщина обводки", { exact: true }).fill("5");
  await panel.getByLabel("Пунктирная обводка").check();
  await panel.getByLabel("Скругление углов", { exact: true }).fill("24");
  await panel.getByLabel("Включить тень", { exact: true }).check();
  await panel.getByLabel("Размытие тени", { exact: true }).fill("16");
  await panel.getByLabel("Смещение тени X", { exact: true }).fill("-6");
  await panel.getByRole("button", { name: "Выровнять слева", exact: true }).click();
  await expect.poll(async () => {
    const object = (await objects(page, id))[0];
    return {
      gradient: object?.fill?.colorStops?.map((stop: any) => stop.color),
      strokeWidth: object?.strokeWidth, dash: object?.strokeDashArray,
      rx: object?.rx, ry: object?.ry, shadow: object?.shadow?.offsetX,
      shadowBlur: object?.shadow?.blur, left: object?.left,
    };
  }).toEqual({ gradient: ["#123456", "#fedcba"], strokeWidth: 5, dash: [8, 5], rx: 24, ry: 24, shadow: -6, shadowBlur: 16, left: 0 });
  const download = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Скачать страницу SVG", exact: true }).click();
  const source = await readFile((await (await download).path())!, "utf8");
  expect(source).toContain('width="800"');
  expect(source).toContain('height="600"');
  expect(source).toContain("linearGradient");
  expect(source).toContain("stroke-dasharray: 8 5");
  expect(source).toContain("rx=\"24\"");
  expect((await sharp(Buffer.from(source)).metadata()).width).toBe(800);
  await page.reload();
  await expect(page.locator(".upper-canvas")).toBeVisible();
  await page.locator(".editor-nav").getByRole("button", { name: "Слои", exact: true }).click();
  await page.locator(".layer-name").filter({ hasText: "Прямоугольник" }).click();
  await tools(page);
  await expect(panel.getByLabel("Толщина обводки", { exact: true })).toHaveValue("5");
  await expect(panel.getByLabel("Скругление углов", { exact: true })).toHaveValue("24");
  await expect(panel.getByLabel("Включить тень", { exact: true })).toBeChecked();
  await expect(panel.getByLabel("Смещение тени X", { exact: true })).toHaveValue("-6");
});

test("AT-advanced: actual image filters affect exported pixels, survive reload and reset", async ({ page }) => {
  const id = await project(page);
  await page.locator(".editor-nav").getByRole("button", { name: "Загрузки", exact: true }).click();
  const buffer = await sharp({ create: { width: 100, height: 60, channels: 3, background: "#d03020" } }).png().toBuffer();
  await page.locator(".editor-panel input[type=file]").setInputFiles({ name: "filter-source.png", mimeType: "image/png", buffer });
  await expect.poll(async () => (await objects(page, id)).length).toBe(1);
  await tools(page);
  const panel = page.getByTestId("advanced-tools");
  await range(panel.getByLabel("Яркость", { exact: true }), 25);
  await range(panel.getByLabel("Контраст", { exact: true }), 15);
  await range(panel.getByLabel("Насыщенность", { exact: true }), -20);
  await panel.getByLabel("Чёрно-белое изображение", { exact: true }).check();
  await expect.poll(async () => (await objects(page, id))[0]?.filters?.map((filter: any) => filter.type)).toEqual(["Brightness", "Contrast", "Saturation", "Grayscale"]);
  await page.getByRole("button", { name: "Скачать", exact: true }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Формат файла").selectOption("png");
  const pending = page.waitForEvent("download");
  await modal.getByRole("button", { name: "Скачать", exact: true }).click();
  const exported = await readFile((await (await pending).path())!);
  const pixel = await sharp(exported).extract({ left: 400, top: 264, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  expect(pixel[0]).toBe(pixel[1]);
  expect(pixel[1]).toBe(pixel[2]);
  expect(pixel[0]).toBeGreaterThan(30);
  expect(pixel[0]).toBeLessThan(250);
  await page.reload();
  await expect(page.locator(".upper-canvas")).toBeVisible();
  await page.locator(".editor-nav").getByRole("button", { name: "Слои", exact: true }).click();
  await page.locator(".layer-name").filter({ hasText: "Изображение" }).click();
  await tools(page);
  await expect(panel.getByLabel("Яркость", { exact: true })).toHaveValue("25");
  await expect(panel.getByLabel("Чёрно-белое изображение", { exact: true })).toBeChecked();
  await panel.getByRole("button", { name: "Сбросить коррекцию", exact: true }).click();
  await expect.poll(async () => (await objects(page, id))[0]?.filters).toEqual([]);
});

test("AT-advanced: SVG import remains editable and malicious SVG never loads a network resource", async ({ page }) => {
  const id = await project(page);
  await tools(page);
  const panel = page.getByTestId("advanced-tools");
  let requests = 0;
  await page.route("**/blocked-svg-resource**", (route) => { requests++; return route.abort(); });
  const good = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><defs><linearGradient id="paint"><stop offset="0" stop-color="#8561df"/><stop offset="1" stop-color="#fedcba"/></linearGradient></defs><rect width="120" height="80" rx="10" fill="url(#paint)"/></svg>';
  await panel.getByLabel("Файл SVG", { exact: true }).setInputFiles({ name: "vector.svg", mimeType: "image/svg+xml", buffer: Buffer.from(good) });
  await expect.poll(async () => (await objects(page, id)).length).toBe(1);
  await expect(panel.getByLabel("Скругление углов", { exact: true })).toHaveValue("10");
  await panel.getByLabel("Скругление углов", { exact: true }).fill("18");
  await expect.poll(async () => (await objects(page, id))[0]?.rx).toBe(18);
  for (const source of [
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.test/blocked-svg-resource"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="30" height="30"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject width="30" height="30"><div>HTML</div></foreignObject></svg>',
  ]) {
    await panel.getByLabel("Файл SVG", { exact: true }).setInputFiles({ name: "unsafe.svg", mimeType: "image/svg+xml", buffer: Buffer.from(source) });
    await expect(page.locator(".toast")).toContainText("Ошибка SVG");
    expect(await objects(page, id)).toHaveLength(1);
  }
  expect(requests).toBe(0);
});

test("AT-advanced: multi-selection distributes equal gaps and aligns to selection without moving edges", async ({ page }) => {
  const id = await project(page, [
    { id: "left", type: "Rect", left: 20, top: 50, width: 80, height: 60, fill: "#8561df", strokeWidth: 0 },
    { id: "middle", type: "Rect", left: 170, top: 90, width: 100, height: 80, fill: "#f6c3ce", strokeWidth: 0 },
    { id: "right", type: "Rect", left: 500, top: 180, width: 120, height: 90, fill: "#fedcba", strokeWidth: 0 },
  ]);
  await tools(page);
  await page.locator(".upper-canvas").focus();
  await page.keyboard.press("ControlOrMeta+a");
  const panel = page.getByTestId("advanced-tools");
  await panel.getByRole("button", { name: "По горизонтали", exact: true }).click();
  await expect.poll(async () => (await objects(page, id)).map((object: any) => Math.round(object.left))).toEqual([20, 250, 500]);
  await panel.getByLabel("Область выравнивания", { exact: true }).selectOption("selection");
  await panel.getByRole("button", { name: "Выровнять сверху", exact: true }).click();
  await expect.poll(async () => (await objects(page, id)).map((object: any) => Math.round(object.top))).toEqual([50, 50, 50]);
  await expect.poll(async () => (await objects(page, id)).map((object: any) => Math.round(object.left))).toEqual([20, 250, 500]);
});
