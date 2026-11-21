import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { MessageStore, FlightStore, EquipmentStore } from '../src/worker.js';
import { taipeiToday, summarizeFlights, certStatus } from '../src/flight-store.js';
import { flightsCsv } from '../src/flight-routes.js';
import { withSiteStore } from './helpers/site-store.js';

function durableObject(Class) {
    const values = new Map();
    let tail = Promise.resolve();
    const storage = {
        async get(key) { return structuredClone(values.get(key)); },
        async put(key, value) { values.set(key, structuredClone(value)); },
        async delete(keys) { for (const key of [].concat(keys)) values.delete(key); },
        async list({ prefix = '', limit = Infinity } = {}) {
            return new Map([...values.entries()].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit));
        },
        transaction(callback) { const result = tail.then(() => callback(storage)); tail = result.catch(() => {}); return result; }
    };
    const object = new Class({ storage });
    return { idFromName: name => name, get: () => ({ fetch: (input, init) => object.fetch(input instanceof Request ? input : new Request(input, init)) }), values };
}

const plusDays = days => new Date(Date.now() + 8 * 3600000 + days * 86400000).toISOString().slice(0, 10);

function fixture() {
    const store = new Map();
    const db = {
        async get(key) { return store.get(key) ?? null; },
        async put(key, value) { store.set(key, typeof value === 'string' ? value : JSON.stringify(value)); },
        async delete(key) { store.delete(key); },
        async list({ prefix }) { return { keys: [...store.keys()].filter(name => name.startsWith(prefix)).map(name => ({ name })) }; }
    };
    const accounts = { president: ['president', ''], cadre1: ['cadre', ''], alice: ['member', 'm1'], bob: ['member', 'm2'] };
    for (const [username, [role, memberId]] of Object.entries(accounts)) {
        store.set(`user:${username}`, JSON.stringify({ username, role, active: true, version: 'v1', memberId }));
        store.set(`session:${username}`, JSON.stringify({ username, version: 'v1' }));
    }
    store.set('members:list', JSON.stringify([{ id: 'm1', name: '王小明' }, { id: 'm2', name: '李小華' }, { id: 'm3', name: '無帳號社員' }]));
    const equipment = durableObject(EquipmentStore);
    const messages = durableObject(MessageStore);
    const env = withSiteStore({ DRONE_DB: db, EQUIPMENT_STORE: equipment, MESSAGE_STORE: messages, FLIGHT_STORE: durableObject(FlightStore) });
    const request = async (path, who, method = 'GET', body) => {
        const response = await worker.fetch(new Request(`https://example.com${path}`, {
            method,
            headers: { ...(who ? { Cookie: `session=${who}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) })
        }), env);
        const type = response.headers.get('Content-Type') || '';
        return { status: response.status, headers: response.headers, body: type.includes('json') ? await response.json() : await response.text() };
    };
    return { request, env, store };
}

const flight = (extra = {}) => ({ date: plusDays(0), location: '操場', type: 'aerial', aircraft: 'Mavic 3', minutes: 30, sorties: 2, weather: '晴', ...extra });

test('flight log needs sign-in and rejects bad input', async () => {
    const { request } = fixture();
    assert.equal((await request('/api/flights')).status, 401);
    assert.equal((await request('/api/flights', 'alice', 'POST', flight({ type: 'racing' }))).status, 400);
    assert.equal((await request('/api/flights', 'alice', 'POST', flight({ minutes: 0 }))).status, 400);
    assert.equal((await request('/api/flights', 'alice', 'POST', flight({ date: plusDays(10) }))).status, 400);
    assert.equal((await request('/api/flights', 'alice', 'POST', flight({ aircraft: '' }))).status, 400);
    assert.equal((await request('/api/flights', 'alice', 'POST', flight({ incident: true }))).status, 400);
    assert.equal((await request('/api/flights', 'alice', 'POST', flight({ assetId: 'nope' }))).status, 404);
});

test('members see only their own flights; officers see everyone', async () => {
    const { request } = fixture();
    assert.equal((await request('/api/flights', 'alice', 'POST', flight())).status, 201);
    assert.equal((await request('/api/flights', 'bob', 'POST', flight({ minutes: 60, incident: true, incidentNote: '硬降' }))).status, 201);
    const mine = await request('/api/flights', 'alice');
    assert.equal(mine.body.length, 1);
    assert.equal(mine.body[0].status, 'pending');
    assert.equal((await request('/api/flights?scope=all', 'alice')).status, 403);
    assert.equal((await request('/api/flights/summary?scope=all', 'alice')).status, 403);
    const all = await request('/api/flights?scope=all', 'cadre1');
    assert.equal(all.body.length, 2);
    assert.equal((await request('/api/flights?scope=all&incident=1', 'cadre1')).body.length, 1);
    const summary = (await request('/api/flights/summary?scope=all', 'cadre1')).body;
    assert.equal(summary.minutes, 90);
    assert.equal(summary.incidents, 1);
    assert.equal(summary.byMember.length, 2);
    const personal = (await request('/api/flights/summary', 'alice')).body;
    assert.equal(personal.minutes, 30);
    assert.equal(personal.sorties, 2);
    assert.equal(personal.byType.aerial.minutes, 30);
    assert.equal(personal.byMember, undefined);
});

test('members cannot touch other people\'s or confirmed records; officers log and confirm', async () => {
    const { request } = fixture();
    const own = (await request('/api/flights', 'alice', 'POST', flight())).body;
    assert.equal((await request(`/api/flights/${own.id}`, 'bob', 'DELETE')).status, 404);
    assert.equal((await request(`/api/flights/${own.id}/confirm`, 'alice', 'POST')).status, 403);
    assert.equal((await request(`/api/flights/${own.id}/confirm`, 'cadre1', 'POST')).body.status, 'confirmed');
    assert.equal((await request(`/api/flights/${own.id}`, 'alice', 'PATCH', { minutes: 99 })).status, 403);
    assert.equal((await request(`/api/flights/${own.id}`, 'cadre1', 'PATCH', { minutes: 45 })).body.minutes, 45);
    // A member cannot register for someone else; an officer can, by account or by roster id.
    assert.equal((await request('/api/flights', 'alice', 'POST', flight({ username: 'bob' }))).body.owner.username, 'alice');
    const forBob = await request('/api/flights', 'cadre1', 'POST', flight({ username: 'bob', type: 'teaching' }));
    assert.equal(forBob.body.status, 'confirmed');
    assert.equal(forBob.body.owner.name, '李小華');
    assert.equal((await request('/api/flights', 'bob')).body.length, 1);
    const noAccount = await request('/api/flights', 'cadre1', 'POST', flight({ memberId: 'm3' }));
    assert.equal(noAccount.status, 201);
    assert.equal((await request('/api/flights', 'cadre1', 'POST', flight({ memberId: 'ghost' }))).status, 404);
    // Own-record confirmation by an officer is refused.
    const officerOwn = (await request('/api/flights', 'cadre1', 'POST', flight())).body;
    assert.equal(officerOwn.status, 'pending');
    assert.equal((await request(`/api/flights/${officerOwn.id}/confirm`, 'cadre1', 'POST')).status, 403);
    assert.equal((await request(`/api/flights/${own.id}`, 'alice', 'DELETE')).status, 403);
    const pending = (await request('/api/flights', 'alice', 'POST', flight())).body;
    assert.equal((await request(`/api/flights/${pending.id}`, 'alice', 'DELETE')).status, 200);
});

test('equipment usage hours are summed per asset', async () => {
    const { request, env } = fixture();
    const created = await request('/api/equipment', 'cadre1', 'POST', { assetName: 'Mini 3', category: '無人機' });
    assert.equal(created.status, 201);
    const assets = (await request('/api/flights/config', 'alice')).body.assets;
    assert.equal(assets.length, 1);
    assert.equal(assets[0].serialNo, undefined);
    const logged = await request('/api/flights', 'alice', 'POST', flight({ aircraft: '', assetId: created.body.id, minutes: 40 }));
    assert.equal(logged.body.aircraft, 'Mini 3');
    await request('/api/flights', 'bob', 'POST', flight({ assetId: created.body.id, minutes: 20 }));
    const usage = (await request('/api/flights/summary?scope=all', 'cadre1')).body.byAsset;
    assert.equal(usage.length, 1);
    assert.equal(usage[0].minutes, 60);
    assert.ok(env);
});

test('CSV export is scoped, escaped and formula-safe', async () => {
    const { request } = fixture();
    await request('/api/flights', 'alice', 'POST', flight({ location: '=HYPERLINK("x")', note: 'a,"b"' }));
    await request('/api/flights', 'bob', 'POST', flight());
    const csv = await request('/api/flights/export.csv', 'alice');
    assert.match(csv.headers.get('Content-Disposition'), /attachment/);
    assert.equal(csv.body.trim().split('\r\n').length, 2);
    assert.ok(csv.body.includes("'=HYPERLINK"));
    assert.ok(csv.body.includes('"a,""b"""'));
    assert.equal((await request('/api/flights/export.csv?scope=all', 'alice')).status, 403);
    assert.equal((await request('/api/flights/export.csv?scope=all', 'cadre1')).body.trim().split('\r\n').length, 3);
    assert.ok(flightsCsv([]).startsWith('﻿'));
});

const cert = (extra = {}) => ({ category: '普通操作證', certNo: 'CAA-001', issueDate: plusDays(-300), expiryDate: plusDays(60), ...extra });

test('certificates: validation, privacy, configurable categories', async () => {
    const { request } = fixture();
    assert.equal((await request('/api/certificates', 'alice', 'POST', cert({ category: '亂填' }))).status, 400);
    assert.equal((await request('/api/certificates', 'alice', 'POST', cert({ expiryDate: plusDays(-400) }))).status, 400);
    assert.equal((await request('/api/certificates', 'alice', 'POST', cert({ photoUrl: 'javascript:alert(1)' }))).status, 400);
    const ok = await request('/api/certificates', 'alice', 'POST', cert({ photoUrl: 'https://example.com/a.jpg' }));
    assert.equal(ok.status, 201);
    assert.equal(ok.body.status, 'expiring90');
    await request('/api/certificates', 'bob', 'POST', cert({ certNo: 'B', expiryDate: plusDays(-5) }));
    assert.equal((await request('/api/certificates', 'alice')).body.length, 1);
    assert.equal((await request('/api/certificates?scope=all', 'alice')).status, 403);
    assert.equal((await request('/api/certificates/summary', 'alice')).status, 403);
    assert.equal((await request('/api/certificates/expiring', 'alice')).status, 403);
    assert.equal((await request(`/api/certificates/${ok.body.id}`, 'bob', 'DELETE')).status, 404);
    const summary = (await request('/api/certificates/summary', 'cadre1')).body;
    assert.deepEqual([summary.total, summary.expiring90, summary.expired, summary.validHolders], [2, 1, 1, 1]);
    const expiring = (await request('/api/certificates/expiring', 'cadre1')).body;
    assert.equal(expiring.expired.length, 1);
    assert.equal(expiring.expiring.length, 1);
    assert.equal((await request('/api/certificates/categories', 'cadre1', 'PUT', { categories: ['A 級', 'B 級'] })).status, 200);
    assert.equal((await request('/api/certificates/categories', 'alice', 'PUT', { categories: ['X'] })).status, 403);
    assert.equal((await request('/api/certificates', 'alice', 'POST', cert())).status, 400);
    assert.equal((await request('/api/certificates', 'alice', 'POST', cert({ category: 'A 級' }))).status, 201);
});

test('daily cron sends each reminder once and leaves the weekly report path alone', async () => {
    const { request, env } = fixture();
    const c = (await request('/api/certificates', 'alice', 'POST', cert({ expiryDate: plusDays(80) }))).body;
    await request('/api/certificates', 'bob', 'POST', cert({ certNo: 'FAR', expiryDate: plusDays(200) }));
    const run = async () => { const pending = []; await worker.scheduled({ cron: '30 1 * * *' }, env, { waitUntil: p => pending.push(p) }); await Promise.all(pending); };
    await run();
    const dm = (await request('/api/messages/c/dm~alice~system', 'alice')).body;
    assert.equal(dm.messages.length, 1);
    assert.match(dm.messages[0].text, /CAA-001/);
    const announcements = (await request('/api/announcements', 'cadre1')).body;
    assert.equal(announcements.length, 1);
    assert.equal((await request('/api/announcements', 'alice')).body.length, 0);
    await run();
    assert.equal((await request('/api/messages/c/dm~alice~system', 'alice')).body.messages.length, 1);
    // Moving the expiry inside 30 days triggers the second notice once.
    await request(`/api/certificates/${c.id}`, 'alice', 'PATCH', { expiryDate: plusDays(20) });
    await run(); await run();
    assert.equal((await request('/api/messages/c/dm~alice~system', 'alice')).body.messages.length, 2);
});

test('flight page and pure helpers', async () => {
    const { request } = fixture();
    assert.equal((await request('/admin/flights')).status, 302);
    const page = await request('/admin/flights', 'alice');
    assert.equal(page.status, 200);
    assert.ok(!page.body.includes('data-tab="club"'));
    assert.ok((await request('/admin/flights', 'cadre1')).body.includes('data-tab="club"'));
    assert.match(taipeiToday(), /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(certStatus({ expiryDate: '2030-01-31' }, '2030-01-01').status, 'expiring30');
    assert.equal(summarizeFlights([]).hours, 0);
});
