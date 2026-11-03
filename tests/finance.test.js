import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { EquipmentStore } from '../src/worker.js';

function createMockKV(initial = {}) {
    const store = new Map(Object.entries(initial));
    return {
        async get(key) { return store.get(key) ?? null; },
        async put(key, value) { store.set(key, typeof value === 'string' ? value : JSON.stringify(value)); },
        async delete(key) { store.delete(key); },
        async list({ prefix }) { return { keys: [...store.keys()].filter(name => name.startsWith(prefix)).map(name => ({ name })) }; },
        store
    };
}

function createMockEquipmentStore() {
    const values = new Map();
    let transactionTail = Promise.resolve();
    const storage = {
        async get(key) { return values.get(key); },
        async put(key, value) { values.set(key, structuredClone(value)); },
        async delete(key) { return values.delete(key); },
        async list({ prefix = '', limit = Infinity } = {}) { return new Map([...values.entries()].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit)); },
        transaction(callback) {
            const result = transactionTail.then(() => callback(storage));
            transactionTail = result.catch(() => {});
            return result;
        }
    };
    const object = new EquipmentStore({ storage });
    return { idFromName: name => name, get: () => ({ fetch: (input, init) => object.fetch(input instanceof Request ? input : new Request(input, init)) }), values };
}

