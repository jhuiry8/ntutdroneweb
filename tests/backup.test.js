import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { runBackup, runBackupRecorded, BACKUP_STATUS_KEY, pruneBackups, backupKey, exportKv, BACKUP_KEEP, BACKUP_CRON } from '../src/backup.js';
import { EquipmentStore } from '../src/equipment-store.js';
import { FormStore } from '../src/form-store.js';
import { SiteStore } from '../src/site-store.js';
import { MeetingStore } from '../src/meetings.js';
import { MessageStore } from '../src/messages.js';
import { withSiteStore } from './helpers/site-store.js';

function kv(initial = {}) {
    const store = new Map(Object.entries(initial));
    return {
        gets: 0,
        async get(key) {
            this.gets++;
            if (Array.isArray(key)) return new Map(key.filter(name => store.has(name)).map(name => [name, store.get(name)]));
            return store.has(key) ? store.get(key) : null;
        },
        async put(key, value) { store.set(key, value); },
        async delete(key) { store.delete(key); },
        async list({ prefix }) { return { keys: [...store.keys()].filter(name => name.startsWith(prefix)).map(name => ({ name })) }; },
        _store: store
    };
}

function r2() {
    const objects = new Map();
    return {
        objects,
        async put(key, body) { objects.set(key, body); },
        async get(key) { return objects.has(key) ? { body: objects.get(key) } : null; },
        async delete(keys) { for (const key of [].concat(keys)) objects.delete(key); },
        // Two per page so pagination is exercised.
        async list({ prefix, cursor }) {
            const all = [...objects.keys()].filter(key => key.startsWith(prefix)).sort();
            const start = cursor ? Number(cursor) : 0;
            const slice = all.slice(start, start + 2);
            return { objects: slice.map(key => ({ key })), truncated: start + 2 < all.length, cursor: String(start + 2) };
        }
    };
}

// A Durable Object namespace backed by a plain Map, like the real storage API.
function namespace(Store, entries, kvForEnv) {
    const values = new Map(entries);
    const storage = { list: async () => new Map([...values].sort(([a], [b]) => a.localeCompare(b))), transaction: cb => cb(storage) };
    const object = new Store({ storage }, { DRONE_DB: kvForEnv });
    return { idFromName: name => name, get: () => ({ fetch: (input, init) => object.fetch(new Request(input, init)) }) };
}

function fullEnv() {
    const drone = kv({
        'user:admin': '{"username":"admin","passwordHash":"x"}', 'user:bob': '{"username":"bob"}',
        'session:abc': 'bob', 'members:list': '[1]', 'finance:budgets': '[]', posts_list: '[]', 'post:hello': '{"t":1}', unrelated: 'no'
    });
    return {
        DRONE_DB: drone, BACKUPS: r2(),
        EQUIPMENT_STORE: namespace(EquipmentStore, [['equipment:initialized', true], ['equipment:asset:a1', { id: 'a1', assetNo: 'N1' }]], drone),
        FORM_STORE: namespace(FormStore, [['form:f1', { id: 'f1' }], ['seq:X', 3]], drone),
        SITE_STORE: namespace(SiteStore, [['captcha:1', { code: 'A' }], ['limit:ip', { count: 1 }]], drone),
        MEETING_STORE: namespace(MeetingStore, [['meeting:m1', { id: 'm1' }]], drone),
        MESSAGE_STORE: namespace(MessageStore, [['channel:c1', { id: 'c1' }]], drone)
    };
}

test('exportKv takes kv-keys, accounts and posts but never sessions', async () => {
    const data = await exportKv(fullEnv().DRONE_DB);
    assert.deepEqual(Object.keys(data).sort(), ['finance:budgets', 'members:list', 'post:hello', 'posts_list', 'user:admin', 'user:bob']);
    assert.equal(data['user:admin'], '{"username":"admin","passwordHash":"x"}');
});

test('runBackup writes one dated JSON with KV and every Durable Object', async () => {
    const env = fullEnv();
    const result = await runBackup(env, new Date('2026-11-21T03:00:00Z'));
    assert.equal(result.key, 'backups/2026-11-21.json');
    const backup = JSON.parse(new TextDecoder().decode(env.BACKUPS.objects.get('backups/2026-11-21.json')));
    assert.equal(backup.createdAt, '2026-11-21T03:00:00.000Z');
    assert.equal(backup.kv['members:list'], '[1]');
    assert.deepEqual(Object.keys(backup.durableObjects).sort(), ['EQUIPMENT_STORE', 'FORM_STORE', 'MEETING_STORE', 'MESSAGE_STORE', 'SITE_STORE']);
    assert.deepEqual(backup.durableObjects.EQUIPMENT_STORE.map(([key]) => key), ['equipment:asset:a1', 'equipment:initialized']);
    assert.deepEqual(backup.durableObjects.FORM_STORE.map(([key]) => key), ['form:f1', 'seq:X']);
    assert.deepEqual(backup.durableObjects.MEETING_STORE, [['meeting:m1', { id: 'm1' }]]);
    assert.deepEqual(backup.durableObjects.MESSAGE_STORE, [['channel:c1', { id: 'c1' }]]);
    // CAPTCHA challenges and rate-limit counters are throwaway.
    assert.deepEqual(backup.durableObjects.SITE_STORE, []);
});

