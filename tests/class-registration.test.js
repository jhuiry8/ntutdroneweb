import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { ClassStore, MessageStore } from '../src/worker.js';
import { academicYearOf, classRegOp, newClass, compareAttendance, rosterCsv, classView, ClassError } from '../src/classes.js';
import { runClassReminders } from '../src/class-routes.js';
import { withSiteStore } from './helpers/site-store.js';

function memoryStorage() {
    const values = new Map();
    let tail = Promise.resolve();
    const storage = {
        async get(key) { return structuredClone(values.get(key)); },
        async put(key, value) { values.set(key, structuredClone(value)); },
        async delete(keys) { for (const key of [].concat(keys)) values.delete(key); },
        async list({ prefix = '' } = {}) { return new Map([...values.entries()].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, structuredClone(v)])); },
        transaction(callback) { const result = tail.then(() => callback(storage)); tail = result.catch(() => {}); return result; }
    };
    return storage;
}
function durableObject(Class) {
    const storage = memoryStorage();
    const object = new Class({ storage });
    return { idFromName: name => name, get: () => ({ fetch: (input, init) => object.fetch(input instanceof Request ? input : new Request(input, init)) }), storage };
}

const taipeiDate = days => new Date(Date.now() + 8 * 3600000 + days * 86400000).toISOString().slice(0, 10);
const FUTURE = taipeiDate(3);
const YEAR = academicYearOf(FUTURE);

const roster = () => [
    { id: 'f1', name: '正式一', studentId: 'A100', level: 'member', feeStatus: 'lifetime' },
    { id: 'f2', name: '正式二', studentId: 'A200', level: 'member', feeStatus: 'lifetime' },
    { id: 'f3', name: '正式三', studentId: 'A300', level: 'member', feeStatus: 'lifetime' },
    { id: 'f4', name: '=cmd', studentId: 'A400', level: 'member', feeStatus: 'lifetime' },
    { id: 't1', name: '體驗一', studentId: 'T001', level: 'trial', feeStatus: 'unpaid', trialUses: 0, trialYear: YEAR },
    { id: 't2', name: '體驗二', studentId: 'T002', level: 'trial', feeStatus: 'unpaid', trialUses: 2, trialYear: YEAR }
];
const ACCOUNTS = { u1: 'f1', u2: 'f2', u3: 'f3', u4: 'f4', ut1: 't1', ut2: 't2' };

