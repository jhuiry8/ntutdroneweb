import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

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

function fixture() {
    const db = createMockKV();
    for (const role of ['president', 'finance', 'cadre', 'member']) {
        db.store.set(`user:${role}`, JSON.stringify({ username: role, role, active: true, version: 'v1' }));
        db.store.set(`session:${role}`, JSON.stringify({ username: role, version: 'v1' }));
    }
    const request = (path, role, method = 'GET', body) => worker.fetch(new Request(`https://example.com${path}`, {
        method,
        headers: { ...(role ? { Cookie: `session=${role}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }), { DRONE_DB: db });
    return { db, request };
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