test('a failing Durable Object export aborts without writing or pruning', async () => {
    const env = fullEnv();
    env.BACKUPS.objects.set('backups/2026-01-01.json', '{}');
    env.FORM_STORE = { idFromName: n => n, get: () => ({ fetch: async () => new Response('x', { status: 500 }) }) };
    await assert.rejects(runBackup(env), /export failed/);
    assert.deepEqual([...env.BACKUPS.objects.keys()], ['backups/2026-01-01.json']);
});

test('pruneBackups keeps only the newest N dated files and ignores other objects', async () => {
    const bucket = r2();
    for (let day = 0; day < 35; day++) bucket.objects.set(backupKey(new Date(Date.UTC(2026, 9, 1 + day)).toISOString().slice(0, 10)), '{}');
    bucket.objects.set('backups/readme.txt', 'keep');
    const total = [...bucket.objects.keys()].filter(key => key.endsWith('.json')).length;
    const pruned = await pruneBackups(bucket, 30);
    assert.equal(pruned.length, total - 30);
    const left = [...bucket.objects.keys()].filter(key => key.endsWith('.json')).sort();
    assert.equal(left.length, 30);
    assert.ok(pruned.every(key => key < left[0]));
    assert.ok(bucket.objects.has('backups/readme.txt'));
    assert.equal(BACKUP_KEEP, 30);
    assert.deepEqual((await pruneBackups(bucket, 0)).sort(), left.slice(0, -1), 'never deletes the newest backup');
});

test('scheduled() runs the backup on the backup cron and the weekly report otherwise', async t => {
    t.mock.method(console, 'error', () => {});
    const env = fullEnv();
    const jobs = [];
    const ctx = { waitUntil: promise => jobs.push(promise) };
    await worker.scheduled({ cron: BACKUP_CRON }, env, ctx);
    await Promise.all(jobs);
    assert.equal([...env.BACKUPS.objects.keys()].length, 1);
    await worker.scheduled({ cron: '0 1 * * 1' }, env, ctx);
    await Promise.all(jobs);
    assert.equal([...env.BACKUPS.objects.keys()].length, 1, 'weekly cron does not back up');
    assert.equal(env.BACKUPS.objects.size, 1);
});

test('backup API is president-only', async () => {
    const env = withSiteStore(fullEnv());
    for (const [key, value] of Object.entries({
        'session:boss': 'admin', 'session:cash': JSON.stringify({ username: 'finance1', version: 'v1' }),
        'user:finance1': JSON.stringify({ username: 'finance1', role: 'finance', active: true, version: 'v1' })
    })) env.DRONE_DB._store.set(key, value);
    env.DRONE_DB._store.delete('user:admin');
    const call = (method, path, cookie) => worker.fetch(new Request(`https://example.com${path}`, { method, headers: cookie ? { Cookie: cookie } : {} }), env);
    assert.equal((await call('POST', '/api/backup/run')).status, 401);
    assert.equal((await call('POST', '/api/backup/run', 'session=cash')).status, 403);
    assert.equal((await call('GET', '/api/backup/latest', 'session=cash')).status, 403);
    assert.equal((await call('GET', '/api/backup/latest', 'session=boss')).status, 404);
    const run = await call('POST', '/api/backup/run', 'session=boss');
    assert.equal(run.status, 201);
    const download = await call('GET', '/api/backup/latest', 'session=boss');
    assert.equal(download.status, 200);
    assert.match(download.headers.get('Content-Disposition'), /backups|\d{4}-\d{2}-\d{2}\.json/);
    assert.equal(JSON.parse(await download.text()).format, 1);
    delete env.BACKUPS;
    assert.equal((await call('POST', '/api/backup/run', 'session=boss')).status, 503);
});

test('size is reported in bytes, not characters', async () => {
    const env = fullEnv();
    env.DRONE_DB._store.set('posts_list', '"社團公告測試"');
    const result = await runBackup(env, new Date('2026-11-21T03:00:00Z'));
    assert.equal(result.bytes, env.BACKUPS.objects.get(result.key).byteLength);
    assert.ok(result.bytes > new TextDecoder().decode(env.BACKUPS.objects.get(result.key)).length);
});

