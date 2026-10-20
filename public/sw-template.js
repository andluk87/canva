const CACHE='forma-shell-__VERSION__';
self.addEventListener('install',event=>{event.waitUntil(fetch('/offline-assets.json',{cache:'reload'}).then(response=>{if(!response.ok)throw new Error('Нет списка ресурсов');return response.json()}).then(assets=>caches.open(CACHE).then(cache=>cache.addAll(['/', '/manifest.webmanifest','/icon.svg',...assets]))).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('forma-shell-')&&key!==CACHE).slice(0,-1).map(key=>caches.delete(key)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
 if(request.mode==='navigate'){
  event.respondWith(fetch(request).then(async response=>{if(response.ok){const cache=await caches.open(CACHE);await cache.put('/',response.clone())}return response}).catch(()=>caches.open(CACHE).then(cache=>cache.match('/')).then(response=>response||new Response('Forma: сначала откройте приложение при доступном интернете.',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}}))));return;
 }
 if(url.pathname.startsWith('/assets/')||['/manifest.webmanifest','/icon.svg'].includes(url.pathname))event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(async response=>{if(response.ok&&response.type==='basic'){const cache=await caches.open(CACHE);await cache.put(request,response.clone())}return response})));
});
