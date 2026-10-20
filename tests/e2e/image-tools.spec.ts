import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import sharp from "sharp";

async function photoProject(page: Page) {
  const response = await page.request.post("/api/auth/register", { data: {
    name: "Photo designer", email: `photo-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`,
    password: "photo-browser-password-2026",
  } });
  expect(response.ok()).toBeTruthy();
  const blue = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#164fdb" } }).png().toBuffer();
  const buffer = await sharp({ create: { width: 200, height: 100, channels: 3, background: "#e52b35" } })
    .composite([{ input: blue, left: 100, top: 0 }]).png().toBuffer();
  const source = "data:image/png;base64," + buffer.toString("base64");
  const created = await page.request.post("/api/projects", { data: {
    title: "Photo tools", width: 600, height: 400,
    document: { pages: [{ id: "photo-page", canvas: { version: "6.7.1", background: "#ffffff", objects: [{
      id: "original-photo", type: "Image", src: source, width: 200, height: 100,
      left: 80, top: 80, scaleX: 2, scaleY: 2, strokeWidth: 0,
    }] } }] },
  } });
  expect(created.ok()).toBeTruthy();
  const id = (await created.json()).project.id;
  await page.goto("/?project=" + id);
  await expect(page.locator(".upper-canvas")).toBeVisible();
  await expect(page.locator(".live-presence")).toContainText("онлайн");
  await selectPhoto(page);
  return { id: id as string, source };
}
async function selectPhoto(page: Page) {
  await page.locator(".editor-nav").getByRole("button", { name: "Слои", exact: true }).click();
  await page.locator(".layer-name").filter({ hasText: "Изображение" }).click();
  await page.locator(".editor-nav").getByRole("button", { name: "Фото", exact: true }).click();
  await expect(page.getByTestId("image-tools").getByLabel("Кадр X", { exact: true })).toBeVisible();
}
async function photo(page: Page, id: string) {
  return (await (await page.request.get("/api/projects/" + id)).json()).project.document.pages[0].canvas.objects[0];
}
async function png(page: Page) {
  await page.getByRole("button", { name: "Скачать", exact: true }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Формат файла").selectOption("png");
  const pending = page.waitForEvent("download");
  await modal.getByRole("button", { name: "Скачать", exact: true }).click();
  return readFile((await (await pending).path())!);
}
async function pixel(buffer: Buffer, left: number, top: number) {
  return Array.from(await sharp(buffer).extract({ left, top, width: 1, height: 1 }).removeAlpha().raw().toBuffer());
}
const white = [255, 255, 255], red = [229, 43, 53], blue = [22, 79, 219];

test("PHOTO-01 crop/mask change real PNG pixels, Undo/reload retain native data and reset restores original", async ({ page }) => {
  const { id, source } = await photoProject(page);
  const panel = page.getByTestId("image-tools");
  await panel.getByLabel("Кадр X", { exact: true }).fill("250");
  await expect(panel.getByRole("alert")).toContainText("границы");
  await expect(panel.getByRole("button", { name: "Применить кадрирование", exact: true })).toBeDisabled();
  expect((await photo(page, id)).cropX || 0).toBe(0);
  await panel.getByLabel("Ширина кадра", { exact: true }).fill("100");
  await panel.getByLabel("Кадр X", { exact: true }).fill("100");
  await panel.getByRole("button", { name: "Применить кадрирование", exact: true }).click();
  await expect.poll(async () => {
    const saved = await photo(page, id);
    return { cropX: saved.cropX ?? 0, cropY: saved.cropY ?? 0, width: saved.width, height: saved.height, left: saved.left, top: saved.top, scaleX: saved.scaleX, scaleY: saved.scaleY, src: saved.src };
  }).toEqual({ cropX: 100, cropY: 0, width: 100, height: 100, left: 180, top: 80, scaleX: 2, scaleY: 2, src: source });
  let output = await png(page);
  expect(await pixel(output, 200, 100)).toEqual(blue);
  expect(await pixel(output, 100, 100)).toEqual(white);
  await panel.getByRole("button", { name: "Круг", exact: true }).click();
  await expect.poll(async () => (await photo(page, id)).clipPath?.type).toBe("Circle");
  output = await png(page);
  expect(await pixel(output, 190, 90)).toEqual(white);
  expect(await pixel(output, 280, 180)).toEqual(blue);
  await page.getByLabel("Отменить", { exact: true }).click();
  await expect.poll(async () => Boolean((await photo(page, id)).clipPath)).toBe(false);
  await page.getByLabel("Повторить", { exact: true }).click();
  await expect.poll(async () => (await photo(page, id)).clipPath?.type).toBe("Circle");
  await page.reload();
  await expect(page.locator(".upper-canvas")).toBeVisible();
  await selectPhoto(page);
  await expect(panel.getByLabel("Кадр X", { exact: true })).toHaveValue("100");
  await expect(panel.getByLabel("Ширина кадра", { exact: true })).toHaveValue("100");
  await expect(panel.getByRole("button", { name: "Круг", exact: true })).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("button", { name: "Сбросить кадрирование", exact: true }).click();
  await expect.poll(async () => {
    const saved = await photo(page, id);
    return [saved.cropX ?? 0, saved.cropY ?? 0, saved.width, saved.height, saved.left, saved.top, saved.clipPath?.type, saved.src];
  }).toEqual([0, 0, 200, 100, 80, 80, "Circle", source]);
  await panel.getByRole("button", { name: "Убрать маску", exact: true }).click();
  await expect.poll(async () => Boolean((await photo(page, id)).clipPath)).toBe(false);
  output = await png(page);
  expect(await pixel(output, 100, 100)).toEqual(red);
  expect(await pixel(output, 400, 100)).toEqual(blue);
  await panel.getByRole("button", { name: "Фото: отразить по горизонтали", exact: true }).click();
  await panel.getByRole("button", { name: "Фото: отразить по вертикали", exact: true }).click();
  await expect.poll(async () => {
    const saved = await photo(page, id); return [saved.flipX, saved.flipY, saved.src];
  }).toEqual([true, true, source]);
  output = await png(page);
  expect(await pixel(output, 100, 100)).toEqual(blue);
  expect(await pixel(output, 400, 100)).toEqual(red);
});

test("PHOTO-02 exact ratio drafts, centered rounded mask and public snapshot keep source geometry", async ({ page, browser, baseURL }) => {
  const { id, source } = await photoProject(page);
  const panel = page.getByTestId("image-tools");
  await panel.getByLabel("Пропорции кадра", { exact: true }).selectOption("16:9");
  await expect(panel.getByLabel("Ширина кадра", { exact: true })).toHaveValue("176");
  await expect(panel.getByLabel("Высота кадра", { exact: true })).toHaveValue("99");
  expect((await photo(page, id)).width).toBe(200);
  await panel.getByLabel("Пропорции кадра", { exact: true }).selectOption("4:3");
  await expect(panel.getByLabel("Ширина кадра", { exact: true })).toHaveValue("132");
  await expect(panel.getByLabel("Высота кадра", { exact: true })).toHaveValue("99");
  await panel.getByLabel("Пропорции кадра", { exact: true }).selectOption("1:1");
  await panel.getByLabel("Кадр X", { exact: true }).fill("20");
  await expect(panel.getByLabel("Пропорции кадра", { exact: true })).toHaveValue("free");
  await panel.getByRole("button", { name: "Центрировать кадр", exact: true }).click();
  await expect(panel.getByLabel("Кадр X", { exact: true })).toHaveValue("50");
  await panel.getByRole("button", { name: "Применить кадрирование", exact: true }).click();
  await panel.getByRole("button", { name: "Скруглённая", exact: true }).click();
  await panel.getByLabel("Радиус маски", { exact: true }).fill("20");
  await panel.getByRole("button", { name: "Применить радиус", exact: true }).click();
  await expect.poll(async () => {
    const saved = await photo(page, id);
    return { cropX: saved.cropX, width: saved.width, height: saved.height, type: saved.clipPath?.type, rx: saved.clipPath?.rx, ry: saved.clipPath?.ry, maskWidth: saved.clipPath?.width, absolute: saved.clipPath?.absolutePositioned, src: saved.src };
  }).toEqual({ cropX: 50, width: 100, height: 100, type: "Rect", rx: 20, ry: 20, maskWidth: 100, absolute: false, src: source });
  const output = await png(page);
  expect(await pixel(output, 181, 81)).toEqual(white);
  expect(await pixel(output, 220, 120)).toEqual(red);
  expect(await pixel(output, 330, 180)).toEqual(blue);
  const created = await page.request.post(`/api/projects/${id}/publications`, { data: { expiresInDays: 7 } });
  expect(created.ok()).toBeTruthy();
  const publication = (await created.json()).publication;
  const guestContext = await browser.newContext({ baseURL });
  try {
    const snapshotResponse = await guestContext.request.get(`/api/publications/${publication.token}`);
    expect(snapshotResponse.ok()).toBeTruthy();
    const published = (await snapshotResponse.json()).publication.document.pages[0].canvas.objects[0];
    expect(published.cropX).toBe(50);
    expect(published.width).toBe(100);
    expect(published.clipPath.type).toBe("Rect");
    expect(published.clipPath.rx).toBe(20);
    const guest = await guestContext.newPage();
    await guest.goto(publication.url);
    await expect(guest.getByRole("heading", { name: "Photo tools", exact: true })).toBeVisible();
    await expect(guest.getByRole("status")).toHaveCount(0);
    const pixels = await guest.locator("canvas").evaluate((canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext("2d")!;
      const at = (x: number, y: number) => Array.from(ctx.getImageData(Math.floor(x / 600 * canvas.width), Math.floor(y / 400 * canvas.height), 1, 1).data).slice(0, 3);
      return [at(181, 81), at(220, 120), at(330, 180)];
    });
    expect(pixels).toEqual([white, red, blue]);
  } finally { await guestContext.close(); }
});
