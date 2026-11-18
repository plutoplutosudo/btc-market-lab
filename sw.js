/* Offline shell only. Exchange quotes and price APIs must never be cached as live. */
const CACHE='btc-market-lab-shell-v7-2026-11-18';
const CORE=['./','./index.html','./style.css','./app.js','./core.mjs','./secondbars.mjs','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==self.location.origin||u.pathname.includes('/api/'))return;
  // Static assets only: serve the saved shell when offline, refresh on next app update.
  if(!CORE.some(p=>u.pathname.endsWith('/'+p.replace('./','')))&&!u.pathname.endsWith('/'))return;
  e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request)));
});
