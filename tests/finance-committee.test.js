import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { MeetingStore } from '../src/meetings.js';
import { buildSnapshot, semesterRange, contentHash, handlersOf } from '../src/finance-reports.js';
import { recusedFor, itemElectorate, voteResult } from '../src/meetings.js';
import { withSiteStore } from './helpers/site-store.js';
import { createOrgStore, createFileStore, durableObject } from './helpers/org-store.js';

// ---------- fixture: club with a treasurer, a committee of three (one also treasurer) and a chair ----------

const ACCOUNTS = { admin: 'president', treas: 'member', comm1: 'member', comm2: 'member', comm3: 'member', commt: 'member', chair: 'member', plain: 'member', cad: 'cadre' };
const MEMBER_IDS = { comm1: 'm1', comm2: 'm2', comm3: 'm3', commt: 'm4', plain: 'm5', chair: 'm6' };

async function fixture() {
    const store = new Map();
    const db = {
        async get(key) { return store.get(key) ?? null; },
        async put(key, value) { store.set(key, typeof value === 'string' ? value : JSON.stringify(value)); },
        async delete(key) { store.delete(key); },
        async list({ prefix }) { return { keys: [...store.keys()].filter(name => name.startsWith(prefix)).map(name => ({ name })) }; }
    };
    for (const [username, role] of Object.entries(ACCOUNTS)) {
        store.set(`user:${username}`, JSON.stringify({ username, role, active: true, version: 'v1', createdAt: '2025-01-01T00:00:00Z', ...(MEMBER_IDS[username] ? { memberId: MEMBER_IDS[username] } : {}) }));
        store.set(`session:${username}`, JSON.stringify({ username, version: 'v1' }));
    }
    store.set('members:list', JSON.stringify(Object.entries(MEMBER_IDS).map(([username, id]) => ({ id, name: `${username}姓名`, studentId: `B1100000${id.slice(1)}` }))));
    const env = withSiteStore({ DRONE_DB: db, ORG_STORE: createOrgStore(), FILE_STORE: createFileStore(), MEETING_STORE: durableObject(MeetingStore) });
    const request = async (path, who, method = 'GET', body) => {
        const response = await worker.fetch(new Request(`https://example.com${path}`, {
            method,
            headers: { ...(who ? { Cookie: `session=${who}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) })
        }), env);
        const type = response.headers.get('Content-Type') || '';
        return { status: response.status, body: type.includes('json') ? await response.json() : await response.text() };
    };
    const f = { env, store, request };
    const position = async (who, positions, extra = {}) => assert.equal((await request('/api/users', 'admin', 'PATCH', { username: who, positions, ...extra })).status, 200);
    await position('treas', ['treasurer']);
    for (const who of ['comm1', 'comm2', 'comm3']) await position(who, ['committee']);
    await position('commt', ['committee', 'treasurer']);
    await position('chair', ['secretary']); // 執秘: meetings.manage
    // 委員 comm3 handled a ledger entry, so they must step aside for reports containing it
    await position('comm3', ['committee'], { grants: ['finance.edit'] });
    // budgets and a few approved ledger entries inside 115-1 (2026-08-01 ~ 2027-01-31)
    assert.equal((await request('/api/finance/budgets', 'treas', 'PUT', { budgets: [{ id: 'gear', name: '器材', planned: 10000 }, { id: 'event', name: '活動', planned: 5000 }] })).status, 200);
    const add = async (who, fields, approve = true) => {
        const created = await request('/api/finance/transactions', who, 'POST', { account: 'cash', ...fields });
        assert.equal(created.status, 201, JSON.stringify(created.body));
        if (approve) assert.equal((await request(`/api/finance/transactions/${created.body.id}/review`, 'admin', 'PATCH', { status: 'approved' })).status, 200);
        return created.body;
    };
    f.add = add;
    await add('treas', { kind: 'income', amount: 20000, item: '期初社費', date: '2026-07-20' });             // before the semester: opening balance
    f.income = await add('treas', { kind: 'income', amount: 3000, item: '社費收入', date: '2026-09-10' });
    f.gear = await add('treas', { kind: 'expense', amount: 4000, item: '購買螺旋槳', date: '2026-09-15', budgetId: 'gear', receiptFileId: '11111111-1111-4111-8111-111111111111' });
    f.event = await add('treas', { kind: 'expense', amount: 1000, item: '迎新茶點', date: '2026-10-01', budgetId: 'event' });
    f.byComm3 = await add('comm3', { kind: 'expense', amount: 500, item: '社課講義列印', date: '2026-10-05' });
    f.position = position;
    f.createReport = async (who = 'treas', body = { semester: '115-1', kind: 'settlement' }) => (await request('/api/finance/reports', who, 'POST', body)).body;
    f.submit = async (id, who = 'treas') => request(`/api/finance/reports/${id}/submit`, who, 'POST', {});
    f.committeeMeeting = async (reportId, extra = {}) => {
        const created = await request('/api/meetings', 'chair', 'POST', {
            type: 'committee', title: '115-1 決算審核會議', date: '2027-02-10', time: '19:00', location: 'A101',
            agenda: [{ kind: 'finance', title: '115-1 決算書審核', financeReportId: reportId }], ...extra
        });
        assert.equal(created.status, 201, JSON.stringify(created.body));
        return created.body;
    };
    f.setStatus = (id, status, who = 'chair') => request(`/api/meetings/${id}/status`, who, 'POST', { status });
    f.attend = (id, who) => request(`/api/meetings/${id}/attendance`, 'chair', 'POST', { memberId: MEMBER_IDS[who] });
    return f;
}

// ---------- the report ----------

test('a semester report is built from the ledger: budget vs actual, rates, balances and the entries with receipts', async () => {
    const f = await fixture();
    const report = await f.createReport();
    assert.equal(report.status, 'draft');
    assert.equal(report.statusLabel, '草稿');
    const s = report.snapshot;
    assert.equal(s.title, '115-1 學期決算書');
    assert.deepEqual(s.period, { start: '2026-08-01', end: '2027-01-31' });
    assert.deepEqual(s.opening, { cash: 20000, postal: 0 });
    assert.equal(s.totals.income, 3000);
    assert.equal(s.totals.expense, 5500);
    assert.deepEqual(s.closing, { cash: 20000 + 3000 - 5500, postal: 0 });
    const gear = s.categories.find(item => item.id === 'gear');
    assert.deepEqual([gear.planned, gear.expense, gear.rate], [10000, 4000, 40]);
    assert.equal(s.categories.find(item => item.id === 'event').rate, 20);
    assert.equal(s.uncategorized.expense, 500);
    assert.equal(s.transactions.length, 4, 'the entry before the semester is not listed');
    assert.equal(s.transactions.find(item => item.id === f.gear.id).receiptUrl, '/files/11111111-1111-4111-8111-111111111111');
    assert.equal(s.transactions.find(item => item.id === f.income.id).receiptUrl, '');
    assert.equal((await f.createReport()).error !== undefined, true, 'a second draft for the same semester is refused');
    assert.equal((await f.request('/api/finance/reports', 'treas', 'POST', { semester: '115-3', kind: 'budget' })).status, 400);
    assert.equal((await f.request('/api/finance/reports', 'treas', 'POST', { semester: '115-1', kind: 'other' })).status, 400);
});

test('semester ranges and the pure snapshot builder', async () => {
    assert.deepEqual(semesterRange('115-2'), { start: '2027-02-01', end: '2027-07-31' });
    assert.throws(() => semesterRange('115'), /學期格式/);
    const tx = (over) => ({ id: over.id, date: over.date, item: 'x', kind: 'expense', income: 0, expense: 0, cashDelta: 0, postalDelta: 0, budgetId: '', status: 'approved', createdBy: 'a', createdAt: over.date, ...over });
    const snapshot = buildSnapshot({ semester: '115-1', kind: 'budget', budgets: [{ id: 'b', name: '預算', planned: 0 }], now: 'now', transactions: [
        tx({ id: '1', date: '2026-07-31', income: 10, cashDelta: 10 }), tx({ id: '2', date: '2026-08-01', expense: 4, cashDelta: -4, budgetId: 'b', createdBy: 'bob' }),
        tx({ id: '3', date: '2027-01-31', expense: 1, postalDelta: -1 }), tx({ id: '4', date: '2027-02-01', expense: 9, cashDelta: -9 }), tx({ id: '5', date: '2026-09-01', status: 'rejected' }),
        tx({ id: '6', date: '2026-09-02', status: 'pending', expense: 2, reviewedBy: 'carol' })
    ] });
    assert.deepEqual(snapshot.opening, { cash: 10, postal: 0 });
    assert.deepEqual(snapshot.closing, { cash: 6, postal: -1 });
    assert.equal(snapshot.categories[0].rate, null, 'no rate without a planned amount');
    assert.deepEqual(snapshot.transactions.map(item => item.id), ['2', '6', '3'], 'rejected entries and other semesters are left out, pending ones are listed');
    assert.equal(snapshot.totals.pendingCount, 1);
    assert.deepEqual(handlersOf(snapshot), ['a', 'bob', 'carol']);
    assert.equal(await contentHash({ ...snapshot, generatedAt: 'later' }), await contentHash(snapshot), 'the hash ignores the generation time');
});

test('submitting freezes the numbers; later ledger changes only raise a notice and a new version keeps the old one', async () => {
    const f = await fixture();
    const draft = await f.createReport();
    assert.equal((await f.request(`/api/finance/reports/${draft.id}/submit`, 'comm1', 'POST', {})).status, 403, 'only the 總務 (finance.edit) submits');
    const submitted = await f.submit(draft.id);
    assert.equal(submitted.status, 200);
    assert.equal(submitted.body.status, 'submitted');
    assert.match(submitted.body.contentHash, /^[0-9a-f]{64}$/);
    assert.equal(submitted.body.changed, false);
    const frozen = JSON.stringify((await f.request(`/api/finance/reports/${draft.id}`, 'treas')).body.snapshot);
    assert.equal((await f.submit(draft.id)).status, 409, 'cannot submit twice');
    // the ledger changes after submission
    await f.add('treas', { kind: 'expense', amount: 700, item: '補買零件', date: '2026-11-01', budgetId: 'gear' });
    const after = (await f.request(`/api/finance/reports/${draft.id}`, 'treas')).body;
    assert.equal(JSON.stringify(after.snapshot), frozen, 'the submitted figures never change');
    assert.equal(after.changed, true, '帳目已變動，可重新送審新版本');
    assert.equal((await f.request('/api/finance/reports', 'treas')).body.reports[0].changed, true);
    // submit a new version: the old one is superseded and everything is kept
    const next = await f.request(`/api/finance/reports/${draft.id}/resubmit`, 'treas', 'POST', {});
    assert.equal(next.status, 201);
    assert.equal(next.body.version, 2);
    assert.equal(next.body.status, 'submitted');
    assert.equal(next.body.snapshot.totals.expense, 6200);
    assert.equal(next.body.changed, false);
    const old = (await f.request(`/api/finance/reports/${draft.id}`, 'treas')).body;
    assert.equal(old.status, 'superseded');
    assert.equal(JSON.stringify(old.snapshot), frozen);
    assert.ok(old.history.some(entry => entry.action === 'superseded'));
    assert.equal((await f.request(`/api/finance/reports/${draft.id}/resubmit`, 'treas', 'POST', {})).status, 409);
    const list = (await f.request('/api/finance/reports', 'treas')).body.reports;
    assert.deepEqual(list.map(item => [item.version, item.status, item.latest]), [[2, 'submitted', true], [1, 'superseded', false]]);
    assert.equal((await f.request(`/api/finance/reports/${next.body.id}/resubmit`, 'treas', 'POST', {})).status, 409, 'an unchanged ledger needs no new version');
});

test('only finance staff list and edit reports; drafts can be deleted, submitted versions cannot', async () => {
    const f = await fixture();
    const draft = await f.createReport();
    assert.equal((await f.request('/api/finance/reports', 'plain')).status, 403);
    assert.equal((await f.request('/api/finance/reports', undefined)).status, 401);
    assert.equal((await f.request('/api/finance/reports', 'comm1', 'POST', { semester: '115-1', kind: 'budget' })).status, 403);
    assert.equal((await f.request(`/api/finance/reports/${draft.id}`, 'plain')).status, 404);
    assert.equal((await f.request(`/api/finance/reports/${draft.id}`, 'comm1')).status, 200, 'committee members hold finance.view');
    const other = await f.createReport('treas', { semester: '115-1', kind: 'budget' });
    assert.equal((await f.request(`/api/finance/reports/${other.id}`, 'plain', 'DELETE')).status, 403);
    assert.equal((await f.request(`/api/finance/reports/${other.id}`, 'treas', 'DELETE')).status, 200);
    await f.submit(draft.id);
    assert.equal((await f.request(`/api/finance/reports/${draft.id}`, 'treas', 'DELETE')).status, 409);
    assert.equal((await f.request('/api/finance/reports/not-an-id', 'treas')).status, 404);
});

// ---------- the committee meeting ----------

test('a finance item attaches only a submitted report; only the 本屆委員 see its content, even without finance.view', async () => {
    const f = await fixture();
    const draft = await f.createReport();
    const bad = await f.request('/api/meetings', 'chair', 'POST', { type: 'committee', title: 'x', date: '2027-02-10', agenda: [{ kind: 'finance', title: '審核', financeReportId: draft.id }] });
    assert.equal(bad.status, 400, 'a draft cannot be attached');
    assert.equal((await f.request('/api/meetings', 'chair', 'POST', { type: 'committee', title: 'x', date: '2027-02-10', agenda: [{ kind: 'finance', title: '審核', financeReportId: '22222222-2222-4222-8222-222222222222' }] })).status, 400);
    await f.submit(draft.id);
    const meeting = await f.committeeMeeting(draft.id);
    const item = meeting.agenda[0];
    assert.equal(item.kind, 'finance');
    assert.equal(item.threshold, 'committee');
    assert.equal(item.financeReport.id, draft.id);
    assert.equal(item.financeReport.handlers, undefined, 'who handled the entries is not sent to browsers');
    // a draft meeting is for the officers only
    assert.equal((await f.request(`/api/meetings/${meeting.id}`, 'comm1')).status, 404);
    assert.equal((await f.setStatus(meeting.id, 'announced')).status, 200);
    const detailOf = async who => (await f.request(`/api/meetings/${meeting.id}`, who)).body.agenda[0].financeReport;
    const seen = await detailOf('comm1');
    assert.equal(seen.statusLabel, '送審中');
    assert.equal(seen.detail.snapshot.totals.expense, 5500);
    assert.equal(seen.detail.snapshot.transactions.length, 4);
    assert.equal(seen.detail.canComment, true);
    // members who are not on the committee see which report is attached, never its content
    for (const who of ['plain', 'cad', 'chair']) {
        const other = await detailOf(who);
        assert.equal(other.title, '115-1 學期決算書');
        assert.equal(other.detail, undefined, `${who} must not see the report`);
        assert.ok(!JSON.stringify((await f.request(`/api/meetings/${meeting.id}`, who)).body).includes('購買螺旋槳'), `${who} must not see entries`);
    }
    assert.equal((await f.request(`/api/finance/reports/${draft.id}`, 'plain')).status, 404);
    // the president revokes finance.view from a committee member: the meeting attachment still works for them
    await f.position('comm2', ['committee'], { revokes: ['finance.view', 'finance.audit'] });
    assert.equal((await f.request('/api/finance/reports', 'comm2')).status, 403, 'no general finance access');
    assert.ok((await detailOf('comm2')).detail.snapshot, 'but they read the attached report');
    assert.equal((await f.request(`/api/finance/reports/${draft.id}`, 'comm2')).status, 200);
    // the 總務 and the president read it as finance staff
    assert.ok((await detailOf('treas')).detail);
    assert.ok((await detailOf('admin')).detail);
});

test('an officers meeting can carry a report for information; only finance staff see the figures', async () => {
    const f = await fixture();
    const report = await f.createReport();
    await f.submit(report.id);
    const created = await f.request('/api/meetings', 'chair', 'POST', { type: 'officers', title: '幹部會議', date: '2027-02-12', agenda: [{ kind: 'finance', title: '總務報告', financeReportId: report.id }] });
    assert.equal(created.status, 201);
    assert.equal(created.body.agenda[0].threshold, 'none', 'reporting only unless the chair asks for a vote');
    const id = created.body.id;
    await f.setStatus(id, 'announced');
    const read = async who => (await f.request(`/api/meetings/${id}`, who)).body.agenda[0].financeReport;
    assert.equal((await read('admin')).detail.snapshot.totals.income, 3000);
    assert.equal((await read('treas')).detail.snapshot.totals.income, 3000);
    assert.equal((await read('comm1')).detail.snapshot.totals.income, 3000, 'committee members hold finance.view by position');
    assert.equal((await read('cad')).detail, undefined, 'an officer without finance.view sees only the title');
    await f.position('comm1', ['committee'], { revokes: ['finance.view', 'finance.audit'] });
    assert.equal((await read('comm1')).detail, undefined, 'the committee exception applies to committee meetings only');
});

test('the committee may question single entries before the meeting and the 總務 replies', async () => {
    const f = await fixture();
    const report = await f.createReport();
    await f.submit(report.id);
    const meeting = await f.committeeMeeting(report.id);
    const comment = body => f.request(`/api/finance/reports/${report.id}/comments`, 'comm1', 'POST', body);
    // without finance.audit a committee member can only question once the meeting is announced
    await f.position('comm1', ['committee'], { revokes: ['finance.view', 'finance.audit'] });
    assert.equal((await f.request(`/api/finance/reports/${report.id}/comments`, 'comm1', 'POST', { text: 'x' })).status, 403, 'before the meeting is announced there is no access through it');
    await f.setStatus(meeting.id, 'announced');
    const first = await comment({ transactionId: f.gear.id, text: '螺旋槳的收據金額是否一致？' });
    assert.equal(first.status, 201);
    assert.equal((await comment({ transactionId: 'nope', text: 'x' })).status, 404);
    assert.equal((await comment({ text: '' })).status, 400);
    assert.equal((await f.request(`/api/finance/reports/${report.id}/comments`, 'plain', 'POST', { text: 'x' })).status, 403);
    assert.equal((await f.request(`/api/finance/reports/${report.id}/comments`, 'treas', 'POST', { text: 'x' })).status, 403, 'the 總務 replies, does not question');
    const commentId = first.body.comments[0].id;
    assert.equal((await f.request(`/api/finance/reports/${report.id}/comments/${commentId}/reply`, 'comm1', 'POST', { text: '自己回覆' })).status, 403);
    const replied = await f.request(`/api/finance/reports/${report.id}/comments/${commentId}/reply`, 'treas', 'POST', { text: '已附上正確收據。' });
    assert.equal(replied.status, 201);
    const shown = (await f.request(`/api/meetings/${meeting.id}`, 'comm2')).body.agenda[0].financeReport.detail;
    assert.equal(shown.comments[0].text, '螺旋槳的收據金額是否一致？');
    assert.equal(shown.comments[0].transactionId, f.gear.id);
    assert.equal(shown.comments[0].replies[0].text, '已附上正確收據。');
    assert.equal(shown.canReply, false);
    assert.equal((await f.request(`/api/meetings/${meeting.id}`, 'treas')).body.agenda[0].financeReport.detail.canReply, true);
    assert.equal((await f.request(`/api/meetings/${meeting.id}`, 'plain')).body.agenda[0].financeReport.detail, undefined);
});

// ---------- voting ----------

test('the committee size is the number of 本屆委員, and only they can register and vote', async () => {
    const f = await fixture();
    const report = await f.createReport();
    await f.submit(report.id);
    const meeting = await f.committeeMeeting(report.id);
    await f.setStatus(meeting.id, 'announced');
    assert.equal((await f.attend(meeting.id, 'plain')).status, 403, 'not a committee member');
    assert.equal((await f.attend(meeting.id, 'chair')).status, 403);
    const opened = await f.setStatus(meeting.id, 'open');
    assert.equal(opened.status, 200);
    assert.equal(opened.body.totalMembers, 4, 'comm1, comm2, comm3 and commt — not the old fixed 5');
    assert.deepEqual(opened.body.committeeRoster.map(entry => entry.username), ['comm1', 'comm2', 'comm3', 'commt']);
    assert.equal(opened.body.committeeRoster.find(entry => entry.username === 'commt').treasurer, true);
    assert.equal((await f.attend(meeting.id, 'plain')).status, 403);
    for (const who of ['comm1', 'comm2', 'comm3', 'commt']) assert.equal((await f.attend(meeting.id, who)).status, 200);
    const view = (await f.request(`/api/meetings/${meeting.id}`, 'plain')).body;
    assert.equal(view.committeeRoster, undefined, 'the roster is for the chair and the committee');
    assert.equal((await f.request(`/api/meetings/${meeting.id}`, 'comm1')).body.committeeRoster.length, 4);
    // somebody who joins the committee after the meeting opened is not on the frozen list
    await f.position('plain', ['committee']);
    assert.equal((await f.attend(meeting.id, 'plain')).status, 403);
    // an old meeting without a frozen list keeps the old behaviour (no OrgStore: 5 members)
    const legacy = await f.request('/api/meetings', 'chair', 'POST', { type: 'committee', title: '舊制', date: '2027-03-01' });
    assert.equal(legacy.status, 201);
});

test('conflict of interest: the committee member who is also 總務, or handled entries, cannot vote and is left out of the count', async () => {
    const f = await fixture();
    const report = await f.createReport();
    await f.submit(report.id);
    const meeting = await f.committeeMeeting(report.id);
    await f.setStatus(meeting.id, 'announced');
    await f.setStatus(meeting.id, 'open');
    for (const who of ['comm1', 'comm2', 'comm3', 'commt']) await f.attend(meeting.id, who);
    const itemId = meeting.agenda[0].id;
    const state = (await f.request(`/api/meetings/${meeting.id}`, 'chair')).body.agenda[0];
    assert.deepEqual(state.recusal.map(entry => entry.name).sort(), ['comm3姓名', 'commt姓名']);
    assert.match(state.recusal.find(entry => entry.name === 'commt姓名').reason, /兼任總務/);
    assert.match(state.recusal.find(entry => entry.name === 'comm3姓名').reason, /經手/);
    assert.equal((await f.request(`/api/meetings/${meeting.id}`, 'comm3')).body.agenda[0].recused, true);
    assert.equal((await f.request(`/api/meetings/${meeting.id}`, 'comm1')).body.agenda[0].recused, false);
    assert.equal((await f.request(`/api/meetings/${meeting.id}/agenda/${itemId}/vote`, 'chair', 'POST', { action: 'open' })).status, 200);
    const ballot = (who, choice) => f.request(`/api/meetings/${meeting.id}/agenda/${itemId}/ballot`, who, 'POST', { choice });
    for (const who of ['comm3', 'commt']) {
        const refused = await ballot(who, 'agree');
        assert.equal(refused.status, 403);
        assert.match(refused.body.error, /利益迴避/);
    }
    assert.equal((await ballot('plain', 'agree')).status, 403);
    assert.equal((await ballot('comm1', 'agree')).status, 200);
    assert.equal((await ballot('comm1', 'oppose')).status, 409, 'one ballot each');
    assert.equal((await ballot('comm2', 'agree')).status, 200);
    const closed = await f.request(`/api/meetings/${meeting.id}/agenda/${itemId}/vote`, 'chair', 'POST', { action: 'close' });
    const result = closed.body.agenda[0].vote.result;
    // 4 members − 2 recused = 2 in the denominator; 2 present; 2 agree
    assert.deepEqual([result.total, result.attendance, result.agree, result.needAttendance, result.needAgree], [2, 2, 2, 1, 1]);
    assert.equal(result.passed, true);
    assert.equal(result.established, true);
    assert.deepEqual(result.recused.map(entry => entry.name).sort(), ['comm3姓名', 'commt姓名']);
    assert.match(result.reason, /迴避/);
    // the minutes record the recusal
    const notes = closed.body.agenda[0].notes;
    assert.match(notes, /利益迴避：.*comm3姓名（經手報告中的帳目）/);
    assert.match(notes, /commt姓名（兼任總務）/);
    assert.match(closed.body.agenda[0].resolution, /照案通過/);
});

test('the vote decides the report: passed → 委員會審核通過 with the meeting and time', async () => {
    const f = await fixture();
    const report = await f.createReport();
    await f.submit(report.id);
    const meeting = await f.committeeMeeting(report.id);
    await f.setStatus(meeting.id, 'announced'); await f.setStatus(meeting.id, 'open');
    for (const who of ['comm1', 'comm2']) await f.attend(meeting.id, who);
    const itemId = meeting.agenda[0].id;
    await f.request(`/api/meetings/${meeting.id}/agenda/${itemId}/vote`, 'chair', 'POST', { action: 'open' });
    for (const who of ['comm1', 'comm2']) await f.request(`/api/meetings/${meeting.id}/agenda/${itemId}/ballot`, who, 'POST', { choice: 'agree' });
    assert.equal((await f.request(`/api/finance/reports/${report.id}`, 'treas')).body.status, 'submitted', 'still under review while voting');
    await f.request(`/api/meetings/${meeting.id}/agenda/${itemId}/vote`, 'chair', 'POST', { action: 'close' });
    const decided = (await f.request(`/api/finance/reports/${report.id}`, 'treas')).body;
    assert.equal(decided.status, 'approved');
    assert.equal(decided.statusLabel, '委員會審核通過');
    assert.equal(decided.review.meetingId, meeting.id);
    assert.equal(decided.review.meetingTitle, '115-1 決算審核會議');
    assert.equal(decided.review.result, 'approved');
    assert.ok(Date.parse(decided.review.decidedAt) > 0);
    assert.ok(decided.history.some(entry => entry.action === 'review' && entry.result === 'approved' && entry.itemId === itemId));
    // reading the meeting again does not record the decision twice
    await f.request(`/api/meetings/${meeting.id}`, 'chair');
    assert.equal((await f.request(`/api/finance/reports/${report.id}`, 'treas')).body.history.filter(entry => entry.action === 'review').length, 1);
    assert.equal((await f.request('/api/finance/reports', 'treas')).body.reports[0].statusLabel, '委員會審核通過');
    // after the meeting the committee keeps read-only access through it
    await f.setStatus(meeting.id, 'closed');
    assert.ok((await f.request(`/api/meetings/${meeting.id}`, 'comm1')).body.agenda[0].financeReport.detail.snapshot);
    // an approved version cannot be resubmitted while its ledger is unchanged
    assert.equal((await f.request(`/api/finance/reports/${report.id}/resubmit`, 'treas', 'POST', {})).status, 409);
});

test('a failed vote returns the report with the opinions; a corrected new version is submitted and all versions are kept', async () => {
    const f = await fixture();
    const report = await f.createReport();
    await f.submit(report.id);
    const meeting = await f.committeeMeeting(report.id);
    await f.setStatus(meeting.id, 'announced'); await f.setStatus(meeting.id, 'open');
    for (const who of ['comm1', 'comm2']) await f.attend(meeting.id, who);
    const itemId = meeting.agenda[0].id;
    await f.request(`/api/meetings/${meeting.id}/agenda/${itemId}/vote`, 'chair', 'POST', { action: 'open' });
    await f.request(`/api/meetings/${meeting.id}/agenda/${itemId}/ballot`, 'comm1', 'POST', { choice: 'agree' });
    await f.request(`/api/meetings/${meeting.id}/agenda/${itemId}/ballot`, 'comm2', 'POST', { choice: 'oppose' });
    await f.request(`/api/meetings/${meeting.id}/agenda/${itemId}/notes`, 'chair', 'POST', { notes: '委員要求補齊螺旋槳收據', resolution: '' });
    const closed = await f.request(`/api/meetings/${meeting.id}/agenda/${itemId}/vote`, 'chair', 'POST', { action: 'close' });
    assert.equal(closed.body.agenda[0].vote.result.passed, false);
    assert.match(closed.body.agenda[0].vote.result.reason, /可否同數/);
    const returned = (await f.request(`/api/finance/reports/${report.id}`, 'treas')).body;
    assert.equal(returned.status, 'returned');
    assert.equal(returned.statusLabel, '退回');
    assert.match(returned.review.note, /可否同數/);
    assert.match(returned.review.note, /補齊螺旋槳收據/);
    // 總務 corrects the ledger and submits a new version
    assert.equal((await f.request(`/api/finance/transactions/${f.gear.id}/receipt`, 'treas', 'PATCH', { receiptFileId: '33333333-3333-4333-8333-333333333333' })).status, 200);
    assert.equal((await f.request(`/api/finance/transactions/${f.gear.id}/receipt`, 'treas', 'PATCH', { receiptFileId: 'bad' })).status, 400);
    assert.equal((await f.request(`/api/finance/transactions/${f.gear.id}/receipt`, 'plain', 'PATCH', { receiptFileId: '' })).status, 403);
    const next = await f.request(`/api/finance/reports/${report.id}/resubmit`, 'treas', 'POST', {});
    assert.equal(next.status, 201);
    assert.equal(next.body.version, 2);
    assert.equal(next.body.snapshot.transactions.find(item => item.id === f.gear.id).receiptUrl, '/files/33333333-3333-4333-8333-333333333333');
    const versions = (await f.request('/api/finance/reports', 'treas')).body.reports;
    assert.deepEqual(versions.map(item => [item.version, item.status]), [[2, 'submitted'], [1, 'returned']]);
    assert.equal((await f.request(`/api/finance/reports/${report.id}`, 'treas')).body.review.result, 'returned', 'the earlier review stays on the old version');
    // the new version goes to the next meeting; a superseded version can no longer be attached
    const again = await f.request('/api/meetings', 'chair', 'POST', { type: 'committee', title: '複審', date: '2027-02-20', agenda: [{ kind: 'finance', title: '複審', financeReportId: report.id }] });
    assert.equal(again.status, 201, 'a returned version can still be attached (it is not superseded)');
    const second = await f.request('/api/meetings', 'chair', 'POST', { type: 'committee', title: '複審2', date: '2027-02-21', agenda: [{ kind: 'finance', title: '複審', financeReportId: next.body.id }] });
    assert.equal(second.status, 201);
});

test('too few present because of recusal: the vote is "不成立" and the report is returned', async () => {
    const f = await fixture();
    const report = await f.createReport();
    await f.submit(report.id);
    const meeting = await f.committeeMeeting(report.id);
    await f.setStatus(meeting.id, 'announced'); await f.setStatus(meeting.id, 'open');
    // only the two recused members attend
    for (const who of ['comm3', 'commt']) await f.attend(meeting.id, who);
    const itemId = meeting.agenda[0].id;
    await f.request(`/api/meetings/${meeting.id}/agenda/${itemId}/vote`, 'chair', 'POST', { action: 'open' });
    const closed = await f.request(`/api/meetings/${meeting.id}/agenda/${itemId}/vote`, 'chair', 'POST', { action: 'close' });
    const result = closed.body.agenda[0].vote.result;
    assert.equal(result.established, false);
    assert.equal(result.passed, false);
    assert.equal(result.attendance, 0);
    assert.match(result.reason, /表決不成立/);
    assert.match(result.reason, /迴避/);
    assert.match(closed.body.agenda[0].resolution, /未通過/);
    assert.equal((await f.request(`/api/finance/reports/${report.id}`, 'treas')).body.status, 'returned');
    // a manual count follows the same rules
    const manual = await f.request(`/api/meetings/${meeting.id}/agenda/${itemId}/vote`, 'chair', 'POST', { action: 'manual', agree: 0, oppose: 0, abstain: 0 });
    assert.equal(manual.body.agenda[0].vote.result.established, false);
});

test('the recusal and result maths without a server', () => {
    const roster = [{ username: 'a', memberId: 'm1', name: 'A', treasurer: false }, { username: 'b', memberId: 'm2', name: 'B', treasurer: true }, { username: 'c', memberId: 'm3', name: 'C', treasurer: false }, { username: 'd', memberId: 'm4', name: 'D', treasurer: false }, { username: 'e', memberId: 'm5', name: 'E', treasurer: false }];
    const meeting = { type: 'committee', committeeRoster: roster, totalMembers: 5, attendance: roster.map(entry => ({ memberId: entry.memberId, voting: true })) };
    const item = { financeReport: { id: 'x', handlers: ['c', 'zzz'] } };
    assert.deepEqual(recusedFor(meeting, item).map(entry => entry.username), ['b', 'c']);
    assert.deepEqual(recusedFor(meeting, {}), [], 'items without a finance report have no recusal');
    assert.deepEqual(recusedFor({ ...meeting, type: 'officers' }, item), [], 'only the committee recuses');
    assert.deepEqual(recusedFor({ ...meeting, committeeRoster: undefined }, item), []);
    const electorate = itemElectorate(meeting, item);
    assert.deepEqual([electorate.total, electorate.attendance], [3, 3]);
    assert.equal(itemElectorate(meeting, {}).total, 5);
    // 3 present of 3: need 2 present, agree ≥ 2; a tie fails
    assert.equal(voteResult('committee', { total: 3, attendance: 3, agree: 2, oppose: 1 }).passed, true);
    assert.equal(voteResult('committee', { total: 3, attendance: 2, agree: 1, oppose: 1 }).passed, false);
    assert.equal(voteResult('committee', { total: 3, attendance: 1, agree: 1, oppose: 0 }).established, false);
    // the committee threshold itself is unchanged: 1/2 present, 1/2 agree, ties fail
    assert.equal(voteResult('committee', { total: 5, attendance: 3, agree: 2, oppose: 1 }).passed, true);
    assert.equal(voteResult('committee', { total: 5, attendance: 2, agree: 2, oppose: 0 }).established, false);
});

// ---------- the assembly ----------

test('an approved settlement is added to the next assembly as a 報告事項 in one click', async () => {
    const f = await fixture();
    const report = await f.createReport();
    assert.equal((await f.request(`/api/finance/reports/${report.id}/add-to-assembly`, 'treas', 'POST', {})).status, 409, 'not approved yet');
    await f.submit(report.id);
    const meeting = await f.committeeMeeting(report.id);
    await f.setStatus(meeting.id, 'announced'); await f.setStatus(meeting.id, 'open');
    for (const who of ['comm1', 'comm2']) await f.attend(meeting.id, who);
    const itemId = meeting.agenda[0].id;
    await f.request(`/api/meetings/${meeting.id}/agenda/${itemId}/vote`, 'chair', 'POST', { action: 'open' });
    for (const who of ['comm1', 'comm2']) await f.request(`/api/meetings/${meeting.id}/agenda/${itemId}/ballot`, who, 'POST', { choice: 'agree' });
    await f.request(`/api/meetings/${meeting.id}/agenda/${itemId}/vote`, 'chair', 'POST', { action: 'close' });
    assert.equal((await f.request(`/api/finance/reports/${report.id}/add-to-assembly`, 'treas', 'POST', {})).status, 404, 'no assembly to add it to');
    const later = await f.request('/api/meetings', 'chair', 'POST', { type: 'assembly', title: '期末社員大會', date: '2099-01-10', agenda: [{ kind: 'report', title: '社長報告' }] });
    const earlier = await f.request('/api/meetings', 'chair', 'POST', { type: 'assembly', title: '較早的社員大會', date: '2098-12-01' });
    assert.equal((await f.request(`/api/finance/reports/${report.id}/add-to-assembly`, 'plain', 'POST', {})).status, 403);
    const added = await f.request(`/api/finance/reports/${report.id}/add-to-assembly`, 'treas', 'POST', {});
    assert.equal(added.status, 200, JSON.stringify(added.body));
    assert.equal(added.body.meetingId, earlier.body.id, 'the next upcoming assembly');
    const agenda = (await f.request(`/api/meetings/${earlier.body.id}`, 'chair')).body.agenda;
    assert.equal(agenda.length, 1);
    assert.equal(agenda[0].kind, 'report');
    assert.equal(agenda[0].threshold, 'none');
    assert.match(agenda[0].title, /115-1 學期決算書/);
    assert.match(agenda[0].description, /審核通過/);
    assert.match(agenda[0].description, /NT\$ 17,500/);
    assert.equal((await f.request(`/api/finance/reports/${report.id}/add-to-assembly`, 'treas', 'POST', {})).status, 409, 'not twice');
    assert.equal(later.status, 201);
    // a budget (預算書) is not added this way
    const budget = await f.createReport('treas', { semester: '115-1', kind: 'budget' });
    assert.equal((await f.request(`/api/finance/reports/${budget.id}/add-to-assembly`, 'treas', 'POST', {})).status, 409);
});

test('assembly voting and every other meeting rule is unchanged', async () => {
    const f = await fixture();
    const created = await f.request('/api/meetings', 'chair', 'POST', { type: 'officers', title: '幹部會議', date: '2027-03-01', agenda: [{ kind: 'discussion', title: '討論' }] });
    assert.equal(created.body.agenda[0].threshold, 'majority');
    assert.equal(created.body.agenda[0].financeReport, null);
    assert.deepEqual(created.body.agenda[0].recusal, []);
    // a browser cannot smuggle an attachment into a non-finance item or invent one
    const forged = await f.request('/api/meetings', 'chair', 'POST', { type: 'committee', title: 'x', date: '2027-03-02', agenda: [{ kind: 'discussion', title: 'x', financeReport: { id: '11111111-1111-4111-8111-111111111111', handlers: [] } }] });
    assert.equal(forged.body.agenda[0].financeReport, null);
    const forged2 = await f.request('/api/meetings', 'chair', 'POST', { type: 'committee', title: 'x', date: '2027-03-02', agenda: [{ kind: 'finance', title: 'x', financeReport: { id: '11111111-1111-4111-8111-111111111111', handlers: [] } }] });
    assert.equal(forged2.status, 400, 'attachments are looked up on the server');
    assert.equal((await f.request('/api/meetings', 'plain', 'POST', {})).status, 403);
});
