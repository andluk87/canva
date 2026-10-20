import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

async function project(page: Page, objects: any[] = []) {
  const registered = await page.request.post('/api/auth/register', { data: {
    name: 'Data designer', email: `data-tools-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`, password: 'data-tools-password-2026',
  } });
  expect(registered.ok()).toBeTruthy();
  const created = await page.request.post('/api/projects', { data: {
    title: 'Charts and tables', width: 800, height: 600,
    document: { pages: [{ id: 'data-page', canvas: { background: '#ffffff', objects } }] },
  } });
  expect(created.ok()).toBeTruthy();
  const id = (await created.json()).project.id;
  await page.goto('/?project=' + id);
  await expect(page.locator('.upper-canvas')).toBeVisible();
  await expect(page.locator('.save-status')).toContainText('Сохранено');
  await tools(page);
  return id as string;
}
async function tools(page: Page) {
  await page.locator('.editor-nav').getByRole('button', { name: 'Данные', exact: true }).click();
  await expect(page.getByTestId('data-tools')).toBeVisible();
}
async function objects(page: Page, id: string) {
  return (await (await page.request.get('/api/projects/' + id)).json()).project.document.pages[0].canvas.objects;
}

test('AT-data: editable charts keep native objects, transforms, stack, source and Undo after regeneration', async ({ page }) => {
  const id = await project(page, [{ id: 'original-rectangle', type: 'Rect', left: 10, top: 10, width: 20, height: 20, fill: '#123456' }]);
  const panel = page.getByTestId('data-tools');
  await panel.getByLabel('Данные CSV', { exact: true }).fill('Месяц,Прибыль\nЯнварь,12\nФевраль,-5\nМарт,30');
  await panel.getByRole('button', { name: 'Добавить диаграмму', exact: true }).click();
  await expect.poll(async () => (await objects(page, id))[1]?.formaData?.rows).toEqual([['Январь','12'],['Февраль','-5'],['Март','30']]);
  let saved = (await objects(page, id))[1];
  expect(saved.type.toLowerCase()).toBe('group');
  expect(saved.objects.some((object: any) => object.type.toLowerCase() === 'rect' && object.fill === '#7651d8')).toBeTruthy();
  expect(saved.objects.some((object: any) => object.type.toLowerCase() === 'text')).toBeTruthy();
  expect(saved.objects.every((object: any) => typeof object.id === 'string')).toBeTruthy();
  await page.getByLabel('Положение X', { exact: true }).fill('55');
  await page.getByLabel('Положение Y', { exact: true }).fill('72');
  await page.getByLabel('Положение Ширина', { exact: true }).fill('550');
  await page.getByLabel('Положение Высота', { exact: true }).fill('350');
  await page.getByLabel('Поворот', { exact: true }).fill('12');
  await expect.poll(async () => (await objects(page, id))[1]?.angle).toBe(12);
  const before = (await objects(page, id))[1];
  await page.waitForTimeout(400); // Yjs intentionally groups edits within 350 ms.
  await panel.getByLabel('Тип диаграммы', { exact: true }).selectOption('line');
  await panel.getByLabel('Заголовок объекта данных').fill('Прибыль после возвратов');
  await panel.getByRole('button', { name: 'Обновить выбранный объект', exact: true }).click();
  await expect.poll(async () => (await objects(page, id))[1]?.formaData?.chartType).toBe('line');
  saved = (await objects(page, id))[1];
  for (const key of ['id','left','top','scaleX','scaleY','angle','width','height']) expect(saved[key]).toBe(before[key]);
  expect(saved.objects[0].left).toBeCloseTo(-before.width / 2, 3);
  expect(saved.objects[0].top).toBeCloseTo(-before.height / 2, 3);
  expect(saved.objects[0].scaleX).toBeCloseTo(1, 3);
  expect(saved.objects[0].scaleY).toBeCloseTo(1, 3);
  expect(saved.objects.some((object: any) => object.type.toLowerCase() === 'path')).toBeTruthy();
  expect((await objects(page, id))[0].id).toBe('original-rectangle');
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect.poll(async () => (await objects(page, id))[1]?.formaData?.chartType).toBe('bar');
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect.poll(async () => (await objects(page, id))[1]?.formaData?.chartType).toBe('line');
  await page.reload();
  await expect(page.locator('.upper-canvas')).toBeVisible();
  await page.locator('.editor-nav').getByRole('button', { name: 'Слои', exact: true }).click();
  await page.locator('.layer-name').filter({ hasText: 'Группа' }).click();
  await tools(page);
  await expect(panel.getByLabel('Тип диаграммы', { exact: true })).toHaveValue('line');
  await expect(panel.getByLabel('Заголовок объекта данных')).toHaveValue('Прибыль после возвратов');
  expect(await panel.getByLabel('Данные CSV', { exact: true }).inputValue()).toContain('Февраль,-5');
});

