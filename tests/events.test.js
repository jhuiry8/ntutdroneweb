import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { EventStore, MeetingStore, MessageStore } from '../src/worker.js';
import { buildIcs, foldLine, icsEscape } from '../src/ical.js';
import { csvCell, runEventReminders } from '../src/event-routes.js';
import { withSiteStore } from './helpers/site-store.js';

function durableObject(Class) {
    const values = new Map();
    let tail = Promise.resolve();
    const storage = {
        async get(key) { return structuredClone(values.get(key)); },
        async put(key, value) { values.set(key, structuredClone(value)); },
        async delete(keys) { for (const key of [].concat(keys)) values.delete(key); },
        async list({ prefix = '', start = '', limit = Infinity } = {}) {
            return new Map([...values.entries()].filter(([key]) => key.startsWith(prefix) && key >= start).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit).map(([k, v]) => [k, structuredClone(v)]));
        },
        transaction(callback) { const result = tail.then(() => callback(storage)); tail = result.catch(() => {}); return result; }
    };
    const object = new Class({ storage });
    return { idFromName: name => name, get: () => ({ fetch: (input, init) => object.fetch(input instanceof Request ? input : new Request(input, init)) }), values };
}

function fixture(extraEnv = {}) {
    const store = new Map();
    const db = {
        async get(key) { return store.get(key) ?? null; },
        async put(key, value) { store.set(key, typeof value === 'string' ? value : JSON.stringify(value)); },
        async delete(key) { store.delete(key); },
        async list({ prefix }) { return { keys: [...store.keys()].filter(name => name.startsWith(prefix)).map(name => ({ name })) }; }
    };
    for (const [username, role] of Object.entries({ president: 'president', cadre1: 'cadre', alice: 'member', bob: 'member', carol: 'member' })) {
        store.set(`user:${username}`, JSON.stringify({ username, role, active: true, version: 'v1', memberId: username === 'alice' ? 'm1' : '' }));
        store.set(`session:${username}`, JSON.stringify({ username, version: 'v1' }));
    }
    store.set('members:list', JSON.stringify([{ id: 'm1', name: '王小明', studentId: '112590001', level: 'member', feeStatus: 'lifetime' }]));
    const env = withSiteStore({ DRONE_DB: db, EVENT_STORE: durableObject(EventStore), MEETING_STORE: durableObject(MeetingStore), MESSAGE_STORE: durableObject(MessageStore), ...extraEnv });
    const raw = (path, who, method = 'GET', body, headers = {}) => worker.fetch(new Request(`https://example.com${path}`, {
        method,
        headers: { ...(who ? { Cookie: `session=${who}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }), env);
    const request = async (path, who, method = 'GET', body, headers) => {
        const response = await raw(path, who, method, body, headers);
        return { status: response.status, body: await response.json() };
    };
    return { request, raw, env, store };
}

const iso = hours => new Date(Date.now() + hours * 3600000).toISOString();
const base = (extra = {}) => ({ title: '飛行日', startsAt: iso(48), capacity: 2, audience: 'public', ...extra });
async function createEvent(f, extra) {
    const created = await f.request('/api/events', 'cadre1', 'POST', base(extra));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    return created.body;
}
let ip = 0;
async function guestRegister(f, id, name, extra = {}) {
    const { captchaId, captcha } = f.env.SITE_STORE.issueCaptcha();
    return f.request(`/api/events/${id}/register`, null, 'POST', {
        guest: { name, studentId: extra.studentId || `S${String(Math.random()).slice(2, 10)}`, email: extra.email || `${Math.random().toString(36).slice(2)}@example.com` }, captchaId, captcha
    }, { 'CF-Connecting-IP': extra.ip || `10.0.${Math.floor(++ip / 250)}.${ip % 250}` });
}

test('only officers create events, and fields are validated', async () => {
    const f = fixture();
    assert.equal((await f.request('/api/events', null, 'POST', base())).status, 401);
    assert.equal((await f.request('/api/events', 'alice', 'POST', base())).status, 403);
    assert.equal((await f.request('/api/events', 'cadre1', 'POST', base({ title: '' }))).status, 400);
    assert.equal((await f.request('/api/events', 'cadre1', 'POST', base({ audience: 'nobody' }))).status, 400);
    assert.equal((await f.request('/api/events', 'cadre1', 'POST', base({ capacity: -1 }))).status, 400);
    assert.equal((await f.request('/api/events', 'cadre1', 'POST', base({ registrationDeadline: iso(72) }))).status, 400);
    const created = await createEvent(f, { description: '**粗體** <script>alert(1)</script>', startsAt: '2030-05-04T09:30' });
    assert.equal(created.startsAt, '2030-05-04T01:30:00.000Z', 'datetime-local is Taipei time');
    assert.match(created.descriptionHtml, /<strong>粗體<\/strong>/);
    assert.doesNotMatch(created.descriptionHtml, /<script/);
});

test('capacity is never oversold, the rest wait in order', async () => {
    const f = fixture();
    const event = await createEvent(f, { capacity: 3 });
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => guestRegister(f, event.id, `訪客${i}`)));
    assert.ok(results.every(r => r.status === 201), JSON.stringify(results.map(r => r.body)));
    assert.equal(results.filter(r => r.body.registration.status === 'confirmed').length, 3);
    const view = (await f.request(`/api/events/${event.id}`, null)).body;
    assert.equal(view.confirmed, 3);
    assert.equal(view.waitlist, 7);
    assert.equal(view.full, true);
});

test('cancelling a seat promotes the first waitlisted person; waitlist cancels promote nobody', async () => {
    const f = fixture();
    const event = await createEvent(f, { capacity: 1 });
    assert.equal((await f.request(`/api/events/${event.id}/register`, 'alice', 'POST', {})).body.me.status, 'confirmed');
    const bob = await f.request(`/api/events/${event.id}/register`, 'bob', 'POST', {});
    assert.deepEqual([bob.body.me.status, bob.body.me.position], ['waitlist', 1]);
    assert.equal((await f.request(`/api/events/${event.id}/register`, 'carol', 'POST', {})).body.me.position, 2);
    // Duplicate sign-up is refused.
    assert.equal((await f.request(`/api/events/${event.id}/register`, 'bob', 'POST', {})).status, 409);
    // Carol (2nd on the list) leaves: nobody moves up into a seat.
    const carolLeaves = await f.request(`/api/events/${event.id}/cancel`, 'carol', 'POST', {});
    assert.equal(carolLeaves.body.promoted, 0);
    assert.equal((await f.request(`/api/events/${event.id}`, 'bob')).body.me.status, 'waitlist');
    // Alice leaves: Bob is promoted automatically.
    assert.equal((await f.request(`/api/events/${event.id}/cancel`, 'alice', 'POST', {})).body.promoted, 1);
    const bobNow = (await f.request(`/api/events/${event.id}`, 'bob')).body;
    assert.equal(bobNow.me.status, 'confirmed');
    assert.equal(bobNow.confirmed, 1);
    // Member registrations carry the roster name and student id.
    const roster = (await f.request(`/api/events/${event.id}/registrations`, 'cadre1')).body.registrations;
    assert.equal(roster[0].name, 'bob');
});

test('raising capacity and officer removal both pull people off the waitlist', async () => {
    const f = fixture();
    const event = await createEvent(f, { capacity: 1 });
    for (const who of ['alice', 'bob', 'carol']) await f.request(`/api/events/${event.id}/register`, who, 'POST', {});
    const raised = await f.request(`/api/events/${event.id}`, 'cadre1', 'PATCH', { capacity: 2 });
    assert.deepEqual([raised.body.confirmed, raised.body.waitlist], [2, 1]);
    const roster = (await f.request(`/api/events/${event.id}/registrations`, 'cadre1')).body.registrations;
    const removed = await f.request(`/api/events/${event.id}/registrations/${roster[0].id}`, 'cadre1', 'DELETE');
    assert.deepEqual([removed.body.event.confirmed, removed.body.event.waitlist], [2, 0]);
    // Unlimited capacity admits everybody.
    const unlimited = await createEvent(f, { capacity: 0 });
    for (const who of ['alice', 'bob']) await f.request(`/api/events/${unlimited.id}/register`, who, 'POST', {});
    assert.equal((await f.request(`/api/events/${unlimited.id}`, null)).body.confirmed, 2);
});

test('registration closes at the deadline and at the start; officers can still add people', async () => {
    const f = fixture();
    const closed = await createEvent(f, { registrationDeadline: iso(-1), startsAt: iso(24) });
    assert.equal((await f.request(`/api/events/${closed.id}`, 'alice')).body.open, false);
    const refused = await f.request(`/api/events/${closed.id}/register`, 'alice', 'POST', {});
    assert.equal(refused.status, 409);
    assert.match(refused.body.error, /截止/);
    assert.equal((await guestRegister(f, closed.id, '晚到')).status, 409);
    const added = await f.request(`/api/events/${closed.id}/registrations`, 'cadre1', 'POST', { name: '補報名', studentId: '110000001' });
    assert.equal(added.status, 200);
    assert.equal(added.body.event.confirmed, 1);
    // Without an explicit deadline the start time is the deadline.
    const started = await createEvent(f, { startsAt: iso(-1) });
    assert.equal((await f.request(`/api/events/${started.id}/register`, 'alice', 'POST', {})).status, 409);
    // Manual add: needs an identifier, rejects duplicates, honours capacity unless forced.
    const small = await createEvent(f, { capacity: 1 });
    assert.equal((await f.request(`/api/events/${small.id}/registrations`, 'cadre1', 'POST', { name: '無資料' })).status, 400);
    await f.request(`/api/events/${small.id}/registrations`, 'cadre1', 'POST', { name: 'A', studentId: '110000001' });
    assert.equal((await f.request(`/api/events/${small.id}/registrations`, 'cadre1', 'POST', { name: 'A2', studentId: '110000001' })).status, 409);
    assert.equal((await f.request(`/api/events/${small.id}/registrations`, 'cadre1', 'POST', { name: 'B', studentId: '110000002' })).body.event.waitlist, 1);
    assert.equal((await f.request(`/api/events/${small.id}/registrations`, 'cadre1', 'POST', { name: 'C', studentId: '110000003', force: true })).body.event.confirmed, 2);
});

test('audience limits who can see and join', async () => {
    const f = fixture();
    const members = await createEvent(f, { audience: 'members', title: '社員活動' });
    const officers = await createEvent(f, { audience: 'officers', title: '幹部活動' });
    const ids = async who => (await f.request('/api/events', who)).body.events.map(e => e.title).sort();
    assert.deepEqual(await ids(null), []);
    assert.deepEqual(await ids('alice'), ['社員活動']);
    assert.deepEqual(await ids('cadre1'), ['幹部活動', '社員活動']);
    assert.equal((await f.request(`/api/events/${members.id}`, null)).status, 404);
    assert.equal((await f.request(`/api/events/${officers.id}`, 'alice')).status, 404);
    assert.equal((await f.request(`/api/events/${officers.id}/register`, 'alice', 'POST', {})).status, 404);
    assert.equal((await guestRegister(f, members.id, '訪客')).status, 404);
    assert.equal((await f.request(`/api/events/${officers.id}/register`, 'cadre1', 'POST', {})).status, 200);
    // Non-officers cannot read rosters, edit or delete.
    assert.equal((await f.request(`/api/events/${members.id}/registrations`, 'alice')).status, 403);
    assert.equal((await f.request(`/api/events/${members.id}`, 'alice', 'PATCH', { title: 'x' })).status, 403);
    assert.equal((await f.request(`/api/events/${members.id}`, 'alice', 'DELETE')).status, 403);
    assert.equal((await f.request(`/api/events/${members.id}/registrations.csv`, null)).status, 401);
    // Visitors never see who else signed up.
    await f.request(`/api/events/${members.id}/register`, 'alice', 'POST', {});
    const view = (await f.request(`/api/events/${members.id}`, 'bob')).body;
    assert.equal(view.registrations, undefined);
    assert.equal(view.description, undefined, 'raw markdown is for officers');
});

test('guest sign-up needs a CAPTCHA, is rate limited, and can be cancelled with the token', async () => {
    const f = fixture();
    const event = await createEvent(f, { capacity: 5 });
    const body = { guest: { name: '訪客', studentId: '112000001', email: 'g@example.com' } };
    const noCaptcha = await f.request(`/api/events/${event.id}/register`, null, 'POST', { ...body, captchaId: crypto.randomUUID(), captcha: 'wrong' });
    assert.equal(noCaptcha.status, 400);
    const { captchaId, captcha } = f.env.SITE_STORE.issueCaptcha();
    assert.equal((await f.request(`/api/events/${event.id}/register`, null, 'POST', { guest: { ...body.guest, email: 'bad' }, captchaId, captcha })).status, 400);
    const ok = await guestRegister(f, event.id, '訪客', { studentId: '112000001', email: 'g@example.com' });
    assert.equal(ok.status, 201);
    assert.match(ok.body.cancelToken, /^[a-f0-9]{32}$/);
    // Same student id or e-mail cannot register twice.
    assert.equal((await guestRegister(f, event.id, '訪客二', { studentId: '112000001' })).status, 409);
    assert.equal((await guestRegister(f, event.id, '訪客三', { email: 'g@example.com' })).status, 409);
    // Wrong token cannot cancel; the right one can.
    const wrong = await f.request(`/api/events/${event.id}/cancel`, null, 'POST', { registrationId: ok.body.registration.id, token: 'f'.repeat(32) });
    assert.equal(wrong.status, 404);
    assert.equal((await f.request(`/api/events/${event.id}/cancel`, null, 'POST', { registrationId: ok.body.registration.id, token: ok.body.cancelToken })).status, 200);
    // Per-IP limit: 10 per hour.
    const results = [];
    for (let i = 0; i < 12; i++) results.push((await guestRegister(f, event.id, `洪水${i}`, { ip: '203.0.113.9' })).status);
    assert.equal(results.filter(status => status === 429).length, 2);
    // Turnstile replaces the image CAPTCHA when configured.
    const t = fixture({ TURNSTILE_SECRET_KEY: 's', TURNSTILE_SITE_KEY: 'site' });
    const e2 = await createEvent(t);
    assert.deepEqual((await t.request('/api/public/events/captcha', null)).body, { turnstile: 'site' });
    assert.equal((await t.request(`/api/events/${e2.id}/register`, null, 'POST', { guest: body.guest })).status, 400);
});

test('CSV export is officer-only, includes waitlist, and neutralises spreadsheet formulas', async () => {
    const f = fixture();
    const event = await createEvent(f, { capacity: 1, feeRequired: true, feeAmount: 200 });
    await f.request(`/api/events/${event.id}/registrations`, 'cadre1', 'POST', { name: '=HYPERLINK("http://x")', studentId: '110000001', email: 'a@example.com' });
    await f.request(`/api/events/${event.id}/registrations`, 'cadre1', 'POST', { name: '王, "小" 明', studentId: '110000002' });
    assert.equal((await f.raw(`/api/events/${event.id}/registrations.csv`, 'alice')).status, 403);
    const response = await f.raw(`/api/events/${event.id}/registrations.csv`, 'cadre1');
    assert.match(response.headers.get('Content-Type'), /text\/csv/);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM so Excel reads Chinese');
    const text = new TextDecoder().decode(bytes);
    const lines = text.trim().split('\r\n');
    assert.equal(lines.length, 3);
    assert.match(lines[1], /^1,已報名,"'=HYPERLINK\(""http:\/\/x""\)",110000001,a@example.com,幹部加入,,否,/);
    assert.match(lines[2], /^2,候補,"王, ""小"" 明"/);
    assert.equal(csvCell('+1'), "'+1");
    assert.equal(csvCell('@a'), "'@a");
    // Fee tracking.
    const roster = (await f.request(`/api/events/${event.id}/registrations`, 'cadre1')).body.registrations;
    const paid = await f.request(`/api/events/${event.id}/registrations/${roster[0].id}`, 'cadre1', 'PATCH', { paid: true });
    assert.equal(paid.body.registrations[0].paid, true);
});

test('iCal output is well formed: CRLF, folding, escaping, UTC times', () => {
    const long = '很長的標題'.repeat(30);
    const ics = buildIcs([
        { uid: 'a@x', title: 'Fly, fun; day\\', description: 'line1\nline2', location: '操場', startsAt: '2030-05-04T01:30:00.000Z', updatedAt: '2030-01-01T00:00:00.000Z' },
        { uid: 'b@x', title: long, date: '2030-12-31' }
    ], { name: 'Club', now: '2030-01-01T00:00:00.000Z' });
    assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
    assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
    assert.ok(!/[^\r]\n/.test(ics), 'every line break is CRLF');
    assert.match(ics, /DTSTART:20300504T013000Z\r\nDTEND:20300504T033000Z/);
    assert.ok(ics.includes('SUMMARY:Fly\\, fun\\; day\\\\\r\n'), 'comma, semicolon and backslash are each escaped with a backslash');
    assert.equal(icsEscape('a;b'), 'a\\;b');
    assert.match(ics, /DESCRIPTION:line1\\nline2/);
    assert.match(ics, /DTSTART;VALUE=DATE:20301231\r\nDTEND;VALUE=DATE:20310101/);
    for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, `line too long: ${line}`);
    // Unfolding restores the original and never cuts a character in half.
    assert.ok(ics.replace(/\r\n /g, '').includes(`SUMMARY:${long}`));
    assert.equal(foldLine('short'), 'short');
});

test('/calendar.ics lists only public events; the member token feed adds member events and non-draft meetings', async () => {
    const f = fixture();
    await createEvent(f, { title: '公開飛行日', description: 'hello' });
    await createEvent(f, { title: '社員聚餐', audience: 'members' });
    await createEvent(f, { title: '幹部內部會', audience: 'officers' });
    const created = await f.request('/api/meetings', 'president', 'POST', { title: '定期社員大會', type: 'assembly', date: '2030-06-01', time: '19:00', location: 'A101', notice: '機密通知內容' });
    const draftOnly = await f.request('/api/meetings', 'president', 'POST', { title: '籌備中的大會', type: 'assembly', date: '2030-06-02' });
    const officers = await f.request('/api/meetings', 'president', 'POST', { title: '幹部月會', type: 'officers', date: '2030-06-03' });
    await f.request(`/api/meetings/${created.body.id}/status`, 'president', 'POST', { status: 'announced' });
    await f.request(`/api/meetings/${officers.body.id}/status`, 'president', 'POST', { status: 'announced' });

    const pub = await f.raw('/calendar.ics', null);
    assert.match(pub.headers.get('Content-Type'), /^text\/calendar/);
    const pubText = await pub.text();
    assert.match(pubText, /SUMMARY:公開飛行日/);
    assert.doesNotMatch(pubText, /社員聚餐|幹部內部會|定期社員大會/);
    assert.equal((pubText.match(/BEGIN:VEVENT/g) || []).length, 1);
    assert.match(pubText, /URL:https:\/\/example\.com\/events\//);

    const token = (await f.request('/api/calendar/token', 'alice')).body.url;
    assert.match(token, /^https:\/\/example\.com\/calendar\/member\/[a-f0-9]{32}\.ics$/);
    assert.equal((await f.request('/api/calendar/token', null)).status, 401);
    assert.equal((await f.request('/api/calendar/token', 'alice')).body.url, token, 'stable until rotated');
    const memberText = await (await f.raw(new URL(token).pathname, null)).text();
    assert.match(memberText, /公開飛行日/);
    assert.match(memberText, /社員聚餐/);
    assert.doesNotMatch(memberText, /幹部內部會|幹部月會|籌備中的大會|機密通知內容/);
    assert.match(memberText, /SUMMARY:定期社員大會（定期社員大會）/);
    assert.match(memberText, /DTSTART:20300601T110000Z/, '19:00 Taipei');
    // Officers' token also gets officer events and meetings.
    const officerText = await (await f.raw(new URL((await f.request('/api/calendar/token', 'cadre1')).body.url).pathname, null)).text();
    assert.match(officerText, /幹部內部會/);
    assert.match(officerText, /幹部月會/);
    // Rotating invalidates the old URL; bad tokens 404.
    const rotated = (await f.request('/api/calendar/token', 'alice', 'POST')).body.url;
    assert.notEqual(rotated, token);
    assert.equal((await f.raw(new URL(token).pathname, null)).status, 404);
    assert.equal((await f.raw(new URL(rotated).pathname, null)).status, 200);
    assert.equal((await f.raw(`/calendar/member/${'0'.repeat(32)}.ics`, null)).status, 404);
    // A deactivated account's token stops working.
    f.store.set('user:alice', JSON.stringify({ username: 'alice', role: 'member', active: false, version: 'v1' }));
    assert.equal((await f.raw(new URL(rotated).pathname, null)).status, 404);
    void draftOnly;
});

test('/calendar page renders month and list views in both languages without leaking private data', async () => {
    const f = fixture();
    const when = new Date(Date.now() + 5 * 86400000);
    const local = new Date(when.getTime() + 8 * 3600000).toISOString().slice(0, 10);
    await createEvent(f, { title: '公開飛行日', startsAt: `${local}T10:00` });
    await createEvent(f, { title: '社員限定聚餐', audience: 'members', startsAt: `${local}T12:00` });
    const m = await f.request('/api/meetings', 'president', 'POST', { title: '社員大會公告', type: 'assembly', date: local, time: '18:00', location: 'B2', notice: 'SECRET-NOTICE', agenda: [{ title: 'SECRET-AGENDA' }] });
    await f.request(`/api/meetings/${m.body.id}/status`, 'president', 'POST', { status: 'announced' });
    const page = async (path, who, headers) => (await f.raw(path, who, 'GET', undefined, headers)).text();

    const month = await page(`/calendar?m=${local.slice(0, 7)}`, null);
    assert.match(month, /公開飛行日/);
    assert.match(month, /社員大會公告/);
    assert.doesNotMatch(month, /社員限定聚餐|SECRET/);
    assert.match(month, /\/calendar\.ics/);
    assert.match(month, /href="\/calendar\?lang=zh"|活動行事曆/);
    assert.match(await page('/calendar?view=list', null), /公開飛行日/);
    assert.match(await page(`/calendar?m=${local.slice(0, 7)}`, 'alice'), /社員限定聚餐/);
    const english = await page('/calendar?lang=en&view=list', null);
    assert.match(english, /Club Calendar/);
    assert.match(english, /lang="en"/);
    // Bad month falls back to the current month instead of failing.
    assert.equal((await f.raw('/calendar?m=9999-99', null)).status, 200);
    // Event page shell: 404 for events the viewer cannot see.
    const events = (await f.request('/api/events', 'alice')).body.events;
    const memberEvent = events.find(e => e.audience === 'members');
    assert.equal((await f.raw(`/events/${memberEvent.id}`, null)).status, 404);
    assert.equal((await f.raw(`/events/${memberEvent.id}`, 'alice')).status, 200);
    // Navigation entry on the public pages.
    assert.match(await page('/', null), /href="\/calendar\?lang=zh"/);
    assert.match(await page('/blog', null), /href="\/calendar\?lang=zh"/);
});

test('admin events page is for officers only', async () => {
    const f = fixture();
    assert.equal((await f.raw('/admin/events', null)).status, 302);
    assert.equal((await f.raw('/admin/events', 'alice')).status, 403);
    assert.equal((await f.raw('/admin/events', 'cadre1')).status, 200);
});

test('day-before reminder posts one announcement per event and only once', async () => {
    const f = fixture();
    const tomorrow = await createEvent(f, { title: '明天的飛行日', startsAt: iso(30), capacity: 1, location: '操場' });
    const later = await createEvent(f, { title: '下週活動', startsAt: iso(24 * 7) });
    const empty = await createEvent(f, { title: '沒人報名', startsAt: iso(30) });
    await f.request(`/api/events/${tomorrow.id}/register`, 'alice', 'POST', {});
    await f.request(`/api/events/${tomorrow.id}/register`, 'bob', 'POST', {});
    await f.request(`/api/events/${later.id}/register`, 'alice', 'POST', {});
    // Run as the cron would, with "now" set so that startsAt falls on the next Taipei day.
    const startsAt = new Date(Date.parse(tomorrow.startsAt));
    const now = new Date(startsAt.getTime() - 24 * 3600000);
    assert.deepEqual(await runEventReminders(f.env, { now }), { reminded: 1 });
    const announcements = (await f.request('/api/announcements', 'alice')).body;
    assert.equal(announcements.length, 1);
    assert.match(announcements[0].title, /明天的飛行日/);
    assert.match(announcements[0].content, /已報名 1 人、候補 1 人/);
    assert.doesNotMatch(announcements[0].content, /王小明|alice|bob/, 'names are never broadcast');
    assert.deepEqual(await runEventReminders(f.env, { now }), { reminded: 0 }, 'sent only once');
    assert.equal((await f.request(`/api/events/${tomorrow.id}`, 'cadre1')).body.reminderSentAt !== '', true);
    // Rescheduled after the reminder went out: reminded again the day before the new date.
    const moved = (await f.request(`/api/events/${tomorrow.id}`, 'cadre1', 'PATCH', { startsAt: iso(30 + 24 * 3) })).body;
    assert.equal(moved.reminderSentAt, '');
    const newNow = new Date(Date.parse(moved.startsAt) - 24 * 3600000);
    assert.deepEqual(await runEventReminders(f.env, { now: newNow }), { reminded: 1 });
    void empty;
    // The worker routes the daily cron to the reminders and any other cron to the weekly report.
    const waits = [];
    await worker.scheduled({ cron: '0 12 * * *' }, f.env, { waitUntil: p => waits.push(p) });
    await Promise.all(waits);
});
