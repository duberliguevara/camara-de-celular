const CACHE_NAME = 'mis-gastos-v1';
const ASSETS = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'parser.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', function(event){
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys.filter(function(key){ return key !== CACHE_NAME; })
            .map(function(key){ return caches.delete(key); })
      );
    })
  );
  self.clients.claim();
});

// Network-first so updates arrive when there's signal; falls back to cache
// so the app keeps working completely offline.
self.addEventListener('fetch', function(event){
  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then(function(response){
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function(cache){ cache.put(event.request, copy); });
        return response;
      })
      .catch(function(){
        return caches.match(event.request, { ignoreSearch: true });
      })
  );
});
