import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { ElectionStore, auditFlags, ballotOptions, votingOpen } from '../src/election-store.js';
import { buildRoll, normalizeElectionInput, ElectionValidationError } from '../src/elections.js';
import { renderAdminDashboard } from '../src/templates.js';
import { withSiteStore } from './helpers/site-store.js';

function createMockElectionStore() {
    const values = new Map();
    let tail = Promise.resolve();
    const storage = {
        async get(key) { return structuredClone(values.get(key)); },
        async put(key, value) { values.set(key, structuredClone(value)); },
        async delete(keys) { for (const key of [].concat(keys)) values.delete(key); },
        async list({ prefix = '' } = {}) { return new Map([...values.entries()].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b))); },
        transaction(callback) { const result = tail.then(() => callback(storage)); tail = result.catch(() => {}); return result; }
    };
    const object = new ElectionStore({ storage });
    return { idFromName: name => name, get: () => ({ fetch: (input, init) => object.fetch(new Request(input, init)) }), values };
}

const PAID = { level: 'member', feeStatus: 'lifetime' };
const MEMBERS = [
    { id: 'm1', name: '王小明', studentId: 'B11100001', ...PAID },
    { id: 'm2', name: '陳 小 華', studentId: 'b11100002', ...PAID },
    { id: 'm3', name: '林未繳', studentId: 'B11100003', level: 'member', feeStatus: 'unpaid' },
    { id: 'm4', name: '張幹部', studentId: 'B11100004', level: 'officer', feeStatus: 'unpaid' },
    { id: 'm5', name: '李同學', studentId: 'B11100005', ...PAID }
];

function fixture() {
    const store = new Map();
    const db = {
        async get(key) { return store.get(key) ?? null; },
        async put(key, value) { store.set(key, typeof value === 'string' ? value : JSON.stringify(value)); },
        async delete(key) { store.delete(key); },
        async list({ prefix }) { return { keys: [...store.keys()].filter(name => name.startsWith(prefix)).map(name => ({ name })) }; }
    };
    for (const role of ['president', 'cadre', 'finance', 'member']) {
        store.set(`user:${role}`, JSON.stringify({ username: role, role, active: true, version: 'v1' }));
        store.set(`session:${role}`, JSON.stringify({ username: role, version: 'v1' }));
    }
    store.set('members:list', JSON.stringify(MEMBERS));
    const electionStore = createMockElectionStore();
    const env = withSiteStore({ DRONE_DB: db, ELECTION_STORE: electionStore });
    const request = (path, { who, method = 'GET', body, ip = '203.0.113.7', device = 'a'.repeat(32), ua = 'TestBrowser/1.0' } = {}) => {
        const cookies = [who ? `session=${who}` : '', device ? `vote_device=${device}` : ''].filter(Boolean).join('; ');
        return worker.fetch(new Request(`https://example.com${path}`, {
            method,
            headers: { 'CF-Connecting-IP': ip, 'User-Agent': ua, ...(cookies ? { Cookie: cookies } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) })
        }), env);
    };
    const device = { fingerprint: 'f'.repeat(32), screen: '390x844@3', timezone: 'Asia/Taipei', platform: 'iOS', touch: 5 };
    const verify = (id, studentId, name, options = {}) => request(`/api/vote/${id}/verify`, {
        method: 'POST', ...options, body: { studentId, name, ...env.SITE_STORE.issueCaptcha(), device }
    });
    const cast = (id, token, choice, options = {}) => request(`/api/vote/${id}/cast`, { method: 'POST', ...options, body: { token, choice, device } });
    return { store, env, electionStore, request, verify, cast };
}

const ELECTION = {
    title: '第 116 學年度社長選舉', position: '社長', description: '請踴躍投票',
    candidates: [
        { number: 1, name: '甲候選人', department: '機械三', slogan: '安全飛行', platform: '<script>alert(1)</script>\n擴充器材', experience: '器材長' },
        { number: 2, name: '乙候選人', platform: '更多社課' }
    ]
};

