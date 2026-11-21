import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import worker, { ClassStore, EventStore, EquipmentStore, FlightStore } from '../src/worker.js';
import { semesterRange, semesterChoices, semesterAsOf, memberStats, classStats, eventStats, financeStats, equipmentStats, flightStats, statsCsv, csvTables } from '../src/stats.js';
import { semesterOf } from '../src/membership.js';
import { withSiteStore } from './helpers/site-store.js';

function durableObject(Class) {
    const values = new Map();
    let tail = Promise.resolve();
    const storage = {
        async get(key) { return structuredClone(values.get(key)); },
        async put(key, value) { values.set(key, structuredClone(value)); },
        async delete(keys) { for (const key of [].concat(keys)) values.delete(key); },
        async list({ prefix = '', start = '', limit = Infinity } = {}) { return new Map([...values.entries()].filter(([key]) => key.startsWith(prefix) && key >= start).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit).map(([k, v]) => [k, structuredClone(v)])); },
        transaction(callback) { const result = tail.then(() => callback(storage)); tail = result.catch(() => {}); return result; }
    };
    const object = new Class({ storage });
    return { idFromName: name => name, get: () => ({ fetch: (input, init) => object.fetch(input instanceof Request ? input : new Request(input, init)) }) };
}

// ---- pure functions ---------------------------------------------------------------------

test('ROC semesters map to date ranges, and the picker lists the current term first', () => {
    assert.deepEqual(semesterRange('115-1'), { from: '2026-08-01', to: '2027-01-31' });
    assert.deepEqual(semesterRange('115-2'), { from: '2027-02-01', to: '2027-07-31' });
    assert.equal(semesterRange('115-3'), null);
    assert.equal(semesterRange('abc'), null);
    assert.deepEqual(semesterChoices(new Date('2026-11-21T00:00:00Z'), 4), ['115-1', '114-2', '114-1', '113-2']);
    assert.equal(semesterAsOf('115-1', new Date('2027-05-01T00:00:00Z')).toISOString().slice(0, 10), '2027-01-31');
    assert.equal(semesterAsOf('115-2', new Date('2026-11-01T00:00:00Z')).toISOString().slice(0, 10), '2027-02-01');
});

test('member composition counts levels and the four membership/fee states', () => {
    const now = new Date('2026-11-21T00:00:00Z'); // 115-1
    const roster = [
        { level: 'trial', feeStatus: 'unpaid' },
        { level: 'member', feeStatus: 'semester', feeSemester: '115-1' },
        { level: 'member', feeStatus: 'semester', feeSemester: '114-2' },   // still valid (previous term)
        { level: 'member', feeStatus: 'semester', feeSemester: '113-1' },   // expired
        { level: 'member', feeStatus: 'lifetime' },
        { level: 'prep', feeStatus: 'unpaid' },                              // exempt
        { level: 'officer', feeStatus: 'lifetime' },
        { level: 'officer', feeStatus: 'unpaid' }                            // exempt
    ];
    const stats = memberStats(roster, '115-1', now);
    assert.equal(stats.total, 8);
    assert.deepEqual(stats.byLevel.map(item => [item.key, item.value]), [['trial', 1], ['member', 4], ['prep', 1], ['officer', 2]]);
    assert.deepEqual(stats.byFee.map(item => [item.key, item.value]), [['semester', 2], ['lifetime', 2], ['exempt', 2], ['unpaid', 2]]);
    assert.equal(stats.byFee.reduce((sum, item) => sum + item.value, 0), 8, 'every member is in exactly one state');
    // The same roster seen from the next term: the 114-2 one-year membership has run out.
    assert.equal(memberStats(roster, '115-2', now).byFee.find(item => item.key === 'semester').value, 1);
});