test('KV is read in bulk: many keys cost few subrequests', async () => {
    const env = fullEnv();
    for (let i = 0; i < 250; i++) env.DRONE_DB._store.set(`user:u${i}`, `{"username":"u${i}"}`);
    env.DRONE_DB.gets = 0;
    const data = await exportKv(env.DRONE_DB);
    assert.equal(Object.keys(data).filter(key => key.startsWith('user:')).length, 252);
    assert.ok(env.DRONE_DB.gets <= 4, `expected bulk reads, got ${env.DRONE_DB.gets} gets`);
    // A KV without bulk get still works, one read per key.
    const plain = { ...env.DRONE_DB, async get(key) { return Array.isArray(key) ? null : env.DRONE_DB._store.get(key) ?? null; } };
    assert.equal(Object.keys(await exportKv(plain)).length, Object.keys(data).length);
    // A KV that rejects bulk get (local wrangler dev, older runtimes) also falls back.
    const throwing = { ...env.DRONE_DB, async get(key) { if (Array.isArray(key)) throw new Error('KV GET_BULK failed: 405 Method Not Allowed'); return env.DRONE_DB._store.get(key) ?? null; } };
    assert.equal(Object.keys(await exportKv(throwing)).length, Object.keys(data).length);
});

test('backup status is recorded, and a failure alerts the webhook and is rethrown', async t => {
    const env = fullEnv();
    const posts = [];
    t.mock.method(globalThis, 'fetch', async (url, init) => { posts.push({ url, body: JSON.parse(init.body) }); return new Response('ok'); });
    await runBackupRecorded(env, { trigger: 'cron', now: new Date('2026-11-21T03:00:00Z') });
    const ok = JSON.parse(env.DRONE_DB._store.get(BACKUP_STATUS_KEY));
    assert.deepEqual([ok.ok, ok.trigger, ok.key], [true, 'cron', 'backups/2026-11-21.json']);
    assert.equal(posts.length, 0);

    env.REPORT_WEBHOOK_URL = 'https://hooks.example.com/x';
    env.FORM_STORE = { idFromName: n => n, get: () => ({ fetch: async () => new Response('x', { status: 500 }) }) };
    await assert.rejects(runBackupRecorded(env, { trigger: 'cron', now: new Date('2026-11-22T03:00:00Z') }), /export failed/);
    const failed = JSON.parse(env.DRONE_DB._store.get(BACKUP_STATUS_KEY));
    assert.equal(failed.ok, false);
    assert.match(failed.error, /export failed/);
    assert.equal(posts.length, 1);
    assert.match(posts[0].body.text, /備份失敗/);
    assert.equal(env.BACKUPS.objects.size, 1, 'the earlier backup is untouched');
});

test('president can read backup status', async () => {
    const env = withSiteStore(fullEnv());
    env.DRONE_DB._store.set('session:boss', 'admin');
    env.DRONE_DB._store.delete('user:admin');
    const status = () => worker.fetch(new Request('https://example.com/api/backup/status', { headers: { Cookie: 'session=boss' } }), env);
    assert.deepEqual(await (await status()).json(), { configured: true, latest: null });
    await worker.fetch(new Request('https://example.com/api/backup/run', { method: 'POST', headers: { Cookie: 'session=boss' } }), env);
    assert.equal((await (await status()).json()).latest.trigger, 'manual');
    assert.equal((await worker.fetch(new Request('https://example.com/api/backup/status'), env)).status, 401);
});

test('every Durable Object in wrangler.toml is backed up and answers the export request', async () => {
    const { readFileSync } = await import('node:fs');
    const { DURABLE_OBJECTS } = await import('../src/backup.js');
    const { EXPORT_PATH } = await import('../src/do-export.js');
    const workerModule = await import('../src/worker.js');
    const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
    const bindings = [...toml.matchAll(/\[\[durable_objects\.bindings\]\]\s*name\s*=\s*"([A-Z_]+)"\s*class_name\s*=\s*"(\w+)"/g)].map(match => [match[1], match[2]]);
    assert.ok(bindings.length >= 9);
    const listed = new Set(DURABLE_OBJECTS.map(([binding]) => binding));
    for (const [binding, className] of bindings) {
        assert.ok(listed.has(binding), `${binding} is missing from DURABLE_OBJECTS in src/backup.js`);
        const store = new workerModule[className]({ storage: { list: async () => new Map([['k', 'v']]), transaction: async fn => fn({}) } }, {});
        const response = await store.fetch(new Request(`https://do${EXPORT_PATH}`, { method: 'POST', body: '{}' }));
        assert.deepEqual((await response.json()).entries, [['k', 'v']], `${className} does not answer the backup export`);
    }
});