async function openElection(f, body = ELECTION) {
    const created = await f.request('/api/elections', { who: 'cadre', method: 'POST', body });
    assert.equal(created.status, 201);
    const election = await created.json();
    assert.equal((await f.request(`/api/elections/${election.id}/status`, { who: 'cadre', method: 'POST', body: { action: 'publish' } })).status, 200);
    const opened = await f.request(`/api/elections/${election.id}/status`, { who: 'president', method: 'POST', body: { action: 'open' } });
    assert.equal(opened.status, 200);
    return await opened.json();
}

test('roll only includes members with voting rights, matched on normalized ID and name', () => {
    const roll = buildRoll(MEMBERS, 'voting', new Date('2026-11-18T00:00:00Z'));
    assert.deepEqual(roll.map(entry => entry.studentId), ['B11100001', 'B11100002', 'B11100004', 'B11100005']);
    assert.equal(roll[1].name, '陳小華');
    assert.equal(buildRoll(MEMBERS, 'roster').length, 5);
});

test('election input is validated', () => {
    assert.throws(() => normalizeElectionInput({ title: '' }), ElectionValidationError);
    assert.throws(() => normalizeElectionInput({ title: 'x', candidates: [{ number: 1, name: 'a' }, { number: 1, name: 'b' }] }), /重複/);
    assert.throws(() => normalizeElectionInput({ title: 'x', candidates: [{ name: 'a', photoUrl: 'javascript:alert(1)' }] }), /https/);
    assert.throws(() => normalizeElectionInput({ title: 'x', startsAt: '2026-12-02T09:00', endsAt: '2026-12-01T09:00' }), /晚於/);
    const fields = normalizeElectionInput({ title: 'x', startsAt: '2026-12-01T09:00', candidates: [{ name: 'a' }] });
    assert.equal(fields.startsAt, '2026-12-01T01:00:00.000Z');
    assert.equal(fields.oneVotePerDevice, true);
    assert.deepEqual(ballotOptions({ candidates: [{ id: 'c', number: 1, name: '甲' }] }).map(option => option.id), ['approve', 'reject']);
    assert.equal(votingOpen({ status: 'open', endsAt: '2000-01-01T00:00:00Z' }), false);
});