test('class statistics: registrations vs attendance, rate and trial-to-formal conversion', () => {
    const entry = (memberId, key, kind) => ({ id: `e-${key}`, memberId, key, kind, name: key, studentId: '', at: 'T' });
    const session = (id, date, attendance, extra = {}) => ({ id, date, time: '', topic: `課${id}`, registrationEnabled: true, attendance, ...extra });
    const sessions = [
        session('a', '2026-09-10', [entry('m1', 'm:m1', 'member'), entry('t1', 'm:t1', 'trial'), entry('t2', 'm:t2', 'trial')]),
        session('b', '2026-10-10', [entry('m1', 'm:m1', 'member')]),
        session('old', '2026-03-10', [entry('t3', 'm:t3', 'trial')])           // another term
    ];
    const regs = [
        { classId: 'a', status: 'confirmed', key: 'm:m1', memberId: 'm1' }, { classId: 'a', status: 'confirmed', key: 'm:m2', memberId: 'm2' },
        { classId: 'a', status: 'waitlist', key: 'm:m9', memberId: 'm9' },
        { classId: 'b', status: 'confirmed', key: 'm:m1', memberId: 'm1' }, { classId: 'old', status: 'confirmed', key: 'm:t3', memberId: 't3' }
    ];
    const roster = [{ id: 't1', level: 'member' }, { id: 't2', level: 'trial' }, { id: 't3', level: 'member' }];
    const stats = classStats(sessions, regs, roster, '115-1');
    assert.equal(stats.sessions.length, 2, 'only this term');
    assert.deepEqual(stats.sessions.map(row => [row.registered, row.waitlist, row.attended, row.registeredAttended, row.rate]), [[2, 1, 3, 1, 50], [1, 0, 1, 1, 100]]);
    assert.deepEqual(stats.totals, { sessions: 2, registered: 3, attended: 4, attendanceRate: 66.7 });
    // t1 and t2 came as trial members this term; t1 has since become a formal member.
    assert.deepEqual(stats.conversion, { trialAttendees: 2, converted: 1, rate: 50 });
    assert.equal(classStats([], [], [], '115-1').conversion.rate, null);
});

test('event statistics count confirmed and waitlisted people for events in the term', () => {
    const list = [
        { event: { id: '1', title: '飛行日', startsAt: '2026-10-03T02:00:00.000Z' }, confirmed: 5, waitlist: 2 },
        { event: { id: '2', title: '比賽', startsAt: '2026-12-03T02:00:00.000Z' }, confirmed: 3, waitlist: 0 },
        { event: { id: '3', title: '去年', startsAt: '2026-03-03T02:00:00.000Z' }, confirmed: 9, waitlist: 9 }
    ];
    const stats = eventStats(list, '115-1');
    assert.deepEqual(stats.totals, { events: 2, confirmed: 8, waitlist: 2 });
});

test('finance statistics use approved income and expense only, grouped by budget, and compute execution rates', () => {
    const budgets = [{ id: 'b1', name: '器材', planned: 10000 }, { id: 'b2', name: '活動', planned: 5000 }];
    const t = (extra) => ({ status: 'approved', kind: 'expense', income: 0, expense: 0, budgetId: '', date: '2026-09-15', ...extra });
    const transactions = [
        t({ expense: 4000, budgetId: 'b1' }), t({ expense: 1000, budgetId: 'b1', date: '2026-10-20' }), t({ expense: 600, budgetId: 'b2', date: '2025-10-20' }),
        t({ expense: 700 }),                                                  // uncategorised
        t({ kind: 'income', income: 3000, budgetId: 'b2', date: '2026-09-02' }), t({ kind: 'income', income: 500 }),
        t({ status: 'pending', expense: 99999, budgetId: 'b1' }), t({ status: 'rejected', income: 88888, kind: 'income' }),
        t({ kind: 'transfer', expense: 77777 })
    ];
    const stats = financeStats(transactions, budgets, '115-1');
    assert.deepEqual(stats.totals, { income: 3500, expense: 5700 });
    assert.deepEqual(stats.expenseByBudget, [{ label: '器材', value: 5000 }, { label: '未分類', value: 700 }]);
    assert.deepEqual(stats.incomeByBudget, [{ label: '活動', value: 3000 }, { label: '未分類', value: 500 }]);
    assert.equal(stats.monthly.length, 6);
    assert.deepEqual(stats.monthly.slice(0, 3).map(m => [m.month, m.income, m.expense]), [['2026-08', 0, 0], ['2026-09', 3500, 4700], ['2026-10', 0, 1000]]);
    assert.deepEqual(stats.budgets, [
        { name: '器材', planned: 10000, spent: 5000, spentInSemester: 5000, rate: 50 },
        { name: '活動', planned: 5000, spent: 600, spentInSemester: 0, rate: 12 }
    ]);
});

