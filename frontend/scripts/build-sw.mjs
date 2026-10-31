import { readdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const assets = (await readdir('dist/assets')).map(name => `/assets/${name}`)
const paths = ['/index.html', '/icon.svg', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest', ...assets]
const hash = createHash('sha256')
for (const path of paths) hash.update(await readFile(`dist${path}`))
const cache = `hub-static-${hash.digest('hex').slice(0, 16)}`
await writeFile('dist/sw.js', `
const CACHE = ${JSON.stringify(cache)};
const STATIC = ${JSON.stringify(paths)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(STATIC)));
});
// Activate on the next session; never force a reload during a call or a sale.
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('hub-static-') && key !== CACHE).map(key => caches.delete(key)))));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.open(CACHE).then(cache => cache.match('/index.html'))));
  } else if (STATIC.includes(url.pathname) && !url.search) {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(url.pathname)).then(cached => cached || fetch(event.request)));
  }
});
`)
console.log(`PWA: ${paths.length} static files, no API caching (${cache})`)
