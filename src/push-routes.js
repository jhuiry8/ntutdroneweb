// Browser push subscriptions (KV "push:<username>") and the helper that sends a notification
// to some accounts. Subscriptions are per browser; prefs say which kinds that browser wants.
import { sendWebPush, validEndpoint, pushConfigured } from './webpush.js';

const PREFIX = 'push:';
const MAX_PER_USER = 8;
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function readSubs(env, username) {
    try { const list = JSON.parse(await env.DRONE_DB.get(PREFIX + username) || '[]'); return Array.isArray(list) ? list : []; }
    catch { return []; }
}
const writeSubs = (env, username, list) => list.length ? env.DRONE_DB.put(PREFIX + username, JSON.stringify(list)) : env.DRONE_DB.delete(PREFIX + username);

export async function usersWithSubscriptions(env) {
    return (await env.DRONE_DB.list({ prefix: PREFIX })).keys.map(key => key.name.slice(PREFIX.length));
}

// Sends `payload` ({ title, body, tab, conv, url, kind }) to every subscribed browser of `usernames`
// whose prefs allow `payload.kind` ('messages' | 'announcements'). Never throws; dead subscriptions are removed.
export async function pushToUsers(env, usernames, payload, fetcher = fetch) {
    if (!pushConfigured(env)) return 0;
    let sent = 0;
    await Promise.all([...new Set(usernames)].map(async username => {
        try {
            const subs = await readSubs(env, username);
            const dead = new Set();
            await Promise.all(subs.filter(sub => sub.prefs?.[payload.kind] !== false && !sub.prefs?.mute).map(async sub => {
                const result = await sendWebPush(env, sub, payload, { fetcher });
                if (result.ok) sent++;
                if (result.gone) dead.add(sub.endpoint);
            }));
            if (dead.size) await writeSubs(env, username, subs.filter(sub => !dead.has(sub.endpoint)));
        } catch (error) { console.error('Push failed', error?.message || String(error)); }
    }));
    return sent;
}

export async function handlePushRequest(request, env, ctx, deps) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/push/')) return null;
    const user = await deps.sessionUser(request, env);
    if (!user) return json({ error: '未授權' }, 401);

    if (url.pathname === '/api/push/public-key' && request.method === 'GET') {
        return json({ enabled: pushConfigured(env), publicKey: pushConfigured(env) ? env.VAPID_PUBLIC_KEY : '' });
    }
    if (url.pathname === '/api/push/subscribe' && request.method === 'POST') {
        const body = await deps.readJsonLimited(request, 8 * 1024);
        const sub = body?.subscription;
        if (!validEndpoint(sub?.endpoint) || typeof sub?.keys?.p256dh !== 'string' || typeof sub?.keys?.auth !== 'string'
            || sub.keys.p256dh.length > 200 || sub.keys.auth.length > 100) return json({ error: '推播訂閱資料不正確' }, 400);
        const prefs = { announcements: body.prefs?.announcements !== false, messages: body.prefs?.messages !== false, mute: body.prefs?.mute === true };
        // A browser belongs to whoever signed in last: drop this endpoint from every other account.
        for (const name of await usersWithSubscriptions(env)) {
            if (name === user.username) continue;
            const others = await readSubs(env, name);
            if (others.some(item => item.endpoint === sub.endpoint)) await writeSubs(env, name, others.filter(item => item.endpoint !== sub.endpoint));
        }
        const mine = (await readSubs(env, user.username)).filter(item => item.endpoint !== sub.endpoint);
        mine.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, prefs, createdAt: new Date().toISOString() });
        await writeSubs(env, user.username, mine.slice(-MAX_PER_USER));
        return json({ ok: true });
    }
    if (url.pathname === '/api/push/unsubscribe' && request.method === 'POST') {
        const endpoint = (await deps.readJsonLimited(request, 4 * 1024))?.endpoint;
        const mine = await readSubs(env, user.username);
        await writeSubs(env, user.username, mine.filter(item => item.endpoint !== endpoint));
        return json({ ok: true });
    }
    return json({ error: 'Not Found' }, 404);
}
