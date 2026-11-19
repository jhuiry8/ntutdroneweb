// NTUT Drone Club - Progressive Web App Service Worker
// Bump this whenever the precached shell changes; activate() deletes every other cache
// (v1 could hold private admin pages, so it must not survive).
const CACHE_NAME = 'ntut-drone-pwa-v3';

// Pages that depend on the logged-in user are never written to Cache Storage.
const PRIVATE_PATHS = [/^\/admin(\/|$)/, /^\/meeting\//, /^\/forms\/[^/]+\/(responses|records)/, /^\/login(\/|$)/];

function isPrivatePath(pathname) {
    return PRIVATE_PATHS.some((pattern) => pattern.test(pathname));
}

// Cache Storage ignores Cache-Control, so honour the server's no-store / private here.
function isCacheable(response) {
    if (!response || response.status !== 200 || response.type === 'opaqueredirect') return false;
    const cacheControl = (response.headers.get('Cache-Control') || '').toLowerCase();
    return !cacheControl.includes('no-store') && !cacheControl.includes('private');
}

const STATIC_ASSETS = [
    '/',
    '/style.css',
    '/main.js',
    '/theme.js',
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
                    if (!isPrivatePath(url.pathname) && isCacheable(response)) {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                    }
                    return response;
                })
                .catch(async () => {
                    const cachedResponse = isPrivatePath(url.pathname) ? null : await caches.match(request);
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

    // Same-origin JS/CSS: network-first so a deploy never pairs new HTML with stale scripts.
    if (url.origin === self.location.origin && /\.(css|js)$/i.test(url.pathname) && !url.pathname.startsWith('/vendor/')) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (isCacheable(response)) {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                    }
                    return response;
                })
                .catch(() => caches.match(request))
        );
        return;
    }

    // Images, fonts and versioned vendor files: stale-while-revalidate
    const isStatic = (
        url.pathname.match(/\.(png|jpg|jpeg|svg|webp|woff2?|ico)$/i) ||
        url.pathname.startsWith('/assets/') ||
        url.pathname.startsWith('/vendor/') ||
        url.hostname.includes('fonts.gstatic.com') ||
        url.hostname.includes('fonts.googleapis.com')
    );

    if (isStatic) {
        event.respondWith(
            caches.match(request).then((cachedResponse) => {
                const fetchPromise = fetch(request).then((networkResponse) => {
                    if (isCacheable(networkResponse)) {
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

// 通知中心 (admin-notifications.js): clicking a system notification focuses an open
// back-office tab (and tells it which conversation to show) or opens a new one.
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const data = event.notification.data || {};
    const target = new URL(data.url || '/admin/dashboard', self.location.origin).href;
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
            const tab = clients.find((client) => new URL(client.url).pathname.startsWith('/admin'));
            if (tab) {
                tab.postMessage({ type: 'notification-click', tab: data.tab || 'chat', conv: data.conv || '' });
                return tab.focus();
            }
            return self.clients.openWindow(target);
        })
    );
});
