// Serialized storage for paper-form records, form numbers and daily quotas.
// One Durable Object instance handles every write in a storage transaction, so
// concurrent submissions cannot overwrite each other, numbers are never reused,
// and quota checks increment atomically.

import { isExportRequest, exportStorage } from './do-export.js';
const RECORD_PREFIX = 'form:';
const QUOTA_PREFIX = 'quota:';

function reply(status, body) { return { status, body }; }

export class FormStore {
    constructor(ctx) {
        this.storage = ctx.storage;
    }

    async fetch(request) {
        try {
            if (isExportRequest(request)) return await exportStorage(this.storage);
            if (request.method !== 'POST') return Response.json({ error: '方法不允許' }, { status: 405 });
            const path = new URL(request.url).pathname;
            const payload = await request.json();
            const result = await this.storage.transaction(storage => this.handle(path, payload, storage));
            return Response.json(result.body, { status: result.status });
        } catch (error) {
            console.error('Form store operation failed', error?.message || String(error));
            return Response.json({ error: '表單資料操作失敗' }, { status: 500 });
        }
    }

    // Quota counters are kept per day; the first call of a new day clears yesterday's.
    async resetQuotasForDay(storage, day) {
        if (await storage.get('quota-day') === day) return;
        const stale = await storage.list({ prefix: QUOTA_PREFIX });
        if (stale.size) await storage.delete([...stale.keys()]);
        await storage.put('quota-day', day);
    }

    async quotasAvailable(storage, quotas) {
        for (const quota of quotas) {
            if ((await storage.get(QUOTA_PREFIX + quota.key) || 0) >= quota.limit) return false;
        }
        return true;
    }

    async addToQuotas(storage, quotas, delta) {
        for (const quota of quotas) {
            const key = QUOTA_PREFIX + quota.key;
            await storage.put(key, Math.max(0, (await storage.get(key) || 0) + delta));
        }
    }

    async handle(path, payload, storage) {
        if (path === '/list') {
            return reply(200, [...(await storage.list({ prefix: RECORD_PREFIX })).values()]);
        }
        if (path === '/get') {
            const record = await storage.get(RECORD_PREFIX + String(payload.id || ''));
            return record ? reply(200, record) : reply(404, { error: '表單不存在' });
        }
        if (path === '/create') {
            const { record, numberPrefix, cap } = payload;
            const quotas = Array.isArray(payload.quotas) ? payload.quotas : [];
            if (quotas.length) {
                await this.resetQuotasForDay(storage, payload.day);
                if (!(await this.quotasAvailable(storage, quotas))) return reply(429, { error: '今日送出的借據已達上限，請明天再試或直接聯絡幹部' });
            }
            const countKey = `count:${record.source === 'public' ? 'public' : 'internal'}`;
            const count = await storage.get(countKey) || 0;
            if (count >= cap.limit) return reply(409, { error: cap.message });
            // Numbers only ever count up, so a deleted form's number is never issued again.
            const sequenceKey = `seq:${numberPrefix}`;
            const sequence = (await storage.get(sequenceKey) || 0) + 1;
            const saved = { ...record, number: `${numberPrefix}-${String(sequence).padStart(3, '0')}` };
            await storage.put(RECORD_PREFIX + saved.id, saved);
            await storage.put(sequenceKey, sequence);
            await storage.put(countKey, count + 1);
            await this.addToQuotas(storage, quotas, 1);
            return reply(201, saved);
        }
        if (path === '/update') {
            const key = RECORD_PREFIX + String(payload.id || '');
            const record = await storage.get(key);
            if (!record) return reply(404, { error: '表單不存在' });
            const updated = { ...record, ...payload.fields };
            await storage.put(key, updated);
            return reply(200, updated);
        }
        if (path === '/delete') {
            const key = RECORD_PREFIX + String(payload.id || '');
            const record = await storage.get(key);
            if (!record) return reply(404, { error: '表單不存在' });
            await storage.delete(key);
            const countKey = `count:${record.source === 'public' ? 'public' : 'internal'}`;
            await storage.put(countKey, Math.max(0, (await storage.get(countKey) || 0) - 1));
            return reply(200, { success: true });
        }
        if (path === '/quota') {
            const quota = { key: String(payload.key || ''), limit: Number(payload.limit) || 0 };
            await this.resetQuotasForDay(storage, payload.day);
            if (payload.release) {
                await this.addToQuotas(storage, [quota], -1);
                return reply(200, { allowed: true });
            }
            if (!(await this.quotasAvailable(storage, [quota]))) return reply(429, { allowed: false });
            await this.addToQuotas(storage, [quota], 1);
            return reply(200, { allowed: true });
        }
        return reply(404, { error: '表單操作不存在' });
    }
}
