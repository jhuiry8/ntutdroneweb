import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { FormStore, MeetingStore, EquipmentStore } from '../src/worker.js';
import { voteResult, applyMeetingOp, newMeeting, meetingView, MeetingError } from '../src/meetings.js';
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

// Voting members m1–m4, m5 has not paid (no vote). Each has a bound account.
const roster = [
    { id: 'm1', name: '社員一', level: 'member', feeStatus: 'lifetime' },
    { id: 'm2', name: '社員二', level: 'member', feeStatus: 'lifetime' },
    { id: 'm3', name: '社員三', level: 'member', feeStatus: 'lifetime' },
    { id: 'm4', name: '幹部四', level: 'officer', feeStatus: 'unpaid' },
    { id: 'm5', name: '未繳五', level: 'member', feeStatus: 'unpaid' }
];

function fixture(extraEnv = {}) {
    const store = new Map();
    const db = {
        async get(key) { return store.get(key) ?? null; },
        async put(key, value) { store.set(key, typeof value === 'string' ? value : JSON.stringify(value)); },
        async delete(key) { store.delete(key); },
        async list({ prefix }) { return { keys: [...store.keys()].filter(name => name.startsWith(prefix)).map(name => ({ name })) }; }
    };
    const accounts = { president: ['president', 'm4'], cadre: ['cadre', ''], u1: ['member', 'm1'], u2: ['member', 'm2'], u3: ['member', 'm3'], u5: ['member', 'm5'], nobind: ['member', ''] };
    for (const [username, [role, memberId]] of Object.entries(accounts)) {
        store.set(`user:${username}`, JSON.stringify({ username, role, active: true, version: 'v1', memberId }));
        store.set(`session:${username}`, JSON.stringify({ username, version: 'v1' }));
    }
    store.set('members:list', JSON.stringify(roster));
    const env = withSiteStore({ DRONE_DB: db, FORM_STORE: durableObject(FormStore), MEETING_STORE: durableObject(MeetingStore), EQUIPMENT_STORE: durableObject(EquipmentStore), ...extraEnv });
    const request = (path, who, method = 'GET', body) => worker.fetch(new Request(`https://example.com${path}`, {
        method,
        headers: { ...(who ? { Cookie: `session=${who}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }), env);
    return { request, store, env };
}

test('vote thresholds follow the charter', () => {
    // 一般決議：總額 1/3 出席、出席 1/2 同意（含剛好二分之一）
    assert.equal(voteResult('ordinary', { total: 30, attendance: 10, agree: 5 }).passed, true);
    assert.equal(voteResult('ordinary', { total: 30, attendance: 9, agree: 9 }).passed, false);
    // 重大決議：2/3、2/3
    assert.equal(voteResult('major', { total: 30, attendance: 20, agree: 14 }).passed, true);
    assert.equal(voteResult('major', { total: 30, attendance: 20, agree: 13 }).passed, false);
    assert.equal(voteResult('major', { total: 30, attendance: 19, agree: 19 }).passed, false);
    // 罷免：1/2 出席、2/3 同意
    assert.equal(voteResult('recall', { total: 30, attendance: 15, agree: 10 }).passed, true);
    assert.equal(voteResult('recall', { total: 30, attendance: 14, agree: 14 }).passed, false);
    // 委員會：可否同數不通過
    assert.equal(voteResult('committee', { total: 5, attendance: 4, agree: 2, oppose: 2 }).passed, false);
    assert.equal(voteResult('committee', { total: 5, attendance: 4, agree: 2, oppose: 1, abstain: 1 }).passed, true);
    assert.equal(voteResult('majority', { total: 8, attendance: 6, agree: 3, oppose: 3 }).passed, false);
    assert.equal(voteResult('none', { total: 1, attendance: 1, agree: 1 }), null);
});

test('ballots are secret, single, and limited to checked-in voters', () => {
    const now = new Date().toISOString();
    const meeting = newMeeting({ title: '大會', date: '2026-12-01', agenda: [{ title: '案一' }] }, 'p', now);
    const officer = { username: 'p', officer: true };
    applyMeetingOp(meeting, 'status', { status: 'announced' }, officer, now);
    applyMeetingOp(meeting, 'status', { status: 'open', totalMembers: 3 }, officer, now);
    const itemId = meeting.agenda[0].id;
    applyMeetingOp(meeting, 'attend', { attendee: { memberId: 'a', name: 'A', voting: true } }, { officer: false }, now);
    applyMeetingOp(meeting, 'attend', { attendee: { memberId: 'b', name: 'B', voting: false } }, { officer: false }, now);
    applyMeetingOp(meeting, 'vote', { itemId, action: 'open' }, officer, now);
    applyMeetingOp(meeting, 'ballot', { itemId, choice: 'agree' }, { memberId: 'a' }, now);
    assert.throws(() => applyMeetingOp(meeting, 'ballot', { itemId, choice: 'agree' }, { memberId: 'a' }, now), /已經投過票/);
    assert.throws(() => applyMeetingOp(meeting, 'ballot', { itemId, choice: 'agree' }, { memberId: 'b' }, now), /不具表決權/);
    assert.throws(() => applyMeetingOp(meeting, 'ballot', { itemId, choice: 'agree' }, { memberId: 'c' }, now), /簽到/);
    const view = meetingView(meeting, { officer: false, memberId: 'a' });
    assert.deepEqual(view.agenda[0].vote, { state: 'open', round: 1, openedAt: now, ballots: 1 });
    assert.equal(view.agenda[0].voted, true);
    assert.equal(view.canVote, true);
    assert.equal(meetingView(meeting, { officer: false, memberId: 'b' }).canVote, false);
    assert.equal(JSON.stringify(view).includes('"voters"'), false);
    applyMeetingOp(meeting, 'vote', { itemId, action: 'close' }, officer, now);
    assert.equal(meeting.agenda[0].vote.result.passed, true);
    assert.equal(meeting.agenda[0].vote.result.attendance, 1);
    assert.equal(meeting.agenda[0].resolution, '照案通過。');
    assert.throws(() => applyMeetingOp(meeting, 'status', { status: 'draft' }, officer, now), MeetingError);
});

test('a general assembly runs end to end on the website', async (t) => {
    const { request } = fixture({ GROQ_API_KEY: 'gsk' });
    assert.equal((await request('/api/meetings', 'u1', 'POST', { title: 'x', date: '2026-12-01' })).status, 403);
    const createdResponse = await request('/api/meetings', 'cadre', 'POST', {
        type: 'assembly', title: '115-1 定期社員大會', date: '2026-12-01', time: '19:00', location: '綜科 B1', checkInCode: 'drone1',
        agenda: [{ kind: 'report', title: '社務報告' }, { kind: 'discussion', title: '社費調整案', threshold: 'major' }]
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.equal(created.checkInCode, 'DRONE1');
    assert.deepEqual(created.agenda.map(item => item.threshold), ['none', 'major']);
    const id = created.id;
    const motionId = created.agenda[1].id;

    // Members do not see drafts.
    assert.equal((await (await request('/api/meetings', 'u1')).json()).meetings.length, 0);
    assert.equal((await request(`/api/meetings/${id}`, 'u1')).status, 404);
    assert.equal((await request(`/api/meetings/${id}/status`, 'cadre', 'POST', { status: 'open' })).status, 400);
    assert.equal((await request(`/api/meetings/${id}/status`, 'cadre', 'POST', { status: 'announced' })).status, 200);
    const listed = await (await request('/api/meetings', 'u1')).json();
    assert.equal(listed.meetings.length, 1);
    assert.equal(listed.meetings[0].checkInCode, undefined);
    assert.equal(listed.meetings[0].requiresCode, true);
    assert.equal(listed.me.voting, true);

    // Opening snapshots the electorate: m1–m3 paid members + m4 formal officer = 4.
    assert.equal((await request(`/api/meetings/${id}/attendance`, 'u1', 'POST', { code: 'DRONE1' })).status, 400);
    const opened = await (await request(`/api/meetings/${id}/status`, 'cadre', 'POST', { status: 'open' })).json();
    assert.equal(opened.totalMembers, 4);

    assert.equal((await request(`/api/meetings/${id}/attendance`, 'u1', 'POST', { code: 'WRONG' })).status, 400);
    assert.equal((await request(`/api/meetings/${id}/attendance`, 'u1', 'POST', { code: 'drone1' })).status, 200);
    assert.equal((await request(`/api/meetings/${id}/attendance`, 'u1', 'POST', { code: 'drone1' })).status, 409);
    assert.equal((await request(`/api/meetings/${id}/attendance`, 'u5', 'POST', { code: 'DRONE1' })).status, 200);
    assert.equal((await request(`/api/meetings/${id}/attendance`, 'nobind', 'POST', { code: 'DRONE1' })).status, 400);
    assert.equal((await request(`/api/meetings/${id}/attendance`, 'u1', 'POST', { memberId: 'm3' })).status, 400);
    const afterOfficer = await (await request(`/api/meetings/${id}/attendance`, 'cadre', 'POST', { memberId: 'm2' })).json();
    assert.equal(afterOfficer.attendanceCount, 3);
    assert.equal(afterOfficer.counted, 2);

    // Major resolution: 2/3 of 4 = 3 must attend. With 2 counted it cannot pass.
    assert.equal((await request(`/api/meetings/${id}/agenda/${created.agenda[0].id}/vote`, 'cadre', 'POST', { action: 'open' })).status, 400);
    assert.equal((await request(`/api/meetings/${id}/agenda/${motionId}/vote`, 'u1', 'POST', { action: 'open' })).status, 403);
    assert.equal((await request(`/api/meetings/${id}/agenda/${motionId}/vote`, 'cadre', 'POST', { action: 'open' })).status, 200);
    assert.equal((await request(`/api/meetings/${id}/agenda/${motionId}/ballot`, 'u1', 'POST', { choice: 'agree' })).status, 200);
    assert.equal((await request(`/api/meetings/${id}/agenda/${motionId}/ballot`, 'u1', 'POST', { choice: 'oppose' })).status, 409);
    assert.equal((await request(`/api/meetings/${id}/agenda/${motionId}/ballot`, 'u5', 'POST', { choice: 'agree' })).status, 403);
    assert.equal((await request(`/api/meetings/${id}/agenda/${motionId}/ballot`, 'u3', 'POST', { choice: 'agree' })).status, 403);
    const live = await (await request(`/api/meetings/${id}`, 'u2')).json();
    assert.equal(live.agenda[1].vote.agree, undefined);
    assert.equal(live.agenda[1].vote.ballots, 1);
    assert.equal((await request(`/api/meetings/${id}/status`, 'cadre', 'POST', { status: 'closed' })).status, 400);
    const closedVote = await (await request(`/api/meetings/${id}/agenda/${motionId}/vote`, 'cadre', 'POST', { action: 'close' })).json();
    assert.equal(closedVote.agenda[1].vote.result.passed, false);
    assert.match(closedVote.agenda[1].vote.result.reason, /未達法定 3 人/);

    // Officer records the hall count instead; m3 checks in so 3 voters are present.
    assert.equal((await request(`/api/meetings/${id}/attendance`, 'u3', 'POST', { code: 'DRONE1' })).status, 200);
    assert.equal((await request(`/api/meetings/${id}/agenda/${motionId}/vote`, 'cadre', 'POST', { action: 'manual', agree: 3, oppose: 1, abstain: 0 })).status, 400);
    const manual = await (await request(`/api/meetings/${id}/agenda/${motionId}/vote`, 'cadre', 'POST', { action: 'manual', agree: 2, oppose: 1, abstain: 0 })).json();
    assert.equal(manual.agenda[1].vote.result.passed, true);
    assert.equal((await request(`/api/meetings/${id}/agenda/${motionId}/notes`, 'cadre', 'POST', { notes: '社員一贊成；擔心新生負擔', resolution: '照案通過，下學期起實施。' })).status, 200);

    // Minutes: AI receives the recorded facts and the officer finalizes after closing.
    let minutesPrompt;
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        minutesPrompt = JSON.parse(init.body).messages[1].content;
        return Response.json({ choices: [{ message: { content: JSON.stringify({ content: '# 會議紀錄\n決議：照案通過', notes: '' }) } }] });
    });
    assert.equal((await request(`/api/meetings/${id}/ai-minutes`, 'u1', 'POST', {})).status, 403);
    const minutes = await (await request(`/api/meetings/${id}/ai-minutes`, 'cadre', 'POST', {})).json();
    assert.match(minutes.content, /會議紀錄/);
    assert.match(minutesPrompt, /擔心新生負擔/);
    assert.match(minutesPrompt, /同意 2 票/);
    assert.equal((await request(`/api/meetings/${id}/minutes`, 'cadre', 'PUT', { content: minutes.content, finalize: true })).status, 400);
    assert.equal((await request(`/api/meetings/${id}/status`, 'cadre', 'POST', { status: 'closed' })).status, 200);
    assert.equal((await (await request(`/api/meetings/${id}`, 'u1')).json()).minutes.content, '');
    assert.equal((await request(`/admin/meetings/${id}/minutes`, 'u1')).status, 404);
    assert.equal((await request(`/api/meetings/${id}/minutes`, 'cadre', 'PUT', { content: minutes.content, finalize: true })).status, 200);
    assert.equal((await request(`/api/meetings/${id}/minutes`, 'cadre', 'PUT', { content: 'changed' })).status, 400);
    assert.equal((await request(`/api/meetings/${id}/agenda/${motionId}/notes`, 'cadre', 'POST', { notes: 'x' })).status, 400);
    const finalView = await (await request(`/api/meetings/${id}`, 'u1')).json();
    assert.match(finalView.minutes.content, /照案通過/);
    const page = await request(`/admin/meetings/${id}/minutes`, 'u1');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<h1>會議紀錄<\/h1>/);
    assert.equal((await request(`/api/meetings/${id}/minutes`, 'cadre', 'PUT', { unfinalize: true })).status, 403);
    assert.equal((await request(`/api/meetings/${id}/minutes`, 'president', 'PUT', { unfinalize: true })).status, 200);
    assert.equal((await request(`/api/meetings/${id}`, 'cadre', 'DELETE')).status, 409);
});

test('officers meetings: attendance is recorded by the chair and AI writes the notice', async (t) => {
    const { request } = fixture({ GROQ_API_KEY: 'gsk' });
    const meeting = await (await request('/api/meetings', 'cadre', 'POST', { type: 'officers', title: '幹部會議', date: '2026-12-02', keywords: '成果展分工', agenda: [{ title: '成果展分工' }] })).json();
    assert.equal(meeting.agenda[0].threshold, 'majority');
    t.mock.method(globalThis, 'fetch', async () => Response.json({ choices: [{ message: { content: JSON.stringify({ title: '幹部會議通知', content: '請準時出席' }) } }] }));
    const notice = await (await request(`/api/meetings/${meeting.id}/ai-notice`, 'cadre', 'POST', { keywords: '帶筆電' })).json();
    assert.deepEqual(notice, { title: '幹部會議通知', content: '請準時出席' });
    await request(`/api/meetings/${meeting.id}/status`, 'cadre', 'POST', { status: 'announced' });
    const opened = await (await request(`/api/meetings/${meeting.id}/status`, 'cadre', 'POST', { status: 'open' })).json();
    assert.equal(opened.totalMembers, 1);
    assert.equal((await request(`/api/meetings/${meeting.id}/attendance`, 'u1', 'POST', {})).status, 400);
    assert.equal((await request(`/api/meetings/${meeting.id}/attendance`, 'cadre', 'POST', { memberId: 'm4' })).status, 200);
    // A 臨時動議 can be added during the meeting; voted items cannot be dropped.
    const withMotion = await (await request(`/api/meetings/${meeting.id}`, 'cadre', 'PATCH', { agenda: [...opened.agenda, { kind: 'motion', title: '聚餐' }] })).json();
    assert.equal(withMotion.agenda.length, 2);
    assert.equal(withMotion.date, '2026-12-02');
    await request(`/api/meetings/${meeting.id}/agenda/${withMotion.agenda[0].id}/vote`, 'cadre', 'POST', { action: 'manual', agree: 1, oppose: 0, abstain: 0 });
    assert.equal((await request(`/api/meetings/${meeting.id}`, 'cadre', 'PATCH', { agenda: [withMotion.agenda[1]] })).status, 400);
});

test('meeting input is validated', async () => {
    const { request } = fixture();
    assert.equal((await request('/api/meetings', 'cadre', 'POST', { title: '', date: '2026-12-01' })).status, 400);
    assert.equal((await request('/api/meetings', 'cadre', 'POST', { title: 'a', date: 'tomorrow' })).status, 400);
    assert.equal((await request('/api/meetings', 'cadre', 'POST', { title: 'a', date: '2026-12-01', onlineUrl: 'javascript:alert(1)' })).status, 400);
    assert.equal((await request('/api/meetings', 'cadre', 'POST', { title: 'a', date: '2026-12-01', checkInCode: '中文' })).status, 400);
    assert.equal((await request('/api/meetings', null)).status, 401);
    assert.equal((await request('/api/meetings/nope', 'cadre')).status, 404);
});

// Public 學號＋姓名 page: one browser (cookie) per member, optional IP limits.
function guestClient(env, ip = '140.124.10.20') {
    let jar = '';
    return {
        setIp(value) { ip = value; },
        async call(path, body) {
            const response = await worker.fetch(new Request(`https://example.com${path}`, {
                method: body ? 'POST' : 'GET',
                headers: { 'CF-Connecting-IP': ip, ...(jar ? { Cookie: jar } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
                ...(body ? { body: JSON.stringify(body) } : {})
            }), env);
            const set = response.headers.get('Set-Cookie');
            if (set) jar = set.split(';')[0];
            return response;
        },
        get cookie() { return jar; }
    };
}

async function openAssembly(request, fields = {}) {
    const meeting = await (await request('/api/meetings', 'cadre', 'POST', { type: 'assembly', title: '期初大會', date: '2026-09-15', agenda: [{ title: '預算案' }], ...fields })).json();
    await request(`/api/meetings/${meeting.id}/status`, 'cadre', 'POST', { status: 'announced' });
    return (await request(`/api/meetings/${meeting.id}/status`, 'cadre', 'POST', { status: 'open' })).json();
}

test('members without accounts check in with 學號＋姓名 and vote from one device', async () => {
    const { request, store, env } = fixture();
    store.set('members:list', JSON.stringify(roster.map((member, index) => ({ ...member, studentId: `B1100000${index + 1}` }))));
    const meeting = await openAssembly(request, { checkInCode: 'FLY123' });
    assert.equal(meeting.guestAccess, true);
    const page = await worker.fetch(new Request(`https://example.com/meeting/${meeting.id}`), env);
    assert.match(await page.text(), /meeting\.js/);

    const phone = guestClient(env);
    const view = await (await phone.call(`/api/public/meetings/${meeting.id}`)).json();
    assert.equal(view.me, null);
    assert.equal(view.requiresCode, true);
    assert.equal(JSON.stringify(view).includes('FLY123'), false);
    assert.equal((await phone.call(`/api/public/meetings/${meeting.id}/checkin`, { studentId: 'b11000001', name: '社員一', code: 'nope' })).status, 400);
    assert.equal((await phone.call(`/api/public/meetings/${meeting.id}/checkin`, { studentId: 'b11000001', name: '別人', code: 'FLY123' })).status, 400);
    const checked = await phone.call(`/api/public/meetings/${meeting.id}/checkin`, { studentId: ' b11000001 ', name: '社 員一', code: 'fly123' });
    assert.equal(checked.status, 200);
    assert.match(phone.cookie, /^mtg_/);
    assert.deepEqual((await checked.json()).me, { name: '社員一', voting: true, canVote: true });
    // Signing in again on the same phone is fine; the same phone cannot sign for someone else.
    assert.equal((await phone.call(`/api/public/meetings/${meeting.id}/checkin`, { studentId: 'B11000001', name: '社員一', code: 'FLY123' })).status, 200);
    assert.equal((await phone.call(`/api/public/meetings/${meeting.id}/checkin`, { studentId: 'B11000002', name: '社員二', code: 'FLY123' })).status, 409);
    // Another phone cannot take over a member who already checked in.
    const other = guestClient(env, '140.124.10.21');
    assert.equal((await other.call(`/api/public/meetings/${meeting.id}/checkin`, { studentId: 'B11000001', name: '社員一', code: 'FLY123' })).status, 409);

    const itemId = meeting.agenda[0].id;
    assert.equal((await phone.call(`/api/public/meetings/${meeting.id}/ballot`, { itemId, choice: 'agree' })).status, 400);
    await request(`/api/meetings/${meeting.id}/agenda/${itemId}/vote`, 'cadre', 'POST', { action: 'open' });
    assert.equal((await other.call(`/api/public/meetings/${meeting.id}/ballot`, { itemId, choice: 'agree' })).status, 403);
    const voted = await (await phone.call(`/api/public/meetings/${meeting.id}/ballot`, { itemId, choice: 'agree' })).json();
    assert.equal(voted.agenda[0].voted, true);
    assert.equal(voted.agenda[0].vote.agree, undefined);
    assert.equal((await phone.call(`/api/public/meetings/${meeting.id}/ballot`, { itemId, choice: 'oppose' })).status, 409);
    // A forged cookie gets nothing.
    const forged = guestClient(env);
    await forged.call(`/api/public/meetings/${meeting.id}`);
    assert.equal((await worker.fetch(new Request(`https://example.com/api/public/meetings/${meeting.id}/ballot`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `mtg_${meeting.id.replace(/-/g, '').slice(0, 24)}=${'a'.repeat(64)}` }, body: JSON.stringify({ itemId, choice: 'agree' }) }), env)).status, 403);

    // Officers see how each person checked in; removing the entry frees the member to re-check-in elsewhere.
    const officerView = await (await request(`/api/meetings/${meeting.id}`, 'cadre')).json();
    assert.deepEqual(officerView.attendance.map(a => [a.by, a.ip]), [['guest', '140.124.10.20']]);
    assert.equal(officerView.guests, undefined);
    await request(`/api/meetings/${meeting.id}/agenda/${itemId}/vote`, 'cadre', 'POST', { action: 'close' });
    await request(`/api/meetings/${meeting.id}/attendance`, 'cadre', 'POST', { memberId: 'm1', remove: true });
    assert.equal((await other.call(`/api/public/meetings/${meeting.id}/checkin`, { studentId: 'B11000001', name: '社員一', code: 'FLY123' })).status, 200);
});

test('guest check-in can be limited to the venue network and per IP', async () => {
    const { request, store, env } = fixture();
    store.set('members:list', JSON.stringify(roster.map((member, index) => ({ ...member, studentId: `B1100000${index + 1}` }))));
    assert.equal((await request('/api/meetings', 'cadre', 'POST', { title: 'x', date: '2026-09-15', allowedIps: '999.1.1.1' })).status, 400);
    const meeting = await openAssembly(request, { allowedIps: '140.124.0.0/16\n2001:db8::/32', maxPerIp: 1 });
    const outside = guestClient(env, '8.8.8.8');
    assert.equal((await outside.call(`/api/public/meetings/${meeting.id}/checkin`, { studentId: 'B11000001', name: '社員一' })).status, 403);
    const first = guestClient(env, '140.124.1.1');
    assert.equal((await first.call(`/api/public/meetings/${meeting.id}/checkin`, { studentId: 'B11000001', name: '社員一' })).status, 200);
    const second = guestClient(env, '140.124.1.1');
    assert.equal((await second.call(`/api/public/meetings/${meeting.id}/checkin`, { studentId: 'B11000002', name: '社員二' })).status, 429);
    const v6 = guestClient(env, '2001:db8:5::9');
    assert.equal((await v6.call(`/api/public/meetings/${meeting.id}/checkin`, { studentId: 'B11000002', name: '社員二' })).status, 200);
    // Leaving the network blocks voting too.
    first.setIp('8.8.4.4');
    await request(`/api/meetings/${meeting.id}/agenda/${meeting.agenda[0].id}/vote`, 'cadre', 'POST', { action: 'open' });
    assert.equal((await first.call(`/api/public/meetings/${meeting.id}/ballot`, { itemId: meeting.agenda[0].id, choice: 'agree' })).status, 403);
    // Guessing student IDs is rate limited per IP.
    const guesser = guestClient(env, '140.124.9.9');
    let last;
    for (let i = 0; i < 31; i++) last = await guesser.call(`/api/public/meetings/${meeting.id}/checkin`, { studentId: `X${i}`, name: '猜' });
    assert.equal(last.status, 429);
});

test('guest access can be turned off per meeting, and drafts are never public', async () => {
    const { request, env } = fixture();
    const draft = await (await request('/api/meetings', 'cadre', 'POST', { title: '草稿', date: '2026-09-15' })).json();
    assert.equal((await guestClient(env).call(`/api/public/meetings/${draft.id}`)).status, 404);
    const closedDoor = await openAssembly(request, { guestAccess: false });
    assert.equal((await guestClient(env).call(`/api/public/meetings/${closedDoor.id}`)).status, 404);
    const officers = await (await request('/api/meetings', 'cadre', 'POST', { type: 'officers', title: '幹部會議', date: '2026-09-15' })).json();
    assert.equal(officers.guestAccess, false);
});

test('the president can close member-account login without affecting officers', async () => {
    const { request, env } = fixture();
    assert.equal((await request('/api/site-settings', 'u1')).status, 200);
    assert.equal((await request('/api/site-settings', 'cadre', 'PUT', { memberLogin: false })).status, 403);
    assert.deepEqual(await (await request('/api/site-settings', 'president', 'PUT', { memberLogin: false })).json(), { memberLogin: false });
    // Existing member sessions stop working; officers keep theirs.
    assert.equal((await request('/api/meetings', 'u1')).status, 401);
    assert.equal((await request('/api/meetings', 'cadre')).status, 200);
    assert.equal((await request('/api/site-settings', 'president', 'PUT', { memberLogin: true })).status, 200);
    assert.equal((await request('/api/meetings', 'u1')).status, 200);
    assert.ok(env);
});

test('login refuses member accounts while member login is closed', async () => {
    const { passwordHash } = await import('../src/auth.js');
    const { store, env } = fixture();
    const hash = await passwordHash('password123');
    for (const [username, role] of [['alice', 'member'], ['bob', 'cadre']]) store.set(`user:${username}`, JSON.stringify({ username, role, active: true, version: 'v1', passwordHash: hash }));
    store.set('site:settings', JSON.stringify({ memberLogin: false }));
    const login = async username => {
        const form = new FormData();
        form.set('username', username); form.set('password', 'password123');
        const { captchaId, captcha } = env.SITE_STORE.issueCaptcha();
        form.set('captcha_id', captchaId); form.set('captcha', captcha);
        return worker.fetch(new Request('https://example.com/api/login', { method: 'POST', body: form, headers: { 'CF-Connecting-IP': '198.51.100.1' } }), env);
    };
    const refused = await login('alice');
    assert.equal(refused.status, 403);
    assert.match(await refused.text(), /未開放社員帳號登入/);
    assert.equal((await login('bob')).status, 302);
});