test('one person one vote with secret ballots kept apart from the voter log', async () => {
    const f = fixture();
    const election = await openElection(f);
    assert.equal(election.rollSize, 4);
    const [first, second] = election.candidates;

    // Not a member / name mismatch / no voting right.
    assert.equal((await f.verify(election.id, 'B19999999', '路人')).status, 403);
    assert.equal((await f.verify(election.id, 'B11100001', '王大明')).status, 403);
    assert.equal((await f.verify(election.id, 'B11100003', '林未繳')).status, 403);

    const ok = await f.verify(election.id, 'b11100002', '陳小華', { ip: '198.51.100.1', device: 'b'.repeat(32) });
    assert.equal(ok.status, 200);
    const { token, options } = await ok.json();
    assert.deepEqual(options.map(option => option.id), [first.id, second.id]);

    // Results stay sealed while voting is open.
    assert.equal((await f.request(`/api/elections/${election.id}/results`, { who: 'president' })).status, 409);
    // The token is bound to the device that verified.
    assert.equal((await f.cast(election.id, token, first.id, { device: 'c'.repeat(32) })).status, 401);
    assert.equal((await f.cast(election.id, token, 'bogus', { device: 'b'.repeat(32) })).status, 400);
    assert.equal((await f.cast(election.id, token, first.id, { device: 'b'.repeat(32) })).status, 201);
    // Token is single use, and the student ID cannot vote again.
    assert.equal((await f.cast(election.id, token, second.id, { device: 'b'.repeat(32) })).status, 401);
    assert.equal((await f.verify(election.id, 'B11100002', '陳小華', { device: 'd'.repeat(32) })).status, 409);

    const t2 = await (await f.verify(election.id, 'B11100001', '王小明', { device: 'e'.repeat(32) })).json();
    assert.equal((await f.cast(election.id, t2.token, second.id, { device: 'e'.repeat(32) })).status, 201);
    const t3 = await (await f.verify(election.id, 'B11100004', '張幹部', { device: '1'.repeat(32) })).json();
    assert.equal((await f.cast(election.id, t3.token, second.id, { device: '1'.repeat(32) })).status, 201);

    // Storage: ballots only hold the choice; voter records never hold it.
    const ballots = [...f.electionStore.values].filter(([key]) => key.startsWith(`ballot:${election.id}:`)).map(([, value]) => value);
    assert.equal(ballots.length, 3);
    for (const ballot of ballots) assert.deepEqual(Object.keys(ballot), ['choice']);
    const voters = [...f.electionStore.values].filter(([key]) => key.startsWith(`voter:${election.id}:`)).map(([, value]) => value);
    assert.equal(voters.length, 3);
    for (const voter of voters) {
        assert.equal(JSON.stringify(voter).includes(first.id) || JSON.stringify(voter).includes(second.id), false);
        assert.ok(voter.ip && voter.userAgent && voter.deviceId && voter.fingerprint && voter.votedAt);
    }
    const audit = await (await f.request(`/api/elections/${election.id}/audit`, { who: 'cadre' })).json();
    assert.equal(audit.voters.length, 3);
    assert.equal(JSON.stringify([audit.voters, audit.events]).includes(first.id), false);
    assert.ok(audit.events.some(event => event.type === 'verify-failed'));

    // Only the president closes voting and publishes results.
    assert.equal((await f.request(`/api/elections/${election.id}/status`, { who: 'cadre', method: 'POST', body: { action: 'close' } })).status, 403);
    assert.equal((await f.request(`/api/elections/${election.id}/status`, { who: 'president', method: 'POST', body: { action: 'close' } })).status, 200);
    const results = await (await f.request(`/api/elections/${election.id}/results`, { who: 'president' })).json();
    assert.deepEqual(results.options.map(option => option.votes), [1, 2]);
    assert.equal(results.totalBallots, 3);
    assert.equal(results.rollSize, 4);

    let page = await (await f.request(`/vote/${election.id}`)).text();
    assert.ok(!page.includes('開票結果'));
    await f.request(`/api/elections/${election.id}/status`, { who: 'president', method: 'POST', body: { action: 'publish-results' } });
    page = await (await f.request(`/vote/${election.id}`)).text();
    assert.ok(page.includes('開票結果'));
    assert.ok(page.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!page.includes('<script>alert(1)</script>'));
});

test('one device cannot cast ballots for several members', async () => {
    const f = fixture();
    const election = await openElection(f);
    const device = { device: '9'.repeat(32) };
    const a = await (await f.verify(election.id, 'B11100001', '王小明', device)).json();
    // Two people verify on the same device before either votes: only the first ballot counts.
    const b = await (await f.verify(election.id, 'B11100005', '李同學', device)).json();
    assert.equal((await f.cast(election.id, a.token, election.candidates[0].id, device)).status, 201);
    assert.equal((await f.cast(election.id, b.token, election.candidates[0].id, device)).status, 409);
    assert.equal((await f.verify(election.id, 'B11100005', '李同學', device)).status, 409);
    const audit = await (await f.request(`/api/elections/${election.id}/audit`, { who: 'president' })).json();
    assert.ok(audit.flags.some(flag => flag.kind === 'device-multi-verify'));
});

test('concurrent casts with one token record a single ballot', async () => {
    const f = fixture();
    const election = await openElection(f);
    const { token } = await (await f.verify(election.id, 'B11100001', '王小明')).json();
    const statuses = (await Promise.all(Array.from({ length: 5 }, () => f.cast(election.id, token, election.candidates[1].id)))).map(response => response.status);
    assert.equal(statuses.filter(status => status === 201).length, 1);
    assert.equal([...f.electionStore.values.keys()].filter(key => key.startsWith('ballot:')).length, 1);
});

