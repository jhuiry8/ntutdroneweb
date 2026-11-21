import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { FormStore, EquipmentStore, MessageStore } from '../src/worker.js';
import { remindOverdueLoans } from '../src/loan-routes.js';
import { carryAssetLinks, isOverdue } from '../src/loans.js';
import { taipeiToday } from '../src/forms.js';
import { withSiteStore } from './helpers/site-store.js';

// In-memory Durable Object storage whose transactions run one at a time, like the real runtime.
function mockObject(Class) {
    const values = new Map();
    let tail = Promise.resolve();
    const storage = {
        async get(key) { return structuredClone(values.get(key)); },
        async put(key, value) { values.set(key, structuredClone(value)); },
        async delete(keys) { for (const key of [].concat(keys)) values.delete(key); },
        async list({ prefix = '', limit } = {}) {
            const entries = [...values.entries()].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b));
            return new Map(limit ? entries.slice(0, limit) : entries);
        },
        transaction(callback) { const result = tail.then(() => callback(storage)); tail = result.catch(() => {}); return result; }
    };
    const object = new Class({ storage });
    const namespace = { idFromName: name => name, get: () => ({ fetch: (input, init) => namespace.intercept(new Request(input, init)) }), values, intercept: request => object.fetch(request) };
    return namespace;
}

