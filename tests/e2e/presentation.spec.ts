import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import sharp from "sharp";

test("PPTX-06 slide notes, real multi-slide PPTX with raster fallback and keyboard presentation", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.request.post("/api/auth/register", { data: {
    email: `presentation-${Date.now()}@example.test`, name: "Presenter", password: "correct-horse-2026",
  } });
  const response = await page.request.post("/api/projects", { data: {
    title: "Презентация с заметками", kind: "presentation", width: 1920, height: 1080,
    document: { pages: [
      { id: "p1", notes: "Исходные заметки", transition: "none", canvas: { version: "6.7.1", background: "#2255aa", objects: [
        { id: "editable-text", type: "Textbox", text: "Редактируемый текст", left: 80, top: 80, width: 1000, height: 58,
          fontFamily: "Arial", fontSize: 48, fill: "#ffffff" },
      ] } },
      { id: "p2", notes: "Переход ко второй части", transition: "slide", canvas: { version: "6.7.1", background: "#f2f0e9", objects: [
        { id: "gradient-shape", type: "Rect", left: 100, top: 100, width: 1500, height: 800,
          fill: { type: "linear", gradientUnits: "percentage", coords: { x1: 0, y1: 0, x2: 1, y2: 0 },
            colorStops: [{ offset: 0, color: "#ff0000" }, { offset: 1, color: "#0000ff" }] },
          shadow: { color: "#000000", blur: 10, offsetX: 5, offsetY: 5 } },
      ] } },
      { id: "p3", notes: "Завершение", transition: "fade", canvas: { version: "6.7.1", background: "#cc5544", objects: [] } },
    ] },
  } });
  expect(response.status()).toBe(201);
  const id = (await response.json()).project.id;
  await page.goto("/?project=" + id);
  await expect(page.locator(".upper-canvas")).toBeVisible();
  await page.locator(".editor-nav").getByRole("button", { name: "Слайды", exact: true }).click();
  await page.getByLabel("Заметки докладчика", { exact: true }).fill("Скажите: привет & добро пожаловать!\nВажный второй пункт.");
  await page.getByLabel("Переход к слайду", { exact: true }).selectOption("fade");
  await expect.poll(async () => {
    const project = (await (await page.request.get(`/api/projects/${id}`)).json()).project;
    return [project.document.pages[0].notes, project.document.pages[0].transition];
  }).toEqual(["Скажите: привет & добро пожаловать!\nВажный второй пункт.", "fade"]);
  await page.getByRole("button", { name: "Скачать", exact: true }).click();
  const downloadDialog = page.getByRole("dialog", { name: "Скачать дизайн" });
  await downloadDialog.getByLabel("Формат файла").selectOption("pptx");
  const downloadPromise = page.waitForEvent("download");
  await downloadDialog.getByRole("button", { name: "Скачать", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pptx$/);
  const zip = await JSZip.loadAsync(await readFile((await download.path())!));
  expect(Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))).toHaveLength(3);
  expect(await zip.file("ppt/slides/slide1.xml")!.async("string")).toContain("Редактируемый текст");
  expect(await zip.file("ppt/slides/slide1.xml")!.async("string")).not.toContain("<p:pic>");
  const fallback = await zip.file("ppt/slides/slide2.xml")!.async("string");
  expect(fallback).toContain("<p:pic>");
  const imageNames = Object.keys(zip.files).filter((name) => /^ppt\/media\/.+\.png$/.test(name));
  expect(imageNames).toHaveLength(1);
  const imageBuffer = await zip.file(imageNames[0])!.async("nodebuffer");
  const image = await sharp(imageBuffer).metadata();
  expect(image.width).toBe(1920); expect(image.height).toBe(1080);
  const raster = await sharp(imageBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const sample = (x: number, y: number) => {
    const offset = (y * raster.info.width + x) * raster.info.channels;
    return [...raster.data.subarray(offset, offset + 4)];
  };
  const left = sample(200, 400), right = sample(1500, 400);
  expect(left[0]).toBeGreaterThan(left[2] * 2);
  expect(right[2]).toBeGreaterThan(right[0] * 2);
  const notes = await zip.file("ppt/notesSlides/notesSlide1.xml")!.async("string");
  expect(notes).toContain("Скажите: привет &amp; добро пожаловать!");
  expect(notes).toContain("Важный второй пункт.");
  expect(await zip.file("ppt/notesSlides/notesSlide2.xml")!.async("string")).toContain("Переход ко второй части");
  await expect(downloadDialog).toHaveCount(0);

  await page.getByRole("button", { name: "Просмотр", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Презентация с заметками", exact: true });
  await expect(viewer).toBeVisible();
  await expect(viewer.locator(".forma-presentation__counter")).toHaveText("1 / 3");
  await expect(viewer.getByRole("img", { name: "Слайд 1", exact: true })).toHaveAttribute("aria-busy", "false");
  await expect(viewer.locator(".upper-canvas")).toHaveCount(0);
  await viewer.getByRole("button", { name: "Заметки", exact: true }).click();
  await expect(viewer.getByRole("region", { name: "Заметки докладчика" })).toContainText("добро пожаловать");
  await viewer.focus();
  await page.keyboard.press("ArrowRight");
  await expect(viewer.locator(".forma-presentation__counter")).toHaveText("2 / 3");
  await expect(viewer.getByRole("img", { name: "Слайд 2", exact: true })).toHaveAttribute("aria-busy", "false");
  await expect(viewer.locator("[data-transition='slide']")).toHaveCSS("animation-name", "forma-presentation-slide");
  await page.keyboard.press("b");
  await expect(viewer.locator(".forma-presentation__blackout")).toBeVisible();
  await page.keyboard.press("b");
  await expect(viewer.locator(".forma-presentation__blackout")).toHaveCount(0);
  await page.keyboard.press("End");
  await expect(viewer.locator(".forma-presentation__counter")).toHaveText("3 / 3");
  await page.keyboard.press("Home");
  await expect(viewer.locator(".forma-presentation__counter")).toHaveText("1 / 3");
  await page.keyboard.press("Space");
  await expect(viewer.locator(".forma-presentation__counter")).toHaveText("2 / 3");
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(page.locator(".upper-canvas")).toBeVisible();
  await expect(page.getByLabel("Заметки докладчика", { exact: true })).toHaveValue("Скажите: привет & добро пожаловать!\nВажный второй пункт.");
  expect(errors).toEqual([]);
});