test('the electoral roll is frozen and the election locked once voting opens', async () => {
    const f = fixture();
    const election = await openElection(f);
    const members = JSON.parse(f.store.get('members:list'));
    members.push({ id: 'm9', name: '後加入', studentId: 'B11100009', ...PAID });
    f.store.set('members:list', JSON.stringify(members));
    assert.equal((await f.verify(election.id, 'B11100009', '後加入')).status, 403);
    assert.equal((await f.request(`/api/elections/${election.id}`, { who: 'cadre', method: 'PUT', body: ELECTION })).status, 409);
    assert.equal((await f.request(`/api/elections/${election.id}`, { who: 'cadre', method: 'DELETE' })).status, 409);
});

test('access control, drafts and device cookie requirements', async () => {
    const f = fixture();
    assert.equal((await f.request('/api/elections')).status, 401);
    assert.equal((await f.request('/api/elections', { who: 'member' })).status, 403);
    assert.equal((await f.request('/api/elections', { who: 'finance' })).status, 403);
    const draft = await (await f.request('/api/elections', { who: 'cadre', method: 'POST', body: ELECTION })).json();
    assert.equal((await f.request(`/vote/${draft.id}`)).status, 404);
    assert.ok(!(await (await f.request('/vote')).text()).includes(ELECTION.title));
    assert.equal((await f.request(`/api/elections/${draft.id}/status`, { who: 'cadre', method: 'POST', body: { action: 'open' } })).status, 403);
    assert.equal((await f.verify(draft.id, 'B11100001', '王小明')).status, 409);

    const election = await openElection(f);
    const page = await f.request(`/vote/${election.id}`, { device: '' });
    assert.match(page.headers.get('Set-Cookie') || '', /vote_device=[a-f0-9]{32}; .*HttpOnly/);
    assert.ok((await page.text()).includes('ev-verify-form'));
    assert.equal((await f.verify(election.id, 'B11100001', '王小明', { device: '' })).status, 400);
    // A wrong CAPTCHA is rejected before the roll is checked.
    const bad = await f.request(`/api/vote/${election.id}/verify`, { method: 'POST', body: { studentId: 'B11100001', name: '王小明', captchaId: 'x', captcha: 'nope' } });
    assert.equal(bad.status, 400);
});

test('repeated failed verifications are rate limited per student ID', async () => {
    const f = fixture();
    const election = await openElection(f);
    const statuses = [];
    for (let i = 0; i < 8; i++) statuses.push((await f.verify(election.id, 'B11100001', `猜錯${i}`)).status);
    assert.deepEqual(statuses.slice(0, 6), [403, 403, 403, 403, 403, 403]);
    assert.equal(statuses[7], 429);
});

test('audit flags shared devices and guessing', () => {
    const voters = [
        { studentId: 'A1', ip: '1.1.1.1', deviceId: 'd1' }, { studentId: 'A2', ip: '1.1.1.1', deviceId: 'd1' }, { studentId: 'A3', ip: '1.1.1.1', deviceId: 'd2' }
    ];
    const events = Array.from({ length: 5 }, (_, i) => ({ type: 'verify-failed', ip: '2.2.2.2', studentId: `X${i}` }));
    const kinds = auditFlags(voters, events).map(flag => flag.kind).sort();
    assert.deepEqual(kinds, ['failed-verify', 'shared-device', 'shared-ip']);
});

test('admin dashboard shows the elections panel only to officers who run elections', () => {
    assert.ok(renderAdminDashboard([], [], { username: 'p', role: 'president' }).includes('panel-elections'));
    assert.ok(renderAdminDashboard([], [], { username: 'c', role: 'cadre' }).includes('admin-elections.js'));
    assert.ok(!renderAdminDashboard([], [], { username: 'm', role: 'member' }).includes('panel-elections'));
});
