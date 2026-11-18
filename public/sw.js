// NTUT Drone Club - Progressive Web App Service Worker
const CACHE_NAME = 'ntut-drone-pwa-v1';

const STATIC_ASSETS = [
    '/',
    '/style.css',
    '/main.js',
    '/manifest.webmanifest',
    '/offline.html',
    '/vendor/lucide-1.65.0.min.js',
    '/assets/images/logo_ntut.jpg',
    '/assets/images/logo_drone.png',
    '/assets/icons/icon-192x192.png',
    '/assets/icons/icon-512x512.png',
    '/assets/icons/maskable-icon-512x512.png',
    '/apple-touch-icon.png'
];

// Install: Pre-cache app shell assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS).catch((err) => {
                console.warn('[SW] Cache addAll failed, caching individually:', err);
                return Promise.allSettled(
                    STATIC_ASSETS.map((url) => cache.add(url))
                );
            });
        }).then(() => self.skipWaiting())
    );
});

// Activate: Clean up old caches & take control immediately
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch: Network-first for HTML pages; Cache-first for static assets
self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);

    // Only handle GET requests and same-origin or known CDN/font assets
    if (request.method !== 'GET') return;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

    // Never cache API endpoints to prevent stale data
    if (url.pathname.startsWith('/api/')) {
        return;
    }

    // HTML navigations: Network-first with offline fallback
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response && response.status === 200) {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                    }
                    return response;
                })
                .catch(async () => {
                    const cachedResponse = await caches.match(request);
                    if (cachedResponse) return cachedResponse;
                    const offlinePage = await caches.match('/offline.html');
                    return offlinePage || new Response('離線模式', {
                        status: 503,
                        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                    });
                })
        );
        return;
    }

    // Static assets (CSS, JS, images, fonts): Stale-while-revalidate or Cache-first
    const isStatic = (
        url.pathname.match(/\.(css|js|png|jpg|jpeg|svg|webp|woff2?|ico)$/i) ||
        url.pathname.startsWith('/assets/') ||
        url.pathname.startsWith('/vendor/') ||
        url.hostname.includes('fonts.gstatic.com') ||
        url.hostname.includes('fonts.googleapis.com')
    );

    if (isStatic) {
        event.respondWith(
            caches.match(request).then((cachedResponse) => {
                const fetchPromise = fetch(request).then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        const copy = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                    }
                    return networkResponse;
                }).catch(() => cachedResponse);

                return cachedResponse || fetchPromise;
            })
        );
        return;
    }

    // Default: Network with cache fallback
    event.respondWith(
        fetch(request).catch(() => caches.match(request))
    );
});
