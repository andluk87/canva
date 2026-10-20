import { test, expect } from "@playwright/test";

test("PUB-07 publish, guest canvas pages, private edits, explicit update and revoke", async ({ page, browser }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.request.post("/api/auth/register", { data: {
    email: `publisher-${Date.now()}@example.test`, name: "Publisher", password: "correct-horse-2026",
  } });
  const created = await (await page.request.post("/api/projects", { data: {
    title: "Снимок для гостей", kind: "presentation", width: 800, height: 600,
    document: { pages: [
      { id: "p1", canvas: { version: "6.7.1", background: "#2255aa", objects: [
        { id: "text-1", type: "Textbox", text: "Публичная презентация", left: 20, top: 20, width: 500, fontSize: 32, fill: "#ffffff" },
      ] } },
      { id: "p2", canvas: { version: "6.7.1", background: "#cc5544", objects: [] } },
    ] },
  } })).json();
  const id = created.project.id;
  await page.goto("/?project=" + id);
  await expect(page.locator(".upper-canvas")).toBeVisible();
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Опубликовать дизайн" });
  await modal.getByRole("button", { name: "Создать публичную ссылку", exact: true }).click();
  const link = await modal.getByLabel("Публичная ссылка, версия 1").inputValue();
  const token = new URL(link).searchParams.get("view")!;
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  const guestErrors: string[] = [];
  guest.on("pageerror", (error) => guestErrors.push(error.message));
  await guest.goto(link);
  await expect(guest.getByRole("heading", { name: "Снимок для гостей" })).toBeVisible();
  await expect(guest.getByText("Страница 1 из 2", { exact: true })).toBeVisible();
  await expect(guest.getByRole("status")).toHaveCount(0);
  expect((await guest.request.get("/api/auth/me")).status()).toBe(401);
  await expect(guest.locator(".upper-canvas")).toHaveCount(0);
  const firstPixel = await guest.locator("canvas").evaluate((canvas: HTMLCanvasElement) =>
    Array.from(canvas.getContext("2d")!.getImageData(5, 5, 1, 1).data));
  expect(firstPixel.slice(0, 3)).toEqual([34, 85, 170]);
  await guest.getByRole("button", { name: "Следующая страница" }).click();
  await expect(guest.getByText("Страница 2 из 2", { exact: true })).toBeVisible();
  await expect(guest.getByRole("status")).toHaveCount(0);
  const secondPixel = await guest.locator("canvas").evaluate((canvas: HTMLCanvasElement) =>
    Array.from(canvas.getContext("2d")!.getImageData(5, 5, 1, 1).data));
  expect(secondPixel.slice(0, 3)).toEqual([204, 85, 68]);
  await modal.getByRole("button", { name: "Закрыть" }).click();
  await page.getByLabel("Название проекта").fill("Приватное изменение");
  await expect.poll(async () => (await (await page.request.get(`/api/projects/${id}`)).json()).project.title)
    .toBe("Приватное изменение");
  await guest.reload();
  await expect(guest.getByRole("heading", { name: "Снимок для гостей" })).toBeVisible();
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await modal.getByRole("button", { name: "Обновить снимок", exact: true }).click();
  await expect(modal.getByLabel("Публичная ссылка, версия 2")).toBeVisible();
  await guest.reload();
  await expect(guest.getByRole("heading", { name: "Приватное изменение" })).toBeVisible();
  await modal.getByRole("button", { name: "Отозвать ссылку", exact: true }).click();
  await modal.getByRole("button", { name: "Подтвердить отзыв", exact: true }).click();
  await expect(modal.getByText("Отозвана", { exact: true })).toBeVisible();
  await guest.reload();
  await expect(guest.getByRole("heading", { name: "Публикация недоступна" })).toBeVisible();
  await expect(guest.getByRole("alert")).toContainText("отозвал");
  expect((await guest.request.get(`/api/publications/${token}`)).status()).toBe(410);
  expect(errors).toEqual([]); expect(guestErrors).toEqual([]);
  await guestContext.close();
});
