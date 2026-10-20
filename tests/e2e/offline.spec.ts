import {test,expect} from '@playwright/test';
import sharp from 'sharp';
test('AT-20: offline reload restores durable edits and later syncs them to the server',async({page,context})=>{
 const email=`offline-${Date.now()}@example.test`;await page.request.post('/api/auth/register',{data:{email,name:'Offline designer',password:'offline-browser-2026'}});
 const {project}=await(await page.request.post('/api/projects',{data:{title:'Durable original',width:800,height:600}})).json();await page.goto('/?project='+project.id);await expect(page.locator('.live-presence')).toContainText('онлайн');
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise<void>(resolve=>navigator.serviceWorker.addEventListener('controllerchange',()=>resolve(),{once:true}));});
 const png=await sharp({create:{width:80,height:60,channels:4,background:'#2377dd'}}).png().toBuffer();await page.locator('.editor-nav').getByRole('button',{name:'Загрузки',exact:true}).click();await page.locator('input[type=file][accept*="image/png"]').setInputFiles({name:'offline.png',mimeType:'image/png',buffer:png});await expect.poll(async()=>{const p=(await(await page.request.get('/api/projects/'+project.id)).json()).project;return p.document.pages[0].canvas.objects.filter((o:any)=>o.type==='Image'||o.type==='image').length}).toBe(1);
 await page.getByLabel('Название проекта',{exact:true}).fill('Before disconnect');await expect(page.locator('.save-status')).toContainText('Сохранено');
 await context.setOffline(true);await page.reload();await expect(page.getByLabel('Название проекта',{exact:true})).toHaveValue('Before disconnect');await page.locator('.editor-nav').getByRole('button',{name:'Текст',exact:true}).click();await page.getByRole('button',{name:'Добавить заголовок',exact:true}).click();await page.getByLabel('Название проекта',{exact:true}).fill('Saved on this device');await expect(page.locator('.save-status')).toContainText('сохранено на устройстве');
 await page.reload();await expect(page.getByLabel('Название проекта',{exact:true})).toHaveValue('Saved on this device');await page.locator('.editor-nav').getByRole('button',{name:'Слои',exact:true}).click();await expect(page.locator('.layer-row')).toHaveCount(2);
 await context.setOffline(false);await expect(page.locator('.live-presence')).toContainText('онлайн');await expect.poll(async()=>{const r=await page.request.get('/api/projects/'+project.id);return(await r.json()).project.title},{timeout:15000}).toBe('Saved on this device');
 const saved=(await(await page.request.get('/api/projects/'+project.id)).json()).project;expect(saved.document.pages[0].canvas.objects).toHaveLength(2);
 const cached=await page.evaluate(async()=>{const keys=await caches.keys();const urls=(await Promise.all(keys.map(async key=>(await(await caches.open(key)).keys()).map(r=>new URL(r.url).pathname)))).flat();return urls.filter(url=>url.startsWith('/api/'));});expect(cached).toEqual([]);
});

test.describe('session isolation',()=>{
test.use({serviceWorkers:'block'});
test('offline: logout in another tab clears local access and a late account response stays discarded',async({page,context})=>{
 const stamp=Date.now();const first=`offline-isolation-${stamp}@example.test`,second=`offline-new-${stamp}@example.test`,password='offline-isolation-2026';
 const firstUser=(await(await page.request.post('/api/auth/register',{data:{email:first,name:'First account',password}})).json()).user;
 const {project}=await(await page.request.post('/api/projects',{data:{title:'Private first account',width:400,height:300}})).json();
 await page.goto('/?project='+project.id);await expect(page.locator('.live-presence')).toContainText('онлайн');
 const other=await context.newPage();await other.goto('/');await expect(other.locator('.workspace')).toContainText('First account');
 await other.locator('.account').click();await expect(page.locator('.workspace')).toContainText('Личное пространство');
 const remaining=await page.evaluate(async(userId)=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('forma-offline-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});const result=await Promise.all(['documents','projects'].map(name=>new Promise<number>(resolve=>{const r=db.transaction(name).objectStore(name).index('userId').count(userId);r.onsuccess=()=>resolve(r.result)})));db.close();return result;},firstUser.id);expect(remaining).toEqual([0,0]);
 await other.close();
 await page.request.post('/api/auth/login',{data:{email:first,password}});
 let delayed=false;let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);let intercepted!:()=>void;const started=new Promise<void>(resolve=>intercepted=resolve);
 await page.route('**/api/projects',async route=>{if(route.request().method()!=='GET'||delayed)return route.continue();delayed=true;const response=await route.fetch();const body=await response.text();intercepted();await gate;await route.fulfill({response,body});});
 await page.goto('/');await started;await page.locator('.account').click();await page.locator('.account').click();const dialog=page.getByRole('dialog');await dialog.getByLabel('Ваше имя',{exact:true}).fill('Second account');await dialog.getByLabel('Email',{exact:true}).fill(second);await dialog.getByLabel('Пароль',{exact:true}).fill(password);await dialog.getByRole('button',{name:'Создать аккаунт',exact:true}).click();await expect(page.locator('.workspace')).toContainText('Second account');const late=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/projects'&&r.request().method()==='GET');release();await(await late).finished();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await expect(page.locator('.project-card')).toHaveCount(0);await expect(page.locator('.workspace')).toContainText('Second account');
 await page.reload();await expect(page.locator('.workspace')).toContainText('Second account');await expect(page.locator('.project-card')).toHaveCount(0);
});

});
