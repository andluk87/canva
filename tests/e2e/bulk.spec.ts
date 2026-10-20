import { test, expect } from '@playwright/test';

test('bulk: CSV upload previews literal values and creates two personalized designs without changing the source', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const email = `bulk-ui-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
  expect((await page.request.post('/api/auth/register', { data: { name: 'Bulk designer', email, password: 'bulk-browser-password-2026' } })).ok()).toBeTruthy();
  const document = { pages: [{ id: 'bulk-ui-page', canvas: { version: '6.7.1', background: '#ffffff', objects: [
    { id: 'bulk-name', type: 'Textbox', text: 'Для {{имя}}', left: 60, top: 80, width: 650, fontSize: 48, fill: '#7048ed' },
    { id: 'bulk-city', type: 'Textbox', text: 'Город: {{город}}', left: 60, top: 200, width: 650, fontSize: 30, fill: '#24212b' },
  ] } }] };
  const original = (await (await page.request.post('/api/projects', { data: { title: 'Персональные приглашения', width: 800, height: 600, document } })).json()).project;
  await page.goto('/?project=' + original.id);
  await expect(page.locator('.upper-canvas')).toBeVisible();
  await expect(page.locator('.live-presence')).toContainText('онлайн');
  await page.getByRole('button', { name: 'Массовое создание', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Массовое создание' });
  await expect(modal).toContainText('{{имя}}');
  await expect(modal).toContainText('{{город}}');
  await modal.getByLabel('Данные CSV', { exact: true }).fill('имя\nАнна');
  await expect(modal.getByRole('alert')).toContainText('отсутствуют столбцы: город');
  await expect(modal.getByRole('button', { name: 'Создать дизайны (1)', exact: true })).toBeDisabled();
  const literal = 'Анна <img src=x onerror=alert(1)>';
  await modal.getByLabel('Загрузить CSV', { exact: true }).setInputFiles({ name: 'invites.csv', mimeType: 'text/csv', buffer: Buffer.from('\uFEFFимя;город\r\n"' + literal + '";Москва\r\nИван;"Казань, центр"', 'utf8') });
  await modal.getByLabel('Шаблон названий проектов', { exact: true }).fill('Приглашение — {{имя}}');
  await expect(modal.locator('table')).toContainText(literal);
  await expect(modal.locator('table img')).toHaveCount(0);
  await expect(modal.getByRole('alert')).toHaveCount(0);
  const responsePromise = page.waitForResponse((response) => response.url().endsWith(`/api/projects/${original.id}/bulk`) && response.request().method() === 'POST');
  await modal.getByRole('button', { name: 'Создать дизайны (2)', exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const { projects } = await response.json();
  expect(projects).toHaveLength(2);
  expect(projects[0].title).toBe('Приглашение — ' + literal);
  expect(projects[0].document.pages[0].canvas.objects[0].text).toBe('Для ' + literal);
  expect(projects[1].document.pages[0].canvas.objects[1].text).toBe('Город: Казань, центр');
  const source = (await (await page.request.get('/api/projects/' + original.id)).json()).project;
  expect(source.title).toBe(original.title);
  expect(source.document.pages[0].canvas.objects.map((o: any) => o.text)).toEqual(['Для {{имя}}', 'Город: {{город}}']);
  await page.goto('/?project=' + projects[1].id);
  await expect(page.locator('.upper-canvas')).toBeVisible();
  await expect(page.getByLabel('Название проекта')).toHaveValue('Приглашение — Иван');
  expect(errors).toEqual([]);
});
