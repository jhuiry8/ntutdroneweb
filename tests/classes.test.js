import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { ClassStore, FormStore, MeetingStore, EquipmentStore } from '../src/worker.js';
import { academicYearOf, trialYearOf, trialUsesIn, applyTrialDelta, trialSummary, classCsv, applyClassOp, newClass, ClassError } from '../src/classes.js';
import { withSiteStore } from './helpers/site-store.js';

function durableObject(Class) {
    const values = new Map();
    let tail = Promise.resolve();
    const storage = {
        async get(key) { return structuredClone(values.get(key)); },
        async put(key, value) { values.set(key, structuredClone(value)); },
        async delete(keys) { for (const key of [].concat(keys)) values.delete(key); },
        async list({ prefix = '', limit = Infinity } = {}) { return new Map([...values.entries()].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit)); },
        transaction(callback) { const result = tail.then(() => callback(storage)); tail = result.catch(() => {}); return result; }
    };
    const object = new Class({ storage });
    return { idFromName: name => name, get: () => ({ fetch: (input, init) => object.fetch(input instanceof Request ? input : new Request(input, init)) }) };
}

const TODAY = new Date().toISOString().slice(0, 10);
const YEAR = academicYearOf(TODAY);
const LAST_YEAR = String(Number(YEAR) - 1);

const roster = () => [
    { id: 'f1', name: '正式一', studentId: 'A100', level: 'member', feeStatus: 'lifetime' },
    { id: 'f2', name: '欠費二', studentId: 'A200', level: 'member', feeStatus: 'semester', feeSemester: '100-1' },
    { id: 'o1', name: '幹部一', studentId: 'A300', level: 'officer', feeStatus: 'unpaid' },
    { id: 't1', name: '體驗一', studentId: 'T001', level: 'trial', feeStatus: 'unpaid', trialUses: 0 },
    { id: 't2', name: '體驗二', studentId: 'T002', level: 'trial', feeStatus: 'unpaid', trialUses: 2, trialYear: YEAR },
    { id: 't3', name: '體驗三', studentId: 'T003', level: 'trial', feeStatus: 'unpaid', trialUses: 2, trialYear: LAST_YEAR },
    { id: 't4', name: '體驗四', studentId: 'T004', level: 'trial', feeStatus: 'unpaid', trialUses: 1, trialYear: YEAR }
];