test('equipment and flight statistics', () => {
    const assets = [{ id: 'a', assetNo: 'E1', assetName: '空拍機', status: 'storage' }, { id: 'b', assetNo: 'E2', assetName: '遙控器', status: 'in_use' }, { id: 'c', assetNo: 'E3', assetName: '電池', status: 'repair' }, { id: 'd', assetNo: 'E4', assetName: '舊機', status: 'retired' }];
    const histories = new Map([['a', [{ since: '2026-09-01T00:00:00Z' }, { since: '2026-10-01T00:00:00Z' }, { since: '2025-01-01T00:00:00Z' }]], ['b', [{ since: '2026-09-05T00:00:00Z' }]]]);
    const equipment = equipmentStats(assets, histories, '115-1');
    assert.deepEqual(equipment.byStatus.map(item => item.value), [1, 1, 1, 1]);
    assert.deepEqual(equipment.ranking, [{ assetNo: 'E1', assetName: '空拍機', loans: 2 }, { assetNo: 'E2', assetName: '遙控器', loans: 1 }]);
    const flights = flightStats([
        { date: '2026-09-01', type: 'fpv', minutes: 90, incident: false }, { date: '2026-09-02', type: 'fpv', minutes: 30, incident: true },
        { date: '2026-09-03', type: 'aerial', minutes: 60 }, { date: '2025-09-03', type: 'aerial', minutes: 600 }
    ], '115-1');
    assert.deepEqual([flights.flights, flights.hours, flights.incidents], [3, 3, 1]);
    assert.deepEqual(flights.byType.filter(item => item.value).map(item => [item.key, item.value]), [['aerial', 1], ['fpv', 2]]);
});

