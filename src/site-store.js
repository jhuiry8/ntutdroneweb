// Serialized storage for login security state and the CMS content indexes.
//
// KV is eventually consistent and caches reads at the edge, so a KV
// "get then delete" CAPTCHA can be replayed and a KV "read, add one, write"
// counter loses increments under concurrent requests. One Durable Object
// instance runs every operation below one at a time, which makes CAPTCHA use
// single-shot and rate-limit checks atomic.
//
// The post and page lists still live in KV (the public pages read them from
// there), but every change to them goes through this object, so two editors
// saving at once can no longer overwrite each other's list entries.

import { isExportRequest, exportStorage } from './do-export.js';
const CAPTCHA_PREFIX = 'captcha:';
const LIMIT_PREFIX = 'limit:';
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;
const CONTENT_LISTS = ['posts_list', 'pages_list'];

function reply(status, body) { return { status, body }; }

function validKey(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 300;
}

export class SiteStore {
    constructor(ctx, env) {
        this.ctx = ctx;
        this.storage = ctx.storage;
        this.env = env;
        // Content-list changes await KV, which does not hold the Durable
        // Object's input gate, so they are queued explicitly.
        this.contentQueue = Promise.resolve();
    }

    async fetch(request) {
        try {
            // CAPTCHA challenges and rate-limit counters expire within minutes; not worth backing up.
            if (isExportRequest(request)) return await exportStorage(this.storage, { skipPrefixes: [CAPTCHA_PREFIX, LIMIT_PREFIX] });
            if (request.method !== 'POST') return Response.json({ error: '方法不允許' }, { status: 405 });
            const path = new URL(request.url).pathname;
            const payload = await request.json();
            const result = path === '/content-index'
                ? await this.queueContentChange(payload)
                : await this.storage.transaction(storage => this.handle(path, payload, storage, Date.now()));
            return Response.json(result.body, { status: result.status });
        } catch (error) {
            console.error('Site store operation failed', error?.message || String(error));
            return Response.json({ error: '伺服器內部錯誤' }, { status: 500 });
        }
    }

    async scheduleSweep() {
        if (typeof this.storage.getAlarm !== 'function') return;
        if (await this.storage.getAlarm() === null) await this.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
    }

    // Removes expired challenges and counters so storage does not grow forever.
    async alarm() {
        const now = Date.now();
        for (const prefix of [CAPTCHA_PREFIX, LIMIT_PREFIX]) {
            const entries = await this.storage.list({ prefix });
            const stale = [...entries].filter(([, value]) => !value || value.expiresAt <= now).map(([key]) => key);
            for (let i = 0; i < stale.length; i += 128) await this.storage.delete(stale.slice(i, i + 128));
        }
        const remaining = (await this.storage.list({ prefix: CAPTCHA_PREFIX, limit: 1 })).size + (await this.storage.list({ prefix: LIMIT_PREFIX, limit: 1 })).size;
        if (remaining) await this.storage.setAlarm(now + SWEEP_INTERVAL_MS);
    }

    async liveValue(storage, key, now) {
        const entry = await storage.get(key);
        if (!entry) return null;
        if (entry.expiresAt <= now) {
            await storage.delete(key);
            return null;
        }
        return entry;
    }

    async handle(path, payload, storage, now) {
        if (path === '/captcha/create') {
            if (!validKey(payload.id) || typeof payload.code !== 'string') return reply(400, { error: '格式錯誤' });
            await storage.put(CAPTCHA_PREFIX + payload.id, { code: payload.code, expiresAt: now + Number(payload.ttlSeconds) * 1000 });
            await this.scheduleSweep();
            return reply(201, { success: true });
        }
        if (path === '/captcha/take') {
            // Returns the expected answer at most once, then the challenge is gone.
            if (!validKey(payload.id)) return reply(200, { code: null });
            const key = CAPTCHA_PREFIX + payload.id;
            const entry = await this.liveValue(storage, key, now);
            if (entry) await storage.delete(key);
            return reply(200, { code: entry?.code ?? null });
        }
        if (path === '/limit/check') {
            // Atomically checks every counter and, when `hit` is set and none is
            // over its limit, adds one to each in the same step.
            const limits = Array.isArray(payload.limits) ? payload.limits : [];
            if (!limits.every(limit => validKey(limit?.key) && Number.isSafeInteger(limit.max) && Number(limit.windowSeconds) > 0)) return reply(400, { error: '格式錯誤' });
            const entries = [];
            for (const limit of limits) entries.push(await this.liveValue(storage, LIMIT_PREFIX + limit.key, now));
            if (limits.some((limit, index) => (entries[index]?.count || 0) >= limit.max)) return reply(429, { allowed: false });
            if (payload.hit) {
                for (const [index, limit] of limits.entries()) {
                    const entry = entries[index];
                    await storage.put(LIMIT_PREFIX + limit.key, { count: (entry?.count || 0) + 1, expiresAt: entry?.expiresAt ?? now + Number(limit.windowSeconds) * 1000 });
                }
                await this.scheduleSweep();
            }
            return reply(200, { allowed: true });
        }
        if (path === '/limit/hit') {
            const limits = Array.isArray(payload.limits) ? payload.limits : [];
            if (!limits.every(limit => validKey(limit?.key) && Number(limit.windowSeconds) > 0)) return reply(400, { error: '格式錯誤' });
            for (const limit of limits) {
                const entry = await this.liveValue(storage, LIMIT_PREFIX + limit.key, now);
                await storage.put(LIMIT_PREFIX + limit.key, { count: (entry?.count || 0) + 1, expiresAt: entry?.expiresAt ?? now + Number(limit.windowSeconds) * 1000 });
            }
            await this.scheduleSweep();
            return reply(200, { success: true });
        }
        if (path === '/limit/release') {
            // Gives back one attempt taken by /limit/check (e.g. after a successful login).
            if (!validKey(payload.key)) return reply(400, { error: '格式錯誤' });
            const key = LIMIT_PREFIX + payload.key;
            const entry = await this.liveValue(storage, key, now);
            if (entry && entry.count > 1) await storage.put(key, { ...entry, count: entry.count - 1 });
            else if (entry) await storage.delete(key);
            return reply(200, { success: true });
        }
        if (path === '/limit/clear') {
            if (!validKey(payload.key)) return reply(400, { error: '格式錯誤' });
            await storage.delete(LIMIT_PREFIX + payload.key);
            return reply(200, { success: true });
        }
        return reply(404, { error: '操作不存在' });
    }

    queueContentChange(payload) {
        const run = this.contentQueue.then(() => this.changeContentIndex(payload));
        this.contentQueue = run.catch(() => {});
        return run;
    }

    // Removes the given slugs from a content list and optionally adds one entry.
    async changeContentIndex(payload) {
        const listKey = payload.list;
        if (!CONTENT_LISTS.includes(listKey)) return reply(400, { error: '列表無效' });
        const remove = Array.isArray(payload.remove) ? payload.remove.map(String) : [];
        const kv = this.env.DRONE_DB;
        const stored = await kv.get(listKey);
        let list = stored ? JSON.parse(stored) : [];
        if (!Array.isArray(list)) list = [];
        list = list.filter(item => !remove.includes(item?.slug));
        if (payload.add && typeof payload.add === 'object') {
            list = list.filter(item => item?.slug !== payload.add.slug);
            list.push(payload.add);
        }
        if (payload.sortByDate) list.sort((a, b) => new Date(b.date) - new Date(a.date));
        await kv.put(listKey, JSON.stringify(list));
        return reply(200, { success: true });
    }
}