function fixture({ members: initial = roster(), failMemberWrites = false } = {}) {
    const store = new Map();
    const db = {
        async get(key) { return store.get(key) ?? null; },
        async put(key, value) { if (failMemberWrites && key === 'members:list') throw new Error('KV down'); store.set(key, typeof value === 'string' ? value : JSON.stringify(value)); },
        async delete(key) { store.delete(key); },
        async list({ prefix }) { return { keys: [...store.keys()].filter(name => name.startsWith(prefix)).map(name => ({ name })) }; }
    };
    for (const [username, role] of Object.entries({ president: 'president', cadre: 'cadre', u1: 'member' })) {
        store.set(`user:${username}`, JSON.stringify({ username, role, active: true, version: 'v1' }));
        store.set(`session:${username}`, JSON.stringify({ username, version: 'v1' }));
    }
    store.set('members:list', JSON.stringify(initial));
    const env = withSiteStore({ DRONE_DB: db, FORM_STORE: durableObject(FormStore), MEETING_STORE: durableObject(MeetingStore), EQUIPMENT_STORE: durableObject(EquipmentStore), CLASS_STORE: durableObject(ClassStore) });
    const send = (path, { who, method = 'GET', body, cookie, ip } = {}) => worker.fetch(new Request(`https://example.com${path}`, {
        method,
        headers: { ...(ip ? { 'CF-Connecting-IP': ip } : {}), ...(who || cookie ? { Cookie: [who && `session=${who}`, cookie].filter(Boolean).join('; ') } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }), env);
    const admin = (path, method = 'GET', body, who = 'president') => send(path, { who, method, body });
    const members = () => JSON.parse(store.get('members:list'));
    const member = id => members().find(item => item.id === id);

    // A phone: keeps its own cookie, like a browser.
    function phone(ip) {
        let cookie = '';
        return async function checkin(created, body, token = created.token) {
            const response = await send(`/api/public/classes/${created.id}/checkin`, { method: 'POST', body: { t: token, ...body }, cookie, ip });
            const set = response.headers.get('Set-Cookie');
            if (set) cookie = set.split(';')[0];
            return { status: response.status, body: await response.json() };
        };
    }
    // An officer creates a session and issues its link.
    async function openClass(fields = {}) {
        const created = await (await admin('/api/classes', 'POST', { date: TODAY, topic: '焊接入門', instructor: '王講師', location: 'T 館 101', ...fields })).json();
        const withToken = await (await admin(`/api/classes/${created.id}/token`, 'POST', {})).json();
        return withToken;
    }
    const detail = async id => (await (await admin(`/api/classes/${id}`)).json());
    return { send, admin, store, env, members, member, phone, openClass, detail };
}

test('academic year follows 學年 (August to July)', () => {
    assert.equal(academicYearOf('2026-08-01'), '115');
    assert.equal(academicYearOf('2027-07-31'), '115');
    assert.equal(academicYearOf('2027-08-01'), '116');
    assert.equal(academicYearOf('2027-01-15'), '115');
});

test('the trial counter is per academic year and never rolls back for an older year', () => {
    const member = { level: 'trial', trialUses: 2, trialYear: '114' };
    assert.equal(trialUsesIn(member, '114'), 2);
    assert.equal(trialUsesIn(member, '115'), 0);
    assert.equal(trialSummary(member, new Date('2026-11-01')).trialRemaining, 2);
    assert.equal(applyTrialDelta(member, 1, '115', new Date('2026-11-01')), true);
    assert.deepEqual([member.trialUses, member.trialYear], [1, '115']);
    // A back-dated class from last year does not touch this year's counter.
    assert.equal(applyTrialDelta(member, 1, '114', new Date('2026-11-01')), false);
    assert.deepEqual([member.trialUses, member.trialYear], [1, '115']);
    // Records from before trialYear existed count for the year they were created in.
    assert.equal(trialYearOf({ createdAt: '2025-10-01T00:00:00Z' }), '114');
    assert.equal(trialUsesIn({ trialUses: 2, createdAt: '2025-10-01T00:00:00Z' }, '115'), 0);
});

test('only officers manage classes', async () => {
    const { send, admin } = fixture();
    assert.equal((await send('/api/classes')).status, 401);
    assert.equal((await admin('/api/classes', 'GET', undefined, 'u1')).status, 403);
    assert.equal((await admin('/api/classes', 'POST', { date: TODAY, topic: 'x' }, 'u1')).status, 403);
    assert.equal((await admin('/api/classes', 'POST', { date: '2026-13-40', topic: 'x' })).status, 400);
    assert.equal((await admin('/api/classes', 'POST', { date: TODAY, topic: '' })).status, 400);
    const created = await admin('/api/classes', 'POST', { date: TODAY, topic: '無人機法規', instructor: '李', location: '教室' });
    assert.equal(created.status, 201);
    const view = await created.json();
    assert.equal(view.token, '', 'no link exists until an officer issues one');
    const listed = await (await admin('/api/classes', 'GET', undefined, 'cadre')).json();
    assert.equal(listed.classes.length, 1);
    assert.equal(listed.classes[0].token, undefined, 'the list does not carry live tokens');
});

test('the check-in link works only with the current, unexpired token', async t => {
    const { admin, openClass, phone, send, detail } = fixture();
    const created = await openClass();
    assert.match(created.token, /^[a-f0-9]{32}$/);
    assert.equal(created.checkinPath, `/class/${created.id}?t=${created.token}`);

    const first = phone();
    assert.equal((await first(created, { studentId: 'A100', name: '正式一' }, 'wrong')).status, 403);
    assert.equal((await first(created, { studentId: 'A100', name: '正式一' }, '')).status, 403);
    // The public page tells a stale link apart without exposing anything about the roster.
    const view = await (await send(`/api/public/classes/${created.id}?t=bad`)).json();
    assert.ok(view.tokenError);
    assert.equal(view.token, undefined);

    // A new token retires the old one.
    const reissued = await (await admin(`/api/classes/${created.id}/token`, 'POST', { ttlMinutes: 10 })).json();
    assert.notEqual(reissued.token, created.token);
    assert.equal((await first(created, { studentId: 'A100', name: '正式一' }, created.token)).status, 403);
    assert.equal((await first(created, { studentId: 'A100', name: '正式一' }, reissued.token)).status, 200);

    // Expiry.
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const late = phone();
    t.mock.timers.tick(9 * 60000);
    assert.equal((await late(created, { studentId: 'A200', name: '欠費二' }, reissued.token)).status, 200);
    t.mock.timers.tick(2 * 60000);
    const expired = await phone()(created, { studentId: 'A300', name: '幹部一' }, reissued.token);
    assert.equal(expired.status, 403);
    assert.match(expired.body.error, /過期/);
    assert.equal((await detail(created.id)).tokenState, 'expired');
    t.mock.timers.reset();

    // Bad lifetimes are refused; closing the class retires the link.
    assert.equal((await admin(`/api/classes/${created.id}/token`, 'POST', { ttlMinutes: 0 })).status, 400);
    assert.equal((await admin(`/api/classes/${created.id}/token`, 'POST', { ttlMinutes: 99999 })).status, 400);
    const fresh = await (await admin(`/api/classes/${created.id}/token`, 'POST', {})).json();
    await admin(`/api/classes/${created.id}/status`, 'POST', { status: 'closed' });
    assert.equal((await phone()(created, { studentId: 'A300', name: '幹部一' }, fresh.token)).status, 403);
    assert.equal((await admin(`/api/classes/${created.id}/token`, 'POST', {})).status, 409);
});

test('formal members and officers are recorded without touching the trial counter', async () => {
    const { openClass, phone, detail, members } = fixture();
    const created = await openClass();
    const a = await phone()(created, { studentId: ' a100 ', name: '正式 一' });
    assert.equal(a.status, 200);
    assert.equal(a.body.me.kind, 'member');
    assert.equal(a.body.me.remaining, null);
    // Membership validity comes from membershipStatus(): an expired fee is shown as unpaid, not rejected.
    assert.equal((await phone()(created, { studentId: 'A200', name: '欠費二' })).status, 200);
    assert.equal((await phone()(created, { studentId: 'A300', name: '幹部一' })).status, 200);
    const view = await detail(created.id);
    assert.equal(view.attendanceCount, 3);
    assert.deepEqual(view.attendance.map(entry => [entry.studentId, entry.kind, entry.paid]), [['A100', 'member', true], ['A200', 'member', false], ['A300', 'member', false]]);
    assert.equal(view.attendance.every(entry => !entry.deducted && !entry.overLimit), true);
    assert.deepEqual(members().map(item => item.trialUses), [undefined, undefined, undefined, 0, 2, 2, 1]);
});

test('a name that does not match the roster is not signed in', async () => {
    const { openClass, phone } = fixture();
    const created = await openClass();
    const wrong = await phone()(created, { studentId: 'A100', name: '別人' });
    assert.equal(wrong.status, 404);
    assert.equal(wrong.body.notInRoster, true);
});

test('duplicate check-ins are refused; one phone cannot sign in two people', async () => {
    const { openClass, phone, detail } = fixture();
    const created = await openClass();
    const mine = phone();
    assert.equal((await mine(created, { studentId: 'A100', name: '正式一' })).status, 200);
    // Same person, same phone (page reload): fine, not recorded twice.
    assert.equal((await mine(created, { studentId: 'A100', name: '正式一' })).status, 200);
    // Same person from another phone: blocked.
    assert.equal((await phone()(created, { studentId: 'A100', name: '正式一' })).status, 409);
    // Same phone, a different person: blocked.
    const blocked = await mine(created, { studentId: 'A200', name: '欠費二' });
    assert.equal(blocked.status, 409);
    assert.equal((await detail(created.id)).attendanceCount, 1);
});

test('trial members use up two free classes a year, then need to pay', async () => {
    const { openClass, phone, member, detail, admin } = fixture();
    const first = await openClass({ topic: '第一堂' });
    const one = await phone()(first, { studentId: 'T001', name: '體驗一' });
    assert.equal(one.body.me.remaining, 1);
    assert.deepEqual([member('t1').trialUses, member('t1').trialYear], [1, YEAR]);

    const second = await openClass({ topic: '第二堂' });
    const two = await phone()(second, { studentId: 'T001', name: '體驗一' });
    assert.equal(two.body.me.remaining, 0);
    assert.equal(member('t1').trialUses, 2);

    // The third class is recorded, flagged for payment, and does not use another free class.
    const third = await openClass({ topic: '第三堂' });
    const three = await phone()(third, { studentId: 'T001', name: '體驗一' });
    assert.equal(three.status, 200);
    assert.equal(three.body.me.overLimit, true);
    assert.equal(member('t1').trialUses, 2);
    const view = await detail(third.id);
    assert.equal(view.pendingCount, 1);
    assert.equal(view.attendance[0].statusLabel, '需繳費（待幹部決定）');

    // The officer lets it through, or takes it back.
    const entry = view.attendance[0];
    const approved = await (await admin(`/api/classes/${third.id}/attendance`, 'POST', { approve: true, entryId: entry.id })).json();
    assert.equal(approved.pendingCount, 0);
    assert.equal(approved.attendance[0].approvedBy, 'president');
    const undone = await (await admin(`/api/classes/${third.id}/attendance`, 'POST', { approve: true, entryId: entry.id, approved: false })).json();
    assert.equal(undone.pendingCount, 1);
    // Nothing to approve on a normal entry.
    const normal = (await detail(first.id)).attendance[0];
    assert.equal((await admin(`/api/classes/${first.id}/attendance`, 'POST', { approve: true, entryId: normal.id })).status, 400);

    // Removing a counted attendance gives the free class back.
    await admin(`/api/classes/${second.id}/attendance`, 'POST', { remove: true, entryId: (await detail(second.id)).attendance[0].id });
    assert.equal(member('t1').trialUses, 1);
    // Removing the flagged one changes nothing.
    await admin(`/api/classes/${third.id}/attendance`, 'POST', { remove: true, entryId: entry.id });
    assert.equal(member('t1').trialUses, 1);
});

test('a member already at the limit is flagged on the first check-in; last year\'s uses do not count', async () => {
    const { openClass, phone, member } = fixture();
    const created = await openClass();
    const over = await phone()(created, { studentId: 'T002', name: '體驗二' });
    assert.equal(over.body.me.overLimit, true);
    assert.equal(member('t2').trialUses, 2);
    const reset = await phone()(created, { studentId: 'T003', name: '體驗三' });
    assert.equal(reset.body.me.overLimit, false);
    assert.equal(reset.body.me.remaining, 1);
    assert.deepEqual([member('t3').trialUses, member('t3').trialYear], [1, YEAR]);
});

test('a class dated in a past year does not move this year\'s counter', async () => {
    const { admin, member, phone } = fixture();
    const created = await (await admin('/api/classes', 'POST', { date: `${Number(TODAY.slice(0, 4)) - 2}-10-10`, topic: '舊課' })).json();
    const withToken = await (await admin(`/api/classes/${created.id}/token`, 'POST', {})).json();
    const result = await phone()(withToken, { studentId: 'T004', name: '體驗四' });
    assert.equal(result.status, 200);
    assert.equal(result.body.me.overLimit, false);
    assert.equal(member('t4').trialUses, 1, 'this year\'s count is unchanged');
});

test('visitors sign in as guests and may join as trial members', async () => {
    const { openClass, phone, member, members, detail } = fixture();
    const created = await openClass();
    const stranger = { studentId: 'n123', name: '新同學' };
    const asked = await phone()(created, stranger);
    assert.equal(asked.status, 404);
    assert.equal(asked.body.notInRoster, true);
    assert.equal(members().length, 7, 'asking does not create anything');

    // As a plain visitor.
    const guest = await phone()(created, { ...stranger, asGuest: true });
    assert.equal(guest.status, 200);
    assert.equal(guest.body.me.kind, 'guest');
    assert.equal(members().length, 7);
    assert.equal((await phone()(created, { ...stranger, asGuest: true })).status, 409, 'same visitor twice');

    // Joining: a roster entry is created and this class is the first free one.
    const joined = await phone()(created, { studentId: 'n456', name: '想加入', asGuest: true, join: true });
    assert.equal(joined.status, 200);
    assert.deepEqual([joined.body.me.kind, joined.body.me.joined, joined.body.me.remaining], ['trial', true, 1]);
    const added = members().find(item => item.studentId === 'N456');
    assert.deepEqual([added.level, added.trialUses, added.trialYear], ['trial', 1, YEAR]);

    // A 學號 that is on the roster cannot be claimed under another name.
    const clash = await phone()(created, { studentId: 'A100', name: '冒名', asGuest: true });
    assert.equal(clash.status, 409);
    const view = await detail(created.id);
    assert.deepEqual(view.attendance.map(entry => entry.kind).sort(), ['guest', 'trial']);
    assert.equal(member('f1').trialUses, undefined);
});

test('a refused check-in does not leave a new roster entry behind', async () => {
    const { openClass, phone, members } = fixture();
    const created = await openClass();
    const same = phone();
    await same(created, { studentId: 'n1', name: '甲', asGuest: true });
    // Same phone, joining under another identity: refused before anything is written.
    const refused = await same(created, { studentId: 'n2', name: '乙', asGuest: true, join: true });
    assert.equal(refused.status, 409);
    assert.equal(members().length, 7);
    // A stale link cannot create roster entries either.
    const stale = await phone()(created, { studentId: 'n3', name: '丙', asGuest: true, join: true }, 'old');
    assert.equal(stale.status, 403);
    assert.equal(members().length, 7);
});

test('officers add people by hand, and deleting a class gives the free classes back', async () => {
    const { admin, openClass, member, detail } = fixture();
    const created = await openClass();
    const path = `/api/classes/${created.id}/attendance`;
    const added = await (await admin(path, 'POST', { memberId: 't1' })).json();
    assert.equal(added.attendance[0].by, 'president');
    assert.equal(member('t1').trialUses, 1);
    assert.equal((await admin(path, 'POST', { memberId: 't1' })).status, 409);
    assert.equal((await admin(path, 'POST', { memberId: 'nobody' })).status, 404);
    assert.equal((await admin(path, 'POST', {})).status, 400);
    // An officer adding someone over the limit is the decision to let it through.
    const over = await (await admin(path, 'POST', { memberId: 't2' })).json();
    assert.equal(over.pendingCount, 0);
    assert.equal(member('t2').trialUses, 2);
    // A visitor by name; a visitor without a 學號 is still deduplicated by name.
    assert.equal((await admin(path, 'POST', { guest: { name: '路人', studentId: '' } })).status, 200);
    assert.equal((await admin(path, 'POST', { guest: { name: '路 人' } })).status, 409);
    assert.equal((await admin(path, 'POST', { guest: { name: '' } })).status, 400);
    assert.equal((await admin(path, 'POST', { memberId: 'f1' }, 'u1')).status, 403);

    assert.equal((await detail(created.id)).attendanceCount, 3);
    assert.equal((await admin(`/api/classes/${created.id}`, 'DELETE')).status, 200);
    assert.equal(member('t1').trialUses, 0);
    assert.equal(member('t2').trialUses, 2);
    assert.equal((await admin(`/api/classes/${created.id}`)).status, 404);
});

test('concurrent check-ins are all recorded once', async () => {
    const members = Array.from({ length: 21 }, (_, index) => ({ id: `m${index}`, name: `社員${index}`, studentId: `S${index}`, level: 'trial', feeStatus: 'unpaid', trialUses: 0 }));
    const { openClass, phone, detail, members: stored } = fixture({ members });
    const created = await openClass();
    const results = await Promise.all(members.slice(0, 20).map(item => phone()(created, { studentId: item.studentId, name: item.name })));
    assert.deepEqual([...new Set(results.map(result => result.status))], [200]);
    assert.equal((await detail(created.id)).attendanceCount, 20);
    // The same person double-tapping from two phones at once is one record.
    const doubled = await Promise.all([phone()(created, { studentId: 'S20', name: '社員20' }), phone()(created, { studentId: 'S20', name: '社員20' })]);
    assert.deepEqual(doubled.map(result => result.status).sort(), [200, 409]);
    assert.equal((await detail(created.id)).attendanceCount, 21);
    // Every counter moved exactly once. (The roster is written without a lock; see the report.)
    const counts = stored().map(item => item.trialUses);
    assert.ok(counts.every(count => count === 1), `lost updates: ${counts.join(',')}`);
});

test('a failed roster write is flagged on the entry and not refunded later', async () => {
    const { openClass, phone, detail, admin, store } = fixture({ failMemberWrites: true });
    const created = await openClass();
    const result = await phone()(created, { studentId: 'T001', name: '體驗一' });
    assert.equal(result.status, 200, 'the person is still signed in');
    const entry = (await detail(created.id)).attendance[0];
    assert.equal(entry.syncError, true);
    await admin(`/api/classes/${created.id}/attendance`, 'POST', { remove: true, entryId: entry.id });
    assert.equal(JSON.parse(store.get('members:list')).find(item => item.id === 't1').trialUses, 0);
});

test('the roster and my-member views show attendance and this year\'s remaining free classes', async () => {
    const { admin, openClass, phone, store, send } = fixture();
    const created = await openClass();
    await phone()(created, { studentId: 'T001', name: '體驗一' });
    await phone()(created, { studentId: 'T003', name: '體驗三' });
    const list = await (await admin('/api/members')).json();
    const t1 = list.find(item => item.id === 't1');
    assert.deepEqual(t1.attendance, { total: 1, year: 1 });
    assert.equal(t1.status.trialRemaining, 1);
    // t3's stored counter belongs to last year; the roster shows this year's.
    const t4 = list.find(item => item.id === 't4');
    assert.equal(t4.status.trialRemaining, 1);
    assert.deepEqual(list.find(item => item.id === 'f1').attendance, { total: 0, year: 0 });

    // Editing the counter in the roster means "this year's count".
    const patched = await (await admin('/api/members/t3', 'PATCH', { trialUses: 2 })).json();
    assert.equal(patched.status.trialRemaining, 0);
    assert.equal(JSON.parse(store.get('members:list')).find(item => item.id === 't3').trialYear, YEAR);
    // A partial edit of a member whose counter is from last year does not bring the old count back.
    const lastYear = fixture();
    const edited = await (await lastYear.admin('/api/members/t3', 'PATCH', { note: '備註' })).json();
    assert.equal(edited.status.trialRemaining, 2);

    // A member sees their own numbers.
    store.set('user:u1', JSON.stringify({ username: 'u1', role: 'member', active: true, version: 'v1', memberId: 't1' }));
    const me = await (await send('/api/me', { who: 'u1' })).json();
    assert.deepEqual(me.member.attendance, { total: 1, year: 1 });
    assert.equal(me.member.status.trialRemaining, 1);
});

test('CSV export is for officers and neutralises spreadsheet formulas', async () => {
    const { admin, openClass, phone } = fixture();
    const created = await openClass({ topic: '=HYPERLINK("http://x")' });
    await phone()(created, { studentId: 'z9', name: '=1+1', asGuest: true });
    await phone()(created, { studentId: 'A100', name: '正式一' });
    assert.equal((await admin(`/api/classes/${created.id}/export.csv`, 'GET', undefined, 'u1')).status, 403);
    const response = await admin(`/api/classes/${created.id}/export.csv`);
    assert.match(response.headers.get('Content-Type'), /text\/csv/);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 3)], [0xEF, 0xBB, 0xBF], 'UTF-8 BOM so Excel reads the Chinese text');
    const csv = new TextDecoder().decode(bytes);
    assert.ok(csv.startsWith('日期,主題'));
    assert.match(csv, /'=1\+1/);
    assert.match(csv, /"'=HYPERLINK\(""http:\/\/x""\)"/);
    assert.match(csv, /正式一/);
    assert.ok(!/(^|,)=/m.test(csv));
    assert.equal(classCsv({ date: TODAY, topic: 't', instructor: '', location: '', attendance: [] }).split('\r\n').length, 2);
});