test('CSV export escapes commas, quotes, newlines and spreadsheet formulas', () => {
    const budgets = [{ id: 'b1', name: '=HYPERLINK("http://x")', planned: 100 }, { id: 'b2', name: '器材,耗材', planned: 100 }, { id: 'b3', name: '含"引號"\n換行', planned: 100 }, { id: 'b4', name: '+SUM(1)', planned: 1 }];
    const data = financeStats([], budgets, '115-1');
    const csv = statsCsv('finance', data);
    assert.ok(csv.startsWith('﻿'), 'BOM for Excel');
    assert.match(csv, /"'=HYPERLINK\(""http:\/\/x""\)"/);
    assert.match(csv, /"器材,耗材"/);
    assert.match(csv, /"含""引號""\n換行"/);
    assert.match(csv, /'\+SUM\(1\)/);
    assert.doesNotMatch(csv, /(^|,)=HYPERLINK/m);
    assert.deepEqual(csvTables('nope', {}), []);
});

// ---- HTTP, permissions ----------------------------------------------------------------------

const SEMESTER = semesterOf();
const RANGE = semesterRange(SEMESTER);
const SECRET_INCOME = 7654321, SECRET_EXPENSE = 1234567, SECRET_BUDGET = 9876543;

async function fixture() {
    const store = new Map();
    const db = {
        async get(key) { return store.get(key) ?? null; },
        async put(key, value) { store.set(key, typeof value === 'string' ? value : JSON.stringify(value)); },
        async delete(key) { store.delete(key); },
        async list({ prefix }) { return { keys: [...store.keys()].filter(name => name.startsWith(prefix)).map(name => ({ name })) }; }
    };
    for (const [username, role] of Object.entries({ president: 'president', fin: 'finance', cadre: 'cadre', member: 'member' })) {
        store.set(`user:${username}`, JSON.stringify({ username, role, active: true, version: 'v1', memberId: '' }));
        store.set(`session:${username}`, JSON.stringify({ username, version: 'v1' }));
    }
    store.set('members:list', JSON.stringify([{ id: 'm1', name: '甲', studentId: 'A1', level: 'member', feeStatus: 'lifetime' }, { id: 'm2', name: '乙', studentId: 'A2', level: 'trial', feeStatus: 'unpaid' }]));
    store.set('finance:budgets', JSON.stringify([{ id: 'b1', name: '器材預算', planned: SECRET_BUDGET }]));
    store.set('finance:transactions', JSON.stringify([
        { id: 't1', status: 'approved', kind: 'income', income: SECRET_INCOME, expense: 0, date: RANGE.from, budgetId: 'b1', createdAt: 'x' },
        { id: 't2', status: 'approved', kind: 'expense', income: 0, expense: SECRET_EXPENSE, date: RANGE.from, budgetId: 'b1', createdAt: 'x' }
    ]));
    const env = withSiteStore({ DRONE_DB: db, CLASS_STORE: durableObject(ClassStore), EVENT_STORE: durableObject(EventStore), EQUIPMENT_STORE: durableObject(EquipmentStore), FLIGHT_STORE: durableObject(FlightStore) });
    const send = async (path, who) => {
        const response = await worker.fetch(new Request(`https://example.com${path}`, { headers: who ? { Cookie: `session=${who}` } : {} }), env);
        const text = await response.text();
        let body; try { body = JSON.parse(text); } catch { body = text; }
        return { status: response.status, body, text, headers: response.headers };
    };
    const post = (stub, path, payload) => env[stub].get().fetch(`https://x${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(r => r.json());
    // Some data in every area.
    // Registration only works before a class, so it is registered while still ahead and moved into the term afterwards.
    const ahead = new Date(Date.now() + 8 * 3600000 + 3 * 86400000).toISOString().slice(0, 10);
    const cls = await post('CLASS_STORE', '/create', { fields: { date: ahead, topic: '焊接入門', registrationEnabled: true, capacity: 0 }, actor: { username: 'president' } });
    await post('CLASS_STORE', '/reg/register', { id: cls.id, who: { kind: 'member', memberId: 'm1', studentId: 'A1', name: '甲', username: '' }, actor: {} });
    await post('CLASS_STORE', '/op', { id: cls.id, op: 'update', fields: { date: RANGE.from }, actor: { officer: true } });
    await post('EVENT_STORE', '/create', { actor: { officer: true, username: 'president' }, fields: { title: '飛行日', startsAt: `${RANGE.from}T10:00`, capacity: 1 } });
    await post('EQUIPMENT_STORE', '/initialize', { assets: [] });
    store.set('equipment:durable-object-migrated', '1');
    const asset = await post('EQUIPMENT_STORE', '/create', { fields: { assetName: '空拍機', category: '無人機' }, username: 'president' });
    await post('EQUIPMENT_STORE', '/lend', { formId: 'f1', assetIds: [asset.id], borrower: '甲', username: 'president' });
    await post('FLIGHT_STORE', '/log-create', { actor: { username: 'president', officer: true }, owner: { username: 'president', name: '社長' }, fields: { date: RANGE.from, location: '操場', type: 'fpv', aircraft: 'X', minutes: 90 } });
    return { send, env };
}

test('the stats API is for officers and filters the finance section by role on the server', async () => {
    const f = await fixture();
    assert.equal((await f.send(`/api/stats?semester=${SEMESTER}`)).status, 401);
    assert.equal((await f.send(`/api/stats?semester=${SEMESTER}`, 'member')).status, 403);
    assert.equal((await f.send('/api/stats?semester=abc', 'president')).status, 400);

    for (const who of ['president', 'fin']) {
        const response = await f.send(`/api/stats?semester=${SEMESTER}`, who);
        assert.equal(response.status, 200);
        assert.ok(response.body.sections.finance, `${who} sees finance`);
        assert.equal(response.body.sections.finance.totals.income, SECRET_INCOME);
        assert.equal(response.body.sections.finance.budgets[0].planned, SECRET_BUDGET);
    }

    const cadre = await f.send(`/api/stats?semester=${SEMESTER}`, 'cadre');
    assert.equal(cadre.status, 200);
    assert.equal(cadre.body.sections.finance, undefined, 'the finance section is not sent to a cadre account');
    assert.deepEqual(Object.keys(cadre.body.sections).sort(), ['classes', 'equipment', 'events', 'flights', 'members']);
    for (const secret of [SECRET_INCOME, SECRET_EXPENSE, SECRET_BUDGET, '器材預算']) assert.ok(!cadre.text.includes(String(secret)), `no ${secret} anywhere in the cadre response`);
    assert.equal(cadre.body.canFinance, false);

    // The shared sections carry the seeded data.
    const { sections } = cadre.body;
    assert.equal(sections.members.total, 2);
    assert.deepEqual([sections.classes.totals.sessions, sections.classes.totals.registered], [1, 1]);
    assert.deepEqual([sections.events.totals.events, sections.events.totals.confirmed], [1, 0]);
    assert.deepEqual(sections.equipment.ranking.map(item => item.loans), [1]);
    assert.equal(sections.flights.hours, 1.5);
});

test('CSV export follows the same permissions', async () => {
    const f = await fixture();
    const url = section => `/api/stats/export.csv?section=${section}&semester=${SEMESTER}`;
    assert.equal((await f.send(url('finance'), 'cadre')).status, 403);
    assert.equal((await f.send(url('finance'))).status, 401);
    assert.equal((await f.send(url('finance'), 'member')).status, 403);
    const finance = await f.send(url('finance'), 'fin');
    assert.equal(finance.status, 200);
    assert.match(finance.headers.get('Content-Type'), /text\/csv/);
    assert.match(finance.headers.get('Content-Disposition'), new RegExp(`stats-finance-${SEMESTER}\\.csv`));
    assert.ok(finance.text.includes(String(SECRET_INCOME)));
    for (const section of ['members', 'classes', 'events', 'equipment', 'flights']) {
        const response = await f.send(url(section), 'cadre');
        assert.equal(response.status, 200, section);
        assert.match(response.headers.get('Content-Type'), /text\/csv/);
    }
    assert.equal((await f.send(url('nope'), 'cadre')).status, 404);
});

test('the report page is for officers, prints in light colours, and the sidebar links to it', async () => {
    const f = await fixture();
    assert.equal((await f.send('/admin/stats')).status, 302);
    assert.equal((await f.send('/admin/stats', 'member')).status, 403);
    const page = await f.send('/admin/stats', 'cadre');
    assert.equal(page.status, 200);
    assert.match(page.text, /<script src="\/charts\.js">/);
    assert.match(page.text, /@media print/);
    assert.doesNotMatch(page.text, /https?:\/\/(?!challenges)/, 'no external scripts or CDNs');
    assert.match(fs.readFileSync(new URL('../src/templates/admin.js', import.meta.url), 'utf8'), /href="\/admin\/stats"[^>]*>.*統計報表/);
});

// ---- charts.js (run against a minimal DOM) ------------------------------------------------------

function fakeDom() {
    class Node {
        constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; this._text = ''; this.className = ''; this.style = {}; this.classList = { add: name => { this.className = `${this.className} ${name}`.trim(); } }; }
        setAttribute(key, value) { this.attrs[key] = String(value); }
        appendChild(child) { this.children.push(child); return child; }
        set textContent(value) { this._text = String(value); this.children = []; }
        get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    }
    const ids = new Map();
    const document = {
        head: new Node('head'),
        getElementById: id => ids.get(id) || null,
        createElementNS: (ns, tag) => new Node(tag),
        createElement: tag => new Node(tag)
    };
    const origAppend = document.head.appendChild.bind(document.head);
    document.head.appendChild = node => { if (node.id) ids.set(node.id, node); return origAppend(node); };
    return { document, Node };
}
function loadCharts() {
    const { document, Node } = fakeDom();
    const window = { document };
    vm.runInNewContext(fs.readFileSync(new URL('../public/charts.js', import.meta.url), 'utf8'), { window, document, globalThis: window });
    return { Charts: window.Charts, container: () => new Node('div'), document };
}
const walk = (node, visit) => { visit(node); node.children.forEach(child => walk(child, visit)); };
const find = (node, tag) => { const out = []; walk(node, item => { if (item.tag === tag) out.push(item); }); return out; };

test('charts.js draws pie, bar and line charts as inline SVG with text for every number', () => {
    const { Charts, container, document } = loadCharts();
    assert.deepEqual(Object.keys(Charts).sort(), ['bar', 'line', 'pie']);

    const pie = container();
    Charts.pie(pie, [{ label: '正式社員', value: 30 }, { label: '非正式', value: 10 }, { label: '零', value: 0 }], { unit: ' 人', title: '級別' });
    assert.equal(find(pie, 'svg').length, 1);
    assert.equal(find(pie, 'path').length, 2, 'one slice per non-zero value');
    assert.match(pie.textContent, /正式社員/);
    assert.match(pie.textContent, /30 人（75%）/);
    assert.match(pie.textContent, /零/, 'zero values still appear in the legend');
    assert.match(find(pie, 'svg')[0].attrs['aria-label'], /級別/);

    const single = container();
    Charts.pie(single, [{ label: '全部', value: 5 }]);
    assert.equal(find(single, 'circle').length, 1, 'a single slice is a full circle');

    const bar = container();
    Charts.bar(bar, [{ label: '9/10 課A', values: [20, 12] }, { label: '9/17 課B', values: [15, 15] }], { series: ['報名', '出席'], unit: ' 人' });
    assert.equal(find(bar, 'rect').length, 4);
    assert.match(bar.textContent, /報名/);
    assert.match(bar.textContent, /出席/);
    assert.match(bar.textContent, /20 人/);

    const single2 = container();
    Charts.bar(single2, [{ label: 'a', value: 3 }, { label: 'b', value: 5 }], { horizontal: true });
    assert.equal(find(single2, 'rect').length, 2);

    const line = container();
    Charts.line(line, [{ label: 'w1', value: 50 }, { label: 'w2', value: null }, { label: 'w3', value: 80 }], { unit: '%', max: 100 });
    assert.equal(find(line, 'circle').length, 2, 'a missing value leaves a gap, not a point');
    assert.equal(find(line, 'path').length, 1);
    assert.match(line.textContent, /80%/);

    // Nothing to draw: a sentence, not a broken chart. Hostile labels stay text.
    const none = container();
    Charts.pie(none, [], { empty: '沒有資料' });
    assert.equal(find(none, 'svg').length, 0);
    assert.match(none.textContent, /沒有資料/);
    const hostile = container();
    Charts.bar(hostile, [{ label: '<img src=x onerror=alert(1)>', value: 1 }]);
    assert.ok(hostile.textContent.includes('<img'), 'labels are text, never markup');
    assert.equal(find(hostile, 'img').length, 0);

    // One shared stylesheet: light and dark palettes, light again for printing, no external resources.
    const css = document.getElementById('charts-css').textContent;
    assert.match(css, /prefers-color-scheme: dark/);
    assert.match(css, /data-theme="dark"/);
    assert.match(css, /@media print/);
    assert.doesNotMatch(css, /url\(|@import|https?:/);
    assert.equal(find(document.head, 'style').length, 1, 'the stylesheet is added once');
});
