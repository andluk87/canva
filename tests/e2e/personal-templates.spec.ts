import { test, expect } from "@playwright/test";

const document = { pages: [
  { id: "personal-ui-page-1", canvas: { version: "6.7.1", background: "#f4eeff", objects: [
    { id: "personal-ui-text", type: "Textbox", text: "Мой исходный дизайн", left: 40, top: 40, width: 600, fontSize: 35, fill: "#7048ed" },
  ] } },
  { id: "personal-ui-page-2", canvas: { version: "6.7.1", background: "#ffdfcc", objects: [] } },
] };
async function setup(page: any) {
  const email = `personal-ui-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
  expect((await page.request.post("/api/auth/register", { data: { email, name: "Template designer", password: "template-browser-password-2026" } })).status()).toBe(200);
  const response = await page.request.post("/api/projects", { data: { title: "Источник личного шаблона", width: 800, height: 600, document } });
  expect(response.status()).toBe(201);
  return (await response.json()).project;
}

test("personal templates: editor saves current pages before snapshot; new projects edit independently", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const original = await setup(page);
  await page.goto("/?project=" + original.id);
  await expect(page.locator(".upper-canvas")).toBeVisible();
  await expect(page.locator(".live-presence")).toContainText("онлайн");
  await page.locator(".editor-nav").getByRole("button", { name: "Текст", exact: true }).click();
  await page.getByRole("button", { name: "Добавить заголовок", exact: true }).click();
  await page.locator(".editor-nav").getByRole("button", { name: "Мои шаблоны", exact: true }).click();
  const library = page.getByRole("region", { name: "Библиотека личных шаблонов" });
  await library.getByLabel("Название шаблона", { exact: true }).fill("Шаблон из редактора");
  await library.getByLabel("Категория шаблона", { exact: true }).fill("Приглашения");
  const saved = page.waitForResponse((response) => response.url().endsWith("/api/personal-templates") && response.request().method() === "POST");
  await library.getByRole("button", { name: "Сохранить шаблон", exact: true }).click();
  const saveResponse = await saved;
  expect(saveResponse.status()).toBe(201);
  const template = (await saveResponse.json()).template;
  const card = library.locator(`[data-template-id="${template.id}"]`);
  await expect(card).toContainText("Шаблон из редактора");
  await expect(card).toContainText("2 стр.");
  await card.getByRole("button", { name: "Использовать", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Создать дизайн из шаблона", exact: true });
  await modal.getByLabel("Название нового дизайна", { exact: true }).fill("Независимый проект");
  const instantiated = page.waitForResponse((response) => response.url().endsWith(`/api/personal-templates/${template.id}/instantiate`));
  await modal.getByRole("button", { name: "Создать дизайн", exact: true }).click();
  const copied = (await (await instantiated).json()).project;
  expect(copied.document.pages).toHaveLength(2);
  expect(copied.document.pages[0].canvas.objects.some((object: any) => object.text === "Добавьте заголовок")).toBe(true);
  await expect(page).toHaveURL(new RegExp("project=" + copied.id));
  await expect(page.getByLabel("Название проекта", { exact: true })).toHaveValue("Независимый проект");
  await expect(page.locator(".live-presence")).toContainText("онлайн");
  await page.locator(".editor-nav").getByRole("button", { name: "Элементы", exact: true }).click();
  await page.getByLabel("Добавить circle", { exact: true }).click();
  await expect.poll(async () => {
    const project = (await (await page.request.get("/api/projects/" + copied.id)).json()).project;
    return project.document.pages[0].canvas.objects.some((object: any) => object.type === "Circle");
  }).toBe(true);
  const source = (await (await page.request.get("/api/projects/" + original.id)).json()).project;
  expect(source.document.pages[0].canvas.objects.some((object: any) => object.type === "Circle")).toBe(false);
  const another = (await (await page.request.post(`/api/personal-templates/${template.id}/instantiate`, { data: {} })).json()).project;
  expect(another.document.pages[0].canvas.objects.some((object: any) => object.type === "Circle")).toBe(false);
  expect(another.id).not.toBe(copied.id);
  expect(errors).toEqual([]);
});

test("personal templates: home source selection, Cyrillic search, rename conflict, refresh and deletion", async ({ page }) => {
  const original = await setup(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Мои шаблоны", exact: true }).click();
  const library = page.getByRole("region", { name: "Библиотека личных шаблонов" });
  await library.locator("summary").click();
  await library.getByLabel("Исходный дизайн для шаблона", { exact: true }).selectOption(original.id);
  await library.getByLabel("Название шаблона", { exact: true }).fill("Открытка к празднику");
  await library.getByLabel("Категория шаблона", { exact: true }).fill("Открытки");
  const saved = page.waitForResponse((response) => response.url().endsWith("/api/personal-templates") && response.request().method() === "POST");
  await library.getByRole("button", { name: "Сохранить шаблон", exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  const template = (await response.json()).template;
  const card = library.locator(`[data-template-id="${template.id}"]`);
  await expect(card).toBeVisible();
  await library.getByLabel("Поиск личных шаблонов", { exact: true }).fill("ОТКРЫТКА");
  await expect(card).toBeVisible();
  await library.getByLabel("Фильтр категории шаблонов", { exact: true }).selectOption("Открытки");
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Изменить шаблон «Открытка к празднику»", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Изменить личный шаблон", exact: true });
  await modal.getByLabel("Новое название шаблона", { exact: true }).fill("Обновлённая открытка");
  expect((await page.request.patch(`/api/personal-templates/${template.id}`, { data: { revision: 1, title: "Изменение из другой вкладки" } })).status()).toBe(200);
  await modal.getByRole("button", { name: "Сохранить изменения", exact: true }).click();
  await expect(modal.getByRole("alert")).toContainText("Шаблон изменён в другой вкладке");
  await modal.getByRole("button", { name: "Отмена", exact: true }).click();
  await library.getByLabel("Поиск личных шаблонов", { exact: true }).fill("");
  await library.getByRole("button", { name: "Обновить библиотеку шаблонов", exact: true }).click();
  await expect(card).toContainText("Изменение из другой вкладки");
  await card.getByRole("button", { name: "Изменить шаблон «Изменение из другой вкладки»", exact: true }).click();
  await modal.getByLabel("Новое название шаблона", { exact: true }).fill("Обновлённая открытка");
  await modal.getByRole("button", { name: "Сохранить изменения", exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(card).toContainText("Обновлённая открытка");
  await card.getByRole("button", { name: "Удалить шаблон «Обновлённая открытка»", exact: true }).click();
  const deletion = page.getByRole("dialog", { name: "Удалить личный шаблон?", exact: true });
  await deletion.getByRole("button", { name: "Удалить шаблон", exact: true }).click();
  await expect(card).toHaveCount(0);
  expect((await page.request.get("/api/projects/" + original.id)).status()).toBe(200);
});

test.describe('cancelled template navigation',()=>{
 test.use({serviceWorkers:'block'});
 test('a late template creation response does not reopen an editor after browser Back',async({page})=>{
  const original=await setup(page);const {template}=await(await page.request.post('/api/personal-templates',{data:{projectId:original.id,title:'Late response template'}})).json();await page.goto('/');await expect(page.locator('.workspace')).toContainText('Template designer');await page.evaluate(id=>{history.pushState({},'', '?project='+id);dispatchEvent(new PopStateEvent('popstate'));},original.id);await expect(page.locator('.live-presence')).toContainText('онлайн');
  await page.locator('.editor-nav').getByRole('button',{name:'Мои шаблоны',exact:true}).click();const card=page.locator(`[data-template-id="${template.id}"]`);await card.getByRole('button',{name:'Использовать',exact:true}).click();const modal=page.getByRole('dialog',{name:'Создать дизайн из шаблона',exact:true});await modal.getByLabel('Название нового дизайна',{exact:true}).fill('Completed after Back');
  let intercepted=false;let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);await page.route(`**/api/personal-templates/${template.id}/instantiate`,async route=>{const response=await route.fetch();const body=await response.text();intercepted=true;await gate;await route.fulfill({response,body});});
  await modal.getByRole('button',{name:'Создать дизайн',exact:true}).click();await expect.poll(()=>intercepted).toBe(true);await page.goBack();await expect(page.locator('.workspace')).toContainText('Template designer');expect(new URL(page.url()).searchParams.has('project')).toBe(false);const delivered=page.waitForResponse(r=>r.url().endsWith(`/personal-templates/${template.id}/instantiate`));release();await(await delivered).finished();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));expect(new URL(page.url()).searchParams.has('project')).toBe(false);await expect(page.locator('.editor-header')).toHaveCount(0);await expect(page.locator('.workspace')).toContainText('Template designer');const projects=(await(await page.request.get('/api/projects')).json()).projects;expect(projects.some((p:any)=>p.title==='Completed after Back')).toBe(true);
 });
});