const dayOffset = days => new Date(Date.parse(`${taipeiToday()}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

function fixture() {
    const store = new Map();
    const db = {
        async get(key) { return store.get(key) ?? null; },
        async put(key, value) { store.set(key, typeof value === 'string' ? value : JSON.stringify(value)); },
        async delete(key) { store.delete(key); },
        async list({ prefix }) { return { keys: [...store.keys()].filter(name => name.startsWith(prefix)).map(name => ({ name })) }; }
    };
    for (const name of ['president', 'cadre', 'member']) {
        store.set(`user:${name}`, JSON.stringify({ username: name, role: name, active: true, version: 'v1' }));
        store.set(`session:${name}`, JSON.stringify({ username: name, version: 'v1' }));
    }
    const env = withSiteStore({ DRONE_DB: db, FORM_STORE: mockObject(FormStore), EQUIPMENT_STORE: mockObject(EquipmentStore), MESSAGE_STORE: mockObject(MessageStore) });
    let ip = 0;
    const request = async (path, who, method = 'GET', rawBody) => {
        const body = path === '/api/public/equipment-loan' ? { ...rawBody, ...env.SITE_STORE.issueCaptcha() } : rawBody;
        const response = await worker.fetch(new Request(`https://example.com${path}`, {
            method,
            headers: { 'CF-Connecting-IP': `203.0.113.${++ip % 250}`, ...(who ? { Cookie: `session=${who}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) })
        }), env);
        return response;
    };
    const json = async (...args) => { const response = await request(...args); return { status: response.status, body: await response.json().catch(() => null) }; };
    return { env, request, json };
}

async function addAsset(f, fields = {}) {
    const created = await f.json('/api/equipment', 'cadre', 'POST', { assetName: 'DJI Mini 4 Pro', category: '空拍機', ...fields });
    assert.equal(created.status, 201);
    return created.body;
}
const loanData = (items, extra = {}) => ({
    borrower: '張同學', studentId: 'B11200001', phone: '0912345678', purpose: '成果展空拍', fillDate: taipeiToday(),
    startDate: dayOffset(0), startHour: 9, endDate: dayOffset(2), endHour: 18, items, ...extra
});
const assetItem = asset => ({ name: asset.assetName, assetId: asset.id, quantity: 1 });
async function submitPublic(f, items, extra) {
    const created = await f.json('/api/public/equipment-loan', null, 'POST', { data: loanData(items, extra) });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    // The public response carries only the print link; clerks find the record in the list.
    const records = (await f.json('/api/forms?type=equipment-loan', 'cadre')).body;
    return records.find(record => record.number === created.body.number);
}
const getAsset = async (f, id) => (await f.json('/api/equipment', 'cadre')).body.find(asset => asset.id === id);

test('public page only offers assets that can be lent', async () => {
    const f = fixture();
    const ok = await addAsset(f);
    await addAsset(f, { assetName: '壞掉的槳', condition: 'poor' });
    await addAsset(f, { assetName: '維修中的機身', status: 'repair' });
    await addAsset(f, { assetName: '用過的電池', status: 'in_use' });
    const list = await f.json('/api/public/equipment-available');
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.map(asset => asset.id), [ok.id]);
    assert.deepEqual(Object.keys(list.body[0]).sort(), ['assetName', 'category', 'id']);
    // Signed-in members get the same lendable list for the admin form picker, without needing equipment rights.
    assert.equal((await f.json('/api/equipment/available', 'member')).body.length, 1);
    assert.equal((await f.json('/api/equipment/available')).status, 401);
    assert.equal((await f.json('/api/equipment', 'member')).status, 403);
});

test('a slip rejects assets that are unknown or cannot be lent', async () => {
    const f = fixture();
    const broken = await addAsset(f, { condition: 'poor' });
    const refused = await f.json('/api/public/equipment-loan', null, 'POST', { data: loanData([assetItem(broken)]) });
    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /無法借用/);
    const unknown = await f.json('/api/forms', 'member', 'POST', { type: 'equipment-loan', data: loanData([{ name: '幽靈', assetId: 'nope', quantity: 1 }]) });
    assert.equal(unknown.status, 400);
    const good = await addAsset(f);
    const twice = await f.json('/api/forms', 'member', 'POST', { type: 'equipment-loan', data: loanData([assetItem(good), assetItem(good)]) });
    assert.equal(twice.status, 400);
});

test('lending marks the asset in use with the borrower and slip number, returning puts it back', async () => {
    const f = fixture();
    const asset = await addAsset(f);
    const slip = await submitPublic(f, [assetItem(asset)]);
    assert.equal(slip.data.items[0].assetNo, asset.assetNo, 'the register fills the asset number');
    assert.equal((await getAsset(f, asset.id)).status, 'storage', 'a pending slip does not hold the asset');

    assert.equal((await f.json(`/api/loans/${slip.id}/lend`, 'member', 'POST')).status, 403);
    const lent = await f.json(`/api/loans/${slip.id}/lend`, 'cadre', 'POST');
    assert.equal(lent.status, 200);
    assert.equal(lent.body.loan.status, 'lent');
    const held = await getAsset(f, asset.id);
    assert.equal(held.status, 'in_use');
    assert.equal(held.currentLoan.borrower, '張同學');
    assert.equal(held.currentLoan.formNumber, slip.number);
    assert.equal(held.currentLoan.formId, slip.id);
    assert.deepEqual((await f.json('/api/public/equipment-available')).body, []);
    assert.equal((await f.json(`/api/loans/${slip.id}/lend`, 'cadre', 'POST')).status, 409, 'lending twice is refused');

    const active = (await f.json('/api/loans', 'cadre')).body;
    assert.equal(active.length, 1);
    assert.equal(active[0].overdue, false);

    const returned = await f.json(`/api/loans/${slip.id}/return`, 'cadre', 'POST');
    assert.equal(returned.status, 200);
    assert.equal(returned.body.loan.status, 'returned');
    const back = await getAsset(f, asset.id);
    assert.equal(back.status, 'storage');
    assert.equal(back.currentLoan, undefined);
    assert.equal((await f.json('/api/public/equipment-available')).body.length, 1);
    assert.equal((await f.json(`/api/loans/${slip.id}/return`, 'cadre', 'POST')).status, 409);
    assert.deepEqual((await f.json('/api/loans', 'cadre')).body, []);
});

test('the same asset cannot be lent to two slips', async () => {
    const f = fixture();
    const asset = await addAsset(f);
    const first = await submitPublic(f, [assetItem(asset)]);
    const second = await submitPublic(f, [assetItem(asset)], { borrower: '李同學' });
    assert.equal((await f.json(`/api/loans/${first.id}/lend`, 'cadre', 'POST')).status, 200);
    const blocked = await f.json(`/api/loans/${second.id}/lend`, 'cadre', 'POST');
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error, /張同學/);
    assert.equal((await f.json(`/api/forms/${second.id}`, 'cadre')).body.loan, undefined, 'the second slip stays pending');
    assert.equal((await getAsset(f, asset.id)).currentLoan.formId, first.id);

    // Two clerks pressing the button at once: exactly one wins.
    const third = await addAsset(f, { assetName: '遙控器' });
    const a = await submitPublic(f, [assetItem(third)]);
    const b = await submitPublic(f, [assetItem(third)], { borrower: '王同學' });
    const results = await Promise.all([a, b].map(slip => f.json(`/api/loans/${slip.id}/lend`, 'cadre', 'POST')));
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
});

test('lending several assets is all or nothing', async () => {
    const f = fixture();
    const drone = await addAsset(f);
    const battery = await addAsset(f, { assetName: '電池' });
    const other = await submitPublic(f, [assetItem(battery)], { borrower: '李同學' });
    const both = await submitPublic(f, [assetItem(drone), assetItem(battery)]);
    await f.json(`/api/loans/${other.id}/lend`, 'cadre', 'POST');
    const blocked = await f.json(`/api/loans/${both.id}/lend`, 'cadre', 'POST');
    assert.equal(blocked.status, 409);
    assert.equal((await getAsset(f, drone.id)).status, 'storage', 'the free asset is not left half-lent');
});

test('a slip that cannot be saved releases its equipment, and approving again works', async () => {
    const f = fixture();
    const asset = await addAsset(f);
    const slip = await submitPublic(f, [assetItem(asset)]);
    const namespace = f.env.FORM_STORE;
    const original = namespace.intercept;
    let failures = 1;
    namespace.intercept = request => (request.url.endsWith('/loan-transition') && failures-- > 0)
        ? Promise.resolve(Response.json({ error: 'boom' }, { status: 500 })) : original(request);
    const failed = await f.json(`/api/loans/${slip.id}/lend`, 'cadre', 'POST');
    assert.equal(failed.status, 500);
    assert.equal((await getAsset(f, asset.id)).status, 'storage', 'rolled back');
    assert.deepEqual((await f.json(`/api/equipment/${asset.id}/history`, 'cadre')).body.history, [], 'rollback leaves no history');
    assert.equal((await f.json(`/api/loans/${slip.id}/lend`, 'cadre', 'POST')).status, 200, 'retry succeeds');
    assert.equal((await getAsset(f, asset.id)).status, 'in_use');
});

test('an asset left held by a failed rollback is repaired by approving again', async () => {
    const f = fixture();
    const asset = await addAsset(f);
    const slip = await submitPublic(f, [assetItem(asset)]);
    // Hold the asset for the slip directly, as if the slip save and the rollback both failed.
    await f.env.EQUIPMENT_STORE.intercept(new Request('https://equipment-store/lend', { method: 'POST', body: JSON.stringify({ formId: slip.id, formNumber: slip.number, borrower: '張同學', assetIds: [asset.id] }) })).catch(() => {});
    assert.equal((await f.json(`/api/loans/${slip.id}/lend`, 'cadre', 'POST')).status, 200);
    assert.equal((await getAsset(f, asset.id)).currentLoan.formId, slip.id);
});

test('rejecting a pending slip frees equipment held for it', async () => {
    const f = fixture();
    const asset = await addAsset(f);
    const slip = await submitPublic(f, [assetItem(asset)]);
    const rejected = await f.json(`/api/loans/${slip.id}/reject`, 'cadre', 'POST');
    assert.equal(rejected.body.loan.status, 'rejected');
    assert.equal((await f.json(`/api/loans/${slip.id}/lend`, 'cadre', 'POST')).status, 409);
});

test('each asset keeps a borrowing history', async () => {
    const f = fixture();
    const asset = await addAsset(f);
    for (const borrower of ['甲', '乙']) {
        const slip = await submitPublic(f, [assetItem(asset)], { borrower });
        await f.json(`/api/loans/${slip.id}/lend`, 'cadre', 'POST');
        if (borrower === '甲') await f.json(`/api/loans/${slip.id}/return`, 'cadre', 'POST');
    }
    const history = (await f.json(`/api/equipment/${asset.id}/history`, 'cadre')).body.history;
    assert.deepEqual(history.map(entry => entry.borrower), ['乙', '甲'], 'newest first');
    assert.equal(history[0].returnedAt, '');
    assert.ok(history[1].returnedAt);
    assert.equal(history[1].lentBy, 'cadre');
    assert.equal((await f.json(`/api/equipment/${asset.id}/history`, 'member')).status, 403);
    assert.equal((await f.json('/api/equipment/missing/history', 'cadre')).status, 404);
});

test('equipment on loan cannot be edited back to storage by hand', async () => {
    const f = fixture();
    const asset = await addAsset(f);
    const slip = await submitPublic(f, [assetItem(asset)]);
    await f.json(`/api/loans/${slip.id}/lend`, 'cadre', 'POST');
    const patched = await f.json(`/api/equipment/${asset.id}`, 'cadre', 'PATCH', { status: 'storage' });
    assert.equal(patched.status, 409);
    assert.equal((await f.json(`/api/equipment/${asset.id}`, 'cadre', 'PATCH', { location: '3 號櫃' })).status, 200);
    const after = await getAsset(f, asset.id);
    assert.equal(after.status, 'in_use');
    assert.equal(after.currentLoan.formId, slip.id, 'ordinary edits keep the loan');
});

test('editing and deleting a lent slip is guarded; clients that drop assetId keep the link', async () => {
    const f = fixture();
    const asset = await addAsset(f);
    const created = await f.json('/api/forms', 'member', 'POST', { type: 'equipment-loan', data: loanData([assetItem(asset)]) });
    assert.equal(created.status, 201);
    const id = created.body.id;
    // The desktop app sends items without assetId.
    const desktop = await f.json(`/api/forms/${id}`, 'member', 'PUT', { data: loanData([{ name: asset.assetName, assetNo: asset.assetNo, quantity: 1 }], { purpose: '改用途' }) });
    assert.equal(desktop.status, 200);
    assert.equal(desktop.body.data.items[0].assetId, asset.id);
    await f.json(`/api/loans/${id}/lend`, 'cadre', 'POST');
    const swap = await f.json(`/api/forms/${id}`, 'member', 'PUT', { data: loanData([{ name: '別的東西', quantity: 1 }]) });
    assert.equal(swap.status, 409);
    assert.equal((await f.json(`/api/forms/${id}`, 'member', 'PUT', { data: loanData([assetItem(asset)], { endDate: dayOffset(5) }) })).status, 200, 'extending the due date is fine');
    assert.equal((await f.json(`/api/forms/${id}`, 'member', 'DELETE')).status, 409);
    await f.json(`/api/loans/${id}/return`, 'cadre', 'POST');
    assert.equal((await f.json(`/api/forms/${id}`, 'member', 'DELETE')).status, 200);
});

test('slips with only typed text still work and can be lent', async () => {
    const f = fixture();
    const asset = await addAsset(f);
    const typed = await f.json('/api/forms', 'member', 'POST', { type: 'equipment-loan', data: loanData([{ name: '某台機身', assetNo: asset.assetNo.toLowerCase(), quantity: 1 }]) });
    assert.equal(typed.status, 201);
    assert.equal(typed.body.data.items[0].assetId, '');
    const lent = await f.json(`/api/loans/${typed.body.id}/lend`, 'cadre', 'POST');
    assert.equal(lent.status, 200);
    assert.deepEqual(lent.body.loan.assetIds, [asset.id], 'the typed asset number is matched to the register');
    const free = await f.json('/api/forms', 'member', 'POST', { type: 'equipment-loan', data: loanData([{ name: '手寫的腳架', quantity: 2 }]) });
    const freeLent = await f.json(`/api/loans/${free.body.id}/lend`, 'cadre', 'POST');
    assert.equal(freeLent.status, 200);
    assert.deepEqual(freeLent.body.loan.assetIds, []);
    assert.equal((await f.json(`/api/loans/${free.body.id}/return`, 'cadre', 'POST')).status, 200);
});

test('overdue slips are listed and reminded once a day', async () => {
    const f = fixture();
    const asset = await addAsset(f);
    const late = await f.json('/api/forms', 'member', 'POST', { type: 'equipment-loan', data: loanData([assetItem(asset)], { startDate: dayOffset(-10), endDate: dayOffset(-3) }) });
    const onTime = await f.json('/api/forms', 'member', 'POST', { type: 'equipment-loan', data: loanData([{ name: '腳架', quantity: 1 }]) });
    for (const slip of [late, onTime]) await f.json(`/api/loans/${slip.body.id}/lend`, 'cadre', 'POST');

    const overdue = await f.json('/api/loans?state=overdue', 'cadre');
    assert.deepEqual(overdue.body.map(loan => loan.id), [late.body.id]);
    assert.equal(overdue.body[0].daysOverdue, 3);
    assert.equal((await f.json('/api/loans?state=overdue', 'member')).status, 403);
    assert.equal((await f.json('/api/loans', 'cadre')).body.length, 2);

    // The weekly Cron (scheduled) posts an officers-only announcement.
    const pending = [];
    await worker.scheduled({}, f.env, { waitUntil: promise => pending.push(promise) });
    await Promise.all(pending);
    const announcements = (await f.json('/api/announcements', 'cadre')).body;
    assert.equal(announcements.length, 1);
    assert.equal(announcements[0].audience, 'officers');
    assert.match(announcements[0].content, new RegExp(late.body.number));
    assert.doesNotMatch(announcements[0].content, new RegExp(onTime.body.number));
    assert.equal((await f.json('/api/announcements', 'member')).body.length, 0, 'members do not see it');
    assert.deepEqual(await remindOverdueLoans(f.env), { count: 1, sent: false }, 'not repeated the same day');

    // Once returned there is nothing left to remind about.
    await f.json(`/api/loans/${late.body.id}/return`, 'cadre', 'POST');
    assert.deepEqual(await remindOverdueLoans(f.env, new Date(Date.now() + 86400000)), { count: 0, sent: false });
});

test('reminders never throw when messaging is not configured', async () => {
    const f = fixture();
    delete f.env.MESSAGE_STORE;
    assert.deepEqual(await remindOverdueLoans(f.env), { count: 0, sent: false });
});

test('helpers: overdue timing and asset link carry-over', () => {
    const now = new Date('2026-11-21T06:00:00Z'); // 14:00 in Taipei
    const lent = (endDate, endHour) => ({ type: 'equipment-loan', loan: { status: 'lent' }, data: { endDate, endHour } });
    assert.equal(isOverdue(lent('2026-11-20', 23), now), true);
    assert.equal(isOverdue(lent('2026-11-21', 13), now), true);
    assert.equal(isOverdue(lent('2026-11-21', 18), now), false);
    assert.equal(isOverdue({ ...lent('2026-11-01', 9), loan: { status: 'returned' } }, now), false);
    assert.equal(isOverdue({ type: 'equipment-loan', data: { endDate: '2026-11-01', endHour: 9 } }, now), false, 'old slips without loan state are not lent');
    const previous = [{ name: 'A', assetId: 'a1' }, { name: 'B', assetId: 'b1' }];
    assert.deepEqual(carryAssetLinks(previous, [{ name: 'A' }, { name: 'C' }, { name: 'B', assetId: '' }]), [{ name: 'A', assetId: 'a1' }, { name: 'C' }, { name: 'B', assetId: '' }]);
});