test('pure rules: a closed or expired class and the attendee cap', () => {
    const now = new Date().toISOString();
    const session = newClass({ date: TODAY, topic: '測試' }, 'p', now);
    const guest = { kind: 'guest', studentId: 'X1', name: '甲' };
    assert.throws(() => applyClassOp(session, 'checkin', { token: 'x', attendee: guest }, {}, now), ClassError);
    applyClassOp(session, 'token', { ttlMinutes: 5 }, { officer: true }, now);
    applyClassOp(session, 'checkin', { token: session.token, attendee: guest }, {}, now);
    assert.equal(session.attendance.length, 1);
    assert.throws(() => applyClassOp(session, 'checkin', { token: session.token, attendee: { ...guest, name: '乙' }, deviceHash: 'd' }, {}, now, Date.parse(now) + 6 * 60000), /過期/);
    assert.throws(() => applyClassOp(session, 'remove', { entryId: session.attendance[0].id }, { officer: false }, now), /只有幹部/);
});

test('a crowd of newcomers on one campus IP is not throttled; only failures count', async () => {
    const { openClass, phone } = fixture();
    const created = await openClass();
    for (let index = 0; index < 35; index++) {
        const result = await phone('10.0.0.1')(created, { studentId: `N${index}`, name: `新生${index}`, asGuest: true, join: index % 2 === 0 });
        assert.equal(result.status, 200, `check-in ${index + 1}`);
    }
    // Wrong names do count: after 30 failures the IP is held back.
    let last;
    for (let index = 0; index < 31; index++) last = await phone('10.0.0.2')(created, { studentId: 'A100', name: '錯' });
    assert.equal(last.status, 429);
});

test('a failing class store does not break the roster or my-member views', async () => {
    const { admin, env, store, send } = fixture();
    env.CLASS_STORE = { idFromName: name => name, get: () => ({ fetch: async () => Response.json({ error: 'boom' }, { status: 500 }) }) };
    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args);
    try {
        const list = await admin('/api/members');
        assert.equal(list.status, 200);
        assert.deepEqual((await list.json()).find(item => item.id === 'f1').attendance, { total: 0, year: 0 });
        assert.equal((await admin('/api/members/t1', 'PATCH', { note: 'x' })).status, 200);
        store.set('user:u1', JSON.stringify({ username: 'u1', role: 'member', active: true, version: 'v1', memberId: 't1' }));
        assert.equal((await send('/api/me', { who: 'u1' })).status, 200);
    } finally { console.error = original; }
    assert.ok(errors.length >= 3, 'each failure is logged');
});