function fixture() {
    const db = createMockKV();
    for (const role of ['president', 'finance', 'cadre', 'member']) {
        db.store.set(`user:${role}`, JSON.stringify({ username: role, role, active: true, version: 'v1' }));
        db.store.set(`session:${role}`, JSON.stringify({ username: role, version: 'v1' }));
    }
    const equipmentStore = createMockEquipmentStore();
    const env = { DRONE_DB: db, EQUIPMENT_STORE: equipmentStore };
    const request = (path, role, method = 'GET', body) => worker.fetch(new Request(`https://example.com${path}`, {
        method,
        headers: { ...(role ? { Cookie: `session=${role}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }), env);
    return { db, request, equipmentStore };
}

test('finance submits transactions and only presidents can approve them', async () => {
    const { request } = fixture();
    assert.equal((await request('/api/finance/summary', 'cadre')).status, 403);
    const submitted = await request('/api/finance/transactions', 'finance', 'POST', {
        date: '2026-05-14', item: '社費：魏子庭', kind: 'income', account: 'cash', amount: 300
    });
    assert.equal(submitted.status, 201);
    const transaction = await submitted.json();
    assert.equal(transaction.status, 'pending');
    let summary = await (await request('/api/finance/summary', 'finance')).json();
    assert.deepEqual(summary.totals, { cashBalance: 0, postalBalance: 0, income: 0, expense: 0, pendingCount: 1, pendingIncome: 300, pendingExpense: 0 });
    assert.equal((await request(`/api/finance/transactions/${transaction.id}/review`, 'finance', 'PATCH', { status: 'approved' })).status, 403);
    assert.equal((await request(`/api/finance/transactions/${transaction.id}/review`, 'president', 'PATCH', { status: 'approved' })).status, 200);
    summary = await (await request('/api/finance/summary', 'finance')).json();
    assert.equal(summary.totals.cashBalance, 300);
    const transfer = await request('/api/finance/transactions', 'finance', 'POST', {
        date: '2026-05-29', item: '社費存郵局', kind: 'transfer', account: 'cash', amount: 250
    });
    const transferItem = await transfer.json();
    assert.equal(transferItem.cashDelta, -250);
    assert.equal(transferItem.postalDelta, 250);
    await request(`/api/finance/transactions/${transferItem.id}/review`, 'president', 'PATCH', { status: 'approved' });
    summary = await (await request('/api/finance/summary', 'president')).json();
    assert.equal(summary.totals.cashBalance, 50);
    assert.equal(summary.totals.postalBalance, 250);
});

test('finance can delete rejected transactions only', async () => {
    const { request } = fixture();
    const pendingResponse = await request('/api/finance/transactions', 'finance', 'POST', {
        date: '2026-10-29', item: '測試退回帳目', kind: 'expense', account: 'cash', amount: 500
    });
    const rejected = await pendingResponse.json();
    await request(`/api/finance/transactions/${rejected.id}/review`, 'president', 'PATCH', { status: 'rejected', note: '資料不完整' });
    assert.equal((await request(`/api/finance/transactions/${rejected.id}`, 'cadre', 'DELETE')).status, 403);
    assert.equal((await request(`/api/finance/transactions/${rejected.id}`, 'finance', 'DELETE')).status, 200);
    assert.deepEqual(await (await request('/api/finance/summary', 'finance')).json().then(summary => summary.transactions), []);

    const approvedResponse = await request('/api/finance/transactions', 'finance', 'POST', {
        date: '2026-10-29', item: '測試核准帳目', kind: 'expense', account: 'cash', amount: 100
    });
    const approved = await approvedResponse.json();
    await request(`/api/finance/transactions/${approved.id}/review`, 'president', 'PATCH', { status: 'approved' });
    assert.equal((await request(`/api/finance/transactions/${approved.id}`, 'finance', 'DELETE')).status, 409);
});

test('spreadsheet import accepts the requested cash and postal balance format', async () => {
    const { request } = fixture();
    const imported = await request('/api/finance/import', 'finance', 'POST', { rows: [
        { date: '2026/5/14', item: '社費。魏子庭', income: '300', expense: '', cashBalance: '300', postalBalance: '0' },
        { date: '2026/5/28', item: '社團印章', income: '', expense: '352', cashBalance: '848', postalBalance: '0' },
        { date: '2026/5/29', item: '社費存郵局', income: '', expense: '', cashBalance: '48', postalBalance: '800' }
    ] });
    assert.equal(imported.status, 201);
    const data = await imported.json();
    assert.equal(data.imported, 3);
    assert.equal(data.transactions[0].cashDelta, 300);
    assert.equal(data.transactions[1].cashDelta, 548, 'The recorded balances are authoritative for historic imports');
    assert.deepEqual({ cash: data.transactions[2].cashDelta, postal: data.transactions[2].postalDelta }, { cash: -800, postal: 800 });
    assert.ok(data.transactions.every(item => item.status === 'pending'));
    const bad = await request('/api/finance/import', 'finance', 'POST', { rows: [{ date: '2026/2/30', item: '錯誤', income: 1, expense: 1, cashBalance: 1, postalBalance: 0 }] });
    assert.equal(bad.status, 400);
});

test('budget categories track approved expense and reject malformed imports', async () => {
    const { request } = fixture();
    const budgets = await request('/api/finance/budgets', 'finance', 'PUT', { budgets: [{ id: 'gear', name: '器材', planned: 20000 }] });
    assert.equal(budgets.status, 200);
    const expense = await request('/api/finance/transactions', 'finance', 'POST', { date: '2026-06-01', item: '螺旋槳', kind: 'expense', account: 'postal', amount: 1000, budgetId: 'gear' });
    const item = await expense.json();
    await request(`/api/finance/transactions/${item.id}/review`, 'president', 'PATCH', { status: 'approved' });
    const summary = await (await request('/api/finance/summary', 'finance')).json();
    assert.deepEqual(summary.budgets, [{ id: 'gear', name: '器材', planned: 20000, spent: 1000 }]);
    const invalid = await request('/api/finance/budgets', 'finance', 'PUT', { budgets: [{ name: '器材', planned: 1 }, { name: '器材', planned: 2 }] });
    assert.equal(invalid.status, 400);
});

test('finance can search, add, and delete member records without granting access to cadres', async () => {
    const { request } = fixture();
    assert.equal((await request('/api/members', 'cadre')).status, 403);
    const created = await request('/api/members', 'finance', 'POST', { name: '王同學', studentId: '1152B0013', email: 'member@example.com', phone: '0912345678', joinedAt: '2026-05-14' });
    assert.equal(created.status, 201);
    const member = await created.json();
    assert.equal((await request('/api/members', 'finance', 'POST', { name: '重複', studentId: '1152B0013', joinedAt: '2026-05-14' })).status, 409);
    const listed = await (await request('/api/members?q=1152b0013', 'finance')).json();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].name, '王同學');
    assert.equal((await request(`/api/members/${member.id}`, 'finance', 'DELETE')).status, 200);
    assert.deepEqual(await (await request('/api/members', 'finance')).json(), []);
});

test('member batch import skips duplicates safely and reports security headers', async () => {
    const { request, db } = fixture();
    await request('/api/members', 'finance', 'POST', { name: '既有社員', studentId: '1152B0013' });
    const response = await request('/api/members/import', 'finance', 'POST', { rows: [
        { name: '既有社員改名', studentId: '1152b0013' },
        { name: '新社員', studentId: '1152B0099', joinedAt: '2026-09-01' },
        { name: '重複新社員', studentId: '1152b0099' },
        { name: '新社員' }
    ] });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.deepEqual(await response.json(), {
        imported: 1,
        skipped: 3,
        skippedRows: [
            { row: 1, name: '既有社員改名', studentId: '1152B0013' },
            { row: 3, name: '重複新社員', studentId: '1152B0099' },
            { row: 4, name: '新社員', studentId: '' }
        ]
    });
    const members = JSON.parse(db.store.get('members:list'));
    assert.equal(members.length, 2);
    assert.equal((await request('/api/members/import', 'cadre', 'POST', { rows: [{ name: '不得匯入' }] })).status, 403);
});

test('cross-origin writes are rejected before changing state', async () => {
    const { db } = fixture();
    const response = await worker.fetch(new Request('https://example.com/api/members/import', {
        method: 'POST',
        headers: { Cookie: 'session=finance', Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: [{ name: '惡意請求' }] })
    }), { DRONE_DB: db });
    assert.equal(response.status, 403);
    assert.equal(db.store.has('members:list'), false);
});

test('equipment inventory creates unique labels, validates fields, and protects asset numbers', async () => {
    const { request, equipmentStore } = fixture();
    assert.equal((await request('/api/equipment', 'member')).status, 403);
    const created = await request('/api/equipment', 'cadre', 'POST', {
        assetName: 'DJI Mini 4 Pro', category: '空拍機', serialNo: 'SN-001',
        purchaseDate: '2026-08-12', purchasePrice: 28900, condition: 'good',
        status: 'storage', location: '器材櫃 A', custodian: '器材長', note: '含電池與遙控器'
    });
    assert.equal(created.status, 201);
    const asset = await created.json();
    assert.match(asset.assetNo, /^NTUT-DR-\d{4}-[A-F0-9]{10}$/);
    assert.equal(asset.createdBy, 'cadre');
    assert.equal((await request('/api/equipment', 'finance', 'POST', { assetName: '重複序號設備', serialNo: 'sn-001' })).status, 409);
    const updated = await request(`/api/equipment/${asset.id}`, 'president', 'PATCH', { assetName: 'DJI Mini 4 Pro 套組', assetNo: 'FORGED' });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).assetNo, asset.assetNo);
    assert.equal((await request(`/api/equipment/${asset.id}`, 'member', 'PATCH', { assetName: '無權限變更' })).status, 403);
    assert.equal((await request(`/api/equipment/${asset.id}`, 'finance', 'PATCH', { status: 'unknown' })).status, 400);
    assert.equal(equipmentStore.values.get(`equipment:asset:${asset.id}`).assetName, 'DJI Mini 4 Pro 套組');
});

test('equipment durable store retains concurrent creates and imports the legacy KV list once', async () => {
    const { request, db, equipmentStore } = fixture();
    const legacy = { id: 'legacy-asset-1', assetNo: 'NTUT-DR-2025-LEGACY', assetName: '舊設備', category: '機材', serialNo: '', purchaseDate: '', purchasePrice: 0, condition: 'good', status: 'storage', location: '', custodian: '', note: '' };
    db.store.set('equipment:assets', JSON.stringify([legacy]));
    const [first, second] = await Promise.all([
        request('/api/equipment', 'cadre', 'POST', { assetName: '並行設備 A', serialNo: 'PARALLEL-1' }),
        request('/api/equipment', 'finance', 'POST', { assetName: '並行設備 B', serialNo: 'PARALLEL-2' })
    ]);
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    const [duplicateA, duplicateB] = await Promise.all([
        request('/api/equipment', 'cadre', 'POST', { assetName: '同序號設備 A', serialNo: 'RACING-SERIAL' }),
        request('/api/equipment', 'finance', 'POST', { assetName: '同序號設備 B', serialNo: 'racing-serial' })
    ]);
    assert.deepEqual([duplicateA.status, duplicateB.status].sort(), [201, 409]);
    const listed = await (await request('/api/equipment', 'finance')).json();
    assert.equal(listed.length, 4);
    assert.ok(listed.some(asset => asset.id === legacy.id));
    assert.equal(db.store.get('equipment:durable-object-migrated'), '1');
    assert.equal([...equipmentStore.values.keys()].filter(key => key.startsWith('equipment:asset:')).length, 4);
});

test('member PATCH preserves omitted fields', async () => {
    const { request, db } = fixture();
    const created = await request('/api/members', 'finance', 'POST', { name: '保留資料', studentId: '1152C0010', phone: '0912345678', joinedAt: '2026-04-10' });
    const member = await created.json();
    member.joinedAt = '';
    db.store.set('members:list', JSON.stringify([member]));
    const updated = await request(`/api/members/${member.id}`, 'finance', 'PATCH', { note: '只更新備註' });
    assert.equal(updated.status, 200);
    const result = await updated.json();
    assert.equal(result.name, '保留資料');
    assert.equal(result.studentId, '1152C0010');
    assert.equal(result.phone, '0912345678');
    assert.equal(result.joinedAt, '');
    assert.equal(result.note, '只更新備註');
});