function fixture() {
    const store = new Map();
    const db = {
        async get(key) { return store.get(key) ?? null; },
        async put(key, value) { store.set(key, typeof value === 'string' ? value : JSON.stringify(value)); },
        async delete(key) { store.delete(key); },
        async list({ prefix }) { return { keys: [...store.keys()].filter(name => name.startsWith(prefix)).map(name => ({ name })) }; }
    };
    for (const [username, role, memberId] of [['president', 'president', ''], ['cadre', 'cadre', ''], ...Object.entries(ACCOUNTS).map(([name, member]) => [name, 'member', member])]) {
        store.set(`user:${username}`, JSON.stringify({ username, role, active: true, version: 'v1', memberId }));
        store.set(`session:${username}`, JSON.stringify({ username, version: 'v1' }));
    }
    store.set('members:list', JSON.stringify(roster()));
    const env = withSiteStore({ DRONE_DB: db, CLASS_STORE: durableObject(ClassStore), MESSAGE_STORE: durableObject(MessageStore) });
    let counter = 0;
    const send = async (path, { who, method = 'GET', body, ip } = {}) => {
        const response = await worker.fetch(new Request(`https://example.com${path}`, {
            method, headers: { ...(ip ? { 'CF-Connecting-IP': ip } : {}), ...(who ? { Cookie: `session=${who}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) })
        }), env);
        const text = await response.text();
        let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
        return { status: response.status, body: parsed, headers: response.headers };
    };
    const admin = (path, method = 'GET', body, who = 'president') => send(path, { who, method, body });
    async function openClass(extra = {}) {
        const created = await admin('/api/classes', 'POST', { date: FUTURE, time: '18:30', topic: '焊接入門', instructor: '王講師', location: 'T 館', registrationEnabled: true, capacity: 2, ...extra });
        assert.equal(created.status, 201, JSON.stringify(created.body));
        return created.body;
    }
    const register = (id, who) => send(`/api/public/classes/${id}/register`, { who, method: 'POST', body: {} });
    const cancel = (id, who) => send(`/api/public/classes/${id}/cancel`, { who, method: 'POST', body: {} });
    const guestRegister = (id, fields, { ip = `10.0.0.${++counter}`, captcha } = {}) => {
        const solved = captcha ?? env.SITE_STORE.issueCaptcha();
        return send(`/api/public/classes/${id}/register`, { method: 'POST', ip, body: { ...fields, captchaId: solved.captchaId, captcha: solved.captcha } });
    };
    const roll = async id => (await admin(`/api/classes/${id}/registrations`)).body;
    return { env, store, send, admin, openClass, register, cancel, guestRegister, roll };
}

test('registration settings are validated and shown to officers only', async () => {
    const f = fixture();
    const bad = (extra, pattern) => f.admin('/api/classes', 'POST', { date: FUTURE, time: '18:30', topic: 'x', registrationEnabled: true, ...extra }).then(response => { assert.equal(response.status, 400); assert.match(response.body.error, pattern); });
    await bad({ capacity: -1 }, /名額/);
    await bad({ capacity: 1.5 }, /名額/);
    await bad({ audience: 'everyone' }, /對象/);
    await bad({ registrationDeadline: `${taipeiDate(4)}T10:00` }, /截止時間不可晚於/);
    const created = await f.openClass({ registrationDeadline: `${taipeiDate(2)}T09:00`, audience: 'members' });
    assert.equal(created.registration.enabled, true);
    assert.equal(created.registration.capacity, 2);
    assert.equal(created.registration.audience, 'members');
    assert.equal(created.registration.deadlineLocal, `${taipeiDate(2)}T09:00`);
    assert.equal((await f.send(`/api/classes/${created.id}/registrations`, { who: 'u1' })).status, 403);
    assert.equal((await f.send(`/api/classes/${created.id}/registrations`)).status, 401);
});

test('seats, waitlist order and automatic promotion on cancel', async () => {
    const f = fixture();
    const { id } = await f.openClass();
    assert.equal((await f.register(id, 'u1')).body.registration.status, 'confirmed');
    assert.equal((await f.register(id, 'u2')).body.registration.status, 'confirmed');
    const third = await f.register(id, 'u3');
    assert.deepEqual([third.body.registration.status, third.body.registration.position], ['waitlist', 1]);
    const fourth = await f.register(id, 'u4');
    assert.deepEqual([fourth.body.registration.status, fourth.body.registration.position], ['waitlist', 2]);
    assert.equal(fourth.body.class.registration.seatsLeft, 0);
    assert.equal(fourth.body.class.registration.full, true);

    // Cancelling a confirmed seat promotes the first waiting person, not the last.
    const cancelled = await f.cancel(id, 'u1');
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.promoted, 1);
    let roll = await f.roll(id);
    assert.deepEqual(roll.registrations.map(r => [r.name, r.status]), [['正式二', 'confirmed'], ['正式三', 'confirmed'], ['=cmd', 'waitlist']]);
    // Cancelling a waitlisted place promotes nobody.
    assert.equal((await f.cancel(id, 'u4')).body.promoted, 0);
    // A late arrival cannot jump the queue into the freed seat: u1 comes back behind nobody (queue empty) and takes it only if free.
    assert.equal((await f.register(id, 'u1')).body.registration.status, 'waitlist');
    // Raising the capacity frees seats for the waitlist.
    assert.equal((await f.admin(`/api/classes/${id}`, 'PATCH', { capacity: 3 })).status, 200);
    roll = await f.roll(id);
    assert.equal(roll.confirmed, 3);
    assert.equal(roll.waitlist, 0);
    // Someone who is not registered gets a clear error.
    assert.equal((await f.cancel(id, 'u4')).status, 404);
});

test('a duplicate registration is rejected, also across account and 學號', async () => {
    const f = fixture();
    const { id } = await f.openClass({ capacity: 0 });
    assert.equal((await f.register(id, 'u1')).status, 201);
    const again = await f.register(id, 'u1');
    assert.equal(again.status, 409);
    // The same person without logging in (same 學號 and name) is the same registrant.
    const guest = await f.guestRegister(id, { studentId: 'a100', name: '正式一' });
    assert.equal(guest.status, 409);
    assert.equal((await f.roll(id)).confirmed, 1);
});

test('the deadline closes registration; a class without a deadline closes at its start', async () => {
    const f = fixture();
    const closed = await f.openClass({ registrationDeadline: '2020-01-01T00:00' });
    const response = await f.register(closed.id, 'u1');
    assert.equal(response.status, 409);
    assert.match(response.body.error, /截止/);
    const past = await f.openClass({ date: taipeiDate(-1) });
    assert.equal((await f.register(past.id, 'u1')).status, 409);
    const off = await f.openClass({ registrationEnabled: false });
    assert.match((await f.register(off.id, 'u1')).body.error, /不開放/);
    // After the check-in is closed registration is closed too.
    const open = await f.openClass();
    await f.admin(`/api/classes/${open.id}/status`, 'POST', { status: 'closed' });
    assert.equal((await f.register(open.id, 'u1')).status, 409);
});

test('self-cancel is refused once the class has started; officers can still remove', async () => {
    const storage = memoryStorage();
    const session = newClass({ date: '2026-12-01', time: '18:30', topic: 'x', registrationEnabled: true, capacity: 1 }, 'president', '2026-11-01T00:00:00.000Z');
    await storage.put(`class:${session.id}`, session);
    const who = { kind: 'member', username: 'u1', memberId: 'f1', studentId: 'A100', name: '正式一' };
    const before = '2026-12-01T09:00:00.000Z';
    const { reg } = await classRegOp(storage, 'register', { id: session.id, who }, before);
    const started = '2026-12-01T10:31:00.000Z'; // 18:31 Taipei
    await assert.rejects(classRegOp(storage, 'cancel', { id: session.id, actor: { username: 'u1' } }, started), error => error instanceof ClassError && error.status === 409);
    const removed = await classRegOp(storage, 'cancel', { id: session.id, regId: reg.id, actor: { officer: true, username: 'president' } }, started);
    assert.equal(removed.removed.id, reg.id);
    await assert.rejects(classRegOp(storage, 'register', { id: session.id, who: { ...who, username: 'u2', memberId: 'f2', studentId: 'A200' } }, started), /截止/);
});

test('audience: formal members only, members with trial members, or everyone', async () => {
    const f = fixture();
    const formal = await f.openClass({ audience: 'members', capacity: 0 });
    assert.equal((await f.register(formal.id, 'u1')).status, 201);
    const trialDenied = await f.register(formal.id, 'ut1');
    assert.equal(trialDenied.status, 403);
    assert.equal((await f.guestRegister(formal.id, { studentId: 'X999', name: '路人' })).status, 403);

    const withTrial = await f.openClass({ audience: 'with_trial', capacity: 0 });
    assert.equal((await f.register(withTrial.id, 'ut1')).status, 201);
    assert.equal((await f.guestRegister(withTrial.id, { studentId: 'X999', name: '路人' })).status, 403);

    const open = await f.openClass({ audience: 'all', capacity: 0 });
    assert.equal((await f.guestRegister(open.id, { studentId: 'X999', name: '路人' })).status, 201);
});

test('trial members see their remaining free classes; zero still registers but is flagged for officers', async () => {
    const f = fixture();
    const { id } = await f.openClass({ capacity: 0, audience: 'with_trial' });
    const fresh = await f.register(id, 'ut1');
    assert.equal(fresh.status, 201);
    assert.deepEqual(fresh.body.trial, { remaining: 2, limit: 2, needsFee: false });
    const spent = await f.register(id, 'ut2');
    assert.equal(spent.status, 201, 'registration is still allowed; an officer decides');
    assert.deepEqual(spent.body.trial, { remaining: 0, limit: 2, needsFee: true });
    const listing = await f.send('/api/public/classes', { who: 'ut2' });
    assert.equal(listing.body.classes[0].trial.needsFee, true);
    const roll = await f.roll(id);
    assert.deepEqual(roll.registrations.map(r => [r.name, r.trialRemaining, r.needsFee]), [['體驗一', 2, false], ['體驗二', 0, true]]);
    // Formal members carry no trial info.
    const formal = await f.register(id, 'u1');
    assert.equal(formal.body.trial, null);
});

test('visitors need the captcha, are rate limited, and cancel with the token they were given', async () => {
    const f = fixture();
    const { id } = await f.openClass({ capacity: 0 });
    const wrong = await f.send(`/api/public/classes/${id}/register`, { method: 'POST', body: { studentId: 'X1', name: '甲', captchaId: crypto.randomUUID(), captcha: 'nope' } });
    assert.equal(wrong.status, 400);
    assert.equal((await f.send(`/api/public/classes/${id}/register`, { method: 'POST', body: { studentId: 'X1', name: '甲' } })).status, 400);
    // Roster 學號 with another name is refused, not registered as a visitor.
    assert.equal((await f.guestRegister(id, { studentId: 'A100', name: '冒名' })).status, 409);
    // A roster member without an account registers as that member.
    const member = await f.guestRegister(id, { studentId: 'A200', name: '正式二' });
    assert.equal(member.status, 201);
    const roll = await f.roll(id);
    assert.equal(roll.registrations[0].kind, 'member');
    assert.equal(roll.registrations[0].cancelHash, undefined, 'the cancel hash never leaves the server');

    const visitor = await f.guestRegister(id, { studentId: 'X1', name: '甲' });
    assert.equal(visitor.status, 201);
    assert.match(visitor.body.cancelToken, /^[a-f0-9]{32}$/);
    const registrationId = visitor.body.registration.id;
    assert.equal((await f.send(`/api/public/classes/${id}/cancel`, { method: 'POST', body: { registrationId, token: 'wrong' } })).status, 404);
    assert.equal((await f.send(`/api/public/classes/${id}/cancel`, { method: 'POST', body: { registrationId, token: visitor.body.cancelToken } })).status, 200);

    // One IP gets 20 sign-ups an hour.
    let last;
    for (let i = 0; i < 21; i++) last = await f.guestRegister(id, { studentId: `R${i}`, name: `人${i}` }, { ip: '9.9.9.9' });
    assert.equal(last.status, 429);
});

test('attendance is compared with the registrations: attended, absent, walk-in', async () => {
    const f = fixture();
    const { id } = await f.openClass({ date: taipeiDate(0), time: '23:59', capacity: 0 });
    await f.register(id, 'u1'); await f.register(id, 'u2'); await f.register(id, 'u4');
    // Roster members check in with the link; one of them never registered.
    const link = await f.admin(`/api/classes/${id}/token`, 'POST', {});
    const checkin = (studentId, name, ip) => f.send(`/api/public/classes/${id}/checkin`, { method: 'POST', ip, body: { t: link.body.token, studentId, name } });
    assert.equal((await checkin('A100', '正式一', '1.1.1.1')).status, 200);
    assert.equal((await checkin('A300', '正式三', '1.1.1.2')).status, 200);
    assert.equal((await checkin('A400', '=cmd', '1.1.1.3')).status, 200);

    const roll = await f.roll(id);
    assert.deepEqual(roll.comparison.counts, { attended: 2, absent: 1, walkin: 1 });
    const byName = Object.fromEntries(roll.comparison.rows.map(row => [row.name, row.stateLabel]));
    assert.deepEqual(byName, { 正式一: '已報名已到', '=cmd': '已報名已到', 正式二: '已報名未到', 正式三: '未報名現場來' });

    const csv = await f.send(`/api/classes/${id}/roster.csv`, { who: 'cadre' });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('Content-Type'), /text\/csv/);
    assert.match(csv.body, /已報名已到/);
    assert.match(csv.body, /已報名未到/);
    assert.match(csv.body, /未報名現場來/);
    // A name that looks like a formula is neutralized, in the CSV the officers open in Excel.
    assert.match(csv.body, /'=cmd/);
    assert.doesNotMatch(csv.body, /,=cmd/);
    assert.equal((await f.send(`/api/classes/${id}/roster.csv`, { who: 'u1' })).status, 403);
});

test('a waitlisted person who shows up counts as a walk-in, one who does not is not "absent"', () => {
    const session = newClass({ date: '2026-12-01', topic: 'x', registrationEnabled: true, capacity: 1 }, 'p', '2026-11-01T00:00:00Z');
    const reg = (seq, status, key, name) => ({ seq, status, key, name, studentId: key.slice(2), kind: 'member', memberId: '' });
    const regs = [reg(1, 'confirmed', 's:A1', '甲'), reg(2, 'waitlist', 's:A2', '乙'), reg(3, 'waitlist', 's:A3', '丙')];
    session.attendance.push({ id: 'e1', key: 's:A2', name: '乙', studentId: 'A2', kind: 'member', at: 'T', memberId: '' });
    const { rows, counts } = compareAttendance(session, regs);
    assert.deepEqual(counts, { attended: 0, absent: 1, walkin: 1 });
    assert.equal(rows.find(row => row.name === '乙').regStatus, 'waitlist');
    assert.match(rosterCsv(session, regs), /候補（未到）/);
});

test('the public listing shows seats and schedule, never attendance or tokens', async () => {
    const f = fixture();
    const open = await f.openClass();
    await f.admin(`/api/classes/${open.id}/token`, 'POST', {});
    await f.register(open.id, 'u1');
    await f.openClass({ date: taipeiDate(-5), topic: '已過的課' });
    const page = await f.send('/classes');
    assert.equal(page.status, 200);
    const listing = await f.send('/api/public/classes');
    assert.equal(listing.status, 200);
    assert.equal(listing.body.classes.length, 1, 'past classes are not listed');
    const [entry] = listing.body.classes;
    assert.equal(entry.registration.seatsLeft, 1);
    assert.equal(entry.registration.confirmed, 1);
    assert.equal(entry.me, null);
    const raw = JSON.stringify(listing.body);
    assert.doesNotMatch(raw, /token|attendance|studentId|正式一/);
    const mine = await f.send('/api/public/classes', { who: 'u1' });
    assert.equal(mine.body.classes[0].me.status, 'confirmed');
    assert.equal(mine.body.signedIn, true);
});

test('officers can add and remove registrations; removing promotes the waitlist; deleting the class deletes them', async () => {
    const f = fixture();
    const { id } = await f.openClass({ capacity: 1 });
    await f.register(id, 'u1'); await f.register(id, 'u2');
    let roll = await f.roll(id);
    assert.deepEqual(roll.registrations.map(r => r.status), ['confirmed', 'waitlist']);
    roll = (await f.admin(`/api/classes/${id}/registrations/${roll.registrations[0].id}`, 'DELETE', undefined, 'cadre')).body;
    assert.deepEqual(roll.registrations.map(r => [r.name, r.status]), [['正式二', 'confirmed']]);
    // Officer add respects the capacity unless forced.
    assert.equal((await f.admin(`/api/classes/${id}/registrations`, 'POST', { memberId: 'f3' })).body.waitlist, 1);
    assert.equal((await f.admin(`/api/classes/${id}/registrations`, 'POST', { memberId: 'f4', force: true })).body.confirmed, 2);
    assert.equal((await f.admin(`/api/classes/${id}/registrations`, 'POST', { memberId: 'f4' })).status, 409);
    assert.equal((await f.admin(`/api/classes/${id}`, 'DELETE')).status, 200);
    const counts = await f.env.CLASS_STORE.get().fetch('https://class-store/reg/counts', { method: 'POST', body: '{}' }).then(r => r.json());
    assert.deepEqual(counts, {});
});

test('the day-before reminder goes out once per class, from the existing daily cron', async () => {
    const f = fixture();
    const tomorrow = await f.openClass({ date: taipeiDate(1), capacity: 0 });
    const later = await f.openClass({ date: taipeiDate(5), capacity: 0 });
    const empty = await f.openClass({ date: taipeiDate(1), topic: '沒人報名', capacity: 0 });
    for (const who of ['u1', 'u2']) { await f.register(tomorrow.id, who); await f.register(later.id, who); }
    const announcements = async () => (await (await f.env.MESSAGE_STORE.get().fetch('https://message-store/announcements', { method: 'POST', body: JSON.stringify({ actor: { username: 'president', officer: true, president: true } }) })).json());

    assert.deepEqual(await runClassReminders(f.env), { reminded: 1 });
    const list = await announcements();
    const items = list.announcements || list;
    assert.equal(items.length, 1);
    assert.match(items[0].title, /焊接入門/);
    assert.match(items[0].content, /已報名 2 人/);
    assert.doesNotMatch(items[0].content, /正式一/, 'the announcement names nobody');
    assert.deepEqual(await runClassReminders(f.env), { reminded: 0 });
    assert.ok((await f.admin(`/api/classes/${tomorrow.id}`)).body.reminderSentAt);
    assert.equal((await f.admin(`/api/classes/${empty.id}`)).body.reminderSentAt, '');

    // The scheduled() dispatch for the existing 20:00 cron runs it; no new cron is needed.
    const wrangler = (await import('node:fs')).readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
    assert.match(wrangler, /crons = \["0 1 \* \* 1", "0 19 \* \* \*", "0 18 \* \* \*", "0 12 \* \* \*"\]/);
    const waits = [];
    await worker.scheduled({ cron: '0 12 * * *' }, f.env, { waitUntil: promise => waits.push(promise) });
    await Promise.all(waits);
});

test('classView keeps the sequence counter private and defaults old sessions to no registration', () => {
    const old = { id: 'x', status: 'open', date: '2026-12-01', topic: 't', time: '', attendance: [], token: '', tokenExpiresAt: '' };
    const view = classView(old);
    assert.equal(view.registration.enabled, false);
    assert.equal(view.registration.audience, 'all');
    assert.equal('nextRegSeq' in classView(newClass({ date: '2026-12-01', topic: 't' }, 'p', 'now')), false);
});