test('AT-data: pie rejects zero and negative values, then exports actual colored native slices to PNG', async ({ page }) => {
  const id = await project(page);
  const panel = page.getByTestId('data-tools');
  await panel.getByLabel('Тип диаграммы', { exact: true }).selectOption('pie');
  await panel.getByLabel('Данные CSV', { exact: true }).fill('Категория,Доля\nА,10\nБ,-5');
  await expect(panel.getByRole('alert')).toContainText('больше нуля');
  await expect(panel.getByRole('button', { name: 'Добавить диаграмму', exact: true })).toBeDisabled();
  expect(await objects(page, id)).toHaveLength(0);
  await panel.getByLabel('Файл данных CSV', { exact: true }).setInputFiles({ name: 'shares.csv', mimeType: 'text/csv',
    buffer: Buffer.from('\uFEFFКатегория;Доля\nКниги;10\nПлакаты;20\nОткрытки;30') });
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Добавить диаграмму', exact: true }).click();
  await expect.poll(async () => (await objects(page, id))[0]?.formaData?.chartType).toBe('pie');
  const group = (await objects(page, id))[0];
  expect(group.objects.filter((object: any) => object.type.toLowerCase() === 'path')).toHaveLength(3);
  await page.getByRole('button', { name: 'Скачать', exact: true }).click();
  const modal = page.getByRole('dialog');
  await modal.getByLabel('Формат файла').selectOption('png');
  const pending = page.waitForEvent('download');
  await modal.getByRole('button', { name: 'Скачать', exact: true }).click();
  const buffer = await readFile((await (await pending).path())!);
  const metadata = await sharp(buffer).metadata();
  expect([metadata.width, metadata.height]).toEqual([800,600]);
  const pixels = await sharp(buffer).removeAlpha().raw().toBuffer();
  let purple = 0;
  for (let i = 0; i < pixels.length; i += 3) if (pixels[i] === 118 && pixels[i+1] === 81 && pixels[i+2] === 216) purple++;
  expect(purple).toBeGreaterThan(1000);
});

test('AT-data: tables retain full text, header styling and backing CSV across edits and reload', async ({ page }) => {
  const id = await project(page);
  const panel = page.getByTestId('data-tools');
  const csv = 'Товар,Описание,Цена\nКнига,"Первая строка\nВторая, с запятой",15\nПлакат,"Текст с ""кавычками""",бесплатно';
  await panel.getByLabel('Тип объекта данных', { exact: true }).selectOption('table');
  await panel.getByLabel('Заголовок объекта данных').fill('Каталог');
  await panel.getByLabel('Данные CSV', { exact: true }).fill(csv);
  await panel.getByRole('button', { name: 'Добавить таблицу', exact: true }).click();
  await expect.poll(async () => (await objects(page, id))[0]?.formaData?.kind).toBe('table');
  const group = (await objects(page, id))[0];
  expect(group.formaData.rows[0][1]).toBe('Первая строка\nВторая, с запятой');
  expect(group.objects.filter((object: any) => object.type.toLowerCase() === 'text')).toHaveLength(10);
  expect(group.objects.some((object: any) => object.fill === '#7651d8')).toBeTruthy();
  expect(group.objects.some((object: any) => object.fill === '#f3f4f8')).toBeTruthy();
  const pending = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Скачать данные CSV', exact: true }).click();
  const exported = await readFile((await (await pending).path())!, 'utf8');
  expect(exported).toContain('"Первая строка\nВторая, с запятой"');
  expect(exported).toContain('"Текст с ""кавычками"""');
  await page.reload();
  await expect(page.locator('.upper-canvas')).toBeVisible();
  await page.locator('.editor-nav').getByRole('button', { name: 'Слои', exact: true }).click();
  await page.locator('.layer-name').filter({ hasText: 'Группа' }).click();
  await tools(page);
  await expect(panel.getByLabel('Тип объекта данных', { exact: true })).toHaveValue('table');
  expect(await panel.getByLabel('Данные CSV', { exact: true }).inputValue()).toContain('Вторая, с запятой');
  await panel.getByLabel('Палитра данных').selectOption('ocean');
  await panel.getByRole('button', { name: 'Обновить выбранный объект', exact: true }).click();
  await expect.poll(async () => (await objects(page, id))[0]?.formaData?.palette).toBe('ocean');
  expect((await objects(page, id))[0].id).toBe(group.id);
});
