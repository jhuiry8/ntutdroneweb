import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { semesterOf, membershipStatus, receiptFeeType, parseMemberLevel, parseFeeStatus } from '../src/membership.js';
import { DEFAULT_REGULATIONS } from '../src/regulations.js';

function fixture() {
    const store = new Map();
    const db = {
        async get(key) { return store.get(key) ?? null; },
        async put(key, value) { store.set(key, typeof value === 'string' ? value : JSON.stringify(value)); },
        async delete(key) { store.delete(key); },
        async list({ prefix }) { return { keys: [...store.keys()].filter(name => name.startsWith(prefix)).map(name => ({ name })) }; },
        store
    };
    for (const role of ['president', 'finance', 'cadre', 'member']) {
        store.set(`user:${role}`, JSON.stringify({ username: role, role, active: true, version: 'v1' }));
        store.set(`session:${role}`, JSON.stringify({ username: role, version: 'v1' }));
    }
    const request = (path, role, method = 'GET', body) => worker.fetch(new Request(`https://example.com${path}`, {
        method,
        headers: { ...(role ? { Cookie: `session=${role}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }), { DRONE_DB: db });
    return { store, request };
}

test('academic terms follow the August and February start dates', () => {
    assert.equal(semesterOf('2026-08-01'), '115-1');
    assert.equal(semesterOf('2026-11-15'), '115-1');
    assert.equal(semesterOf('2027-01-20'), '115-1');
    assert.equal(semesterOf('2027-02-01'), '115-2');
    assert.equal(semesterOf('2027-07-31'), '115-2');
});

test('membership status follows the four-level and fee rules', () => {
    const today = new Date('2026-11-15T00:00:00Z');
    const unpaid = membershipStatus({ level: 'member', feeStatus: 'unpaid' }, today);
    assert.equal(unpaid.unpaid, true);
    assert.equal(unpaid.voting, false);
    const current = membershipStatus({ level: 'member', feeStatus: 'semester', feeSemester: '115-1' }, today);
    assert.equal(current.paid, true);
    assert.equal(current.voting, true);
    const expired = membershipStatus({ level: 'member', feeStatus: 'semester', feeSemester: '114-2' }, today);
    assert.equal(expired.paid, false);
    assert.match(expired.feeLabel, /114-2 已到期/);
    assert.equal(membershipStatus({ level: 'member', feeStatus: 'lifetime' }, today).voting, true);
    const prep = membershipStatus({ level: 'prep', feeStatus: 'unpaid' }, today);
    assert.equal(prep.exempt, true);
    assert.equal(prep.unpaid, false);
    assert.equal(prep.voting, false, 'unpaid prep officers have no vote');
    assert.equal(membershipStatus({ level: 'officer', feeStatus: 'unpaid' }, today).voting, true, 'officers count as formal members');
    const trial = membershipStatus({ level: 'trial', trialUses: 1 }, today);
    assert.equal(trial.voting, false);
    assert.equal(trial.trialRemaining, 1);
    assert.equal(membershipStatus({}, today).level, 'member', 'legacy roster entries default to formal members');
    assert.equal(receiptFeeType('', 500), 'semester');
    assert.equal(receiptFeeType('', 1000), 'lifetime');
    assert.equal(receiptFeeType('', 300), 'other');
    assert.equal(receiptFeeType('semester', 1000), 'semester');
    assert.equal(parseMemberLevel('PREP_OFFICER'), 'prep');
    assert.equal(parseMemberLevel('非正式社員/體驗學員'), 'trial');
    assert.equal(parseFeeStatus('LIFETIME_PAID'), 'lifetime');
    assert.equal(parseFeeStatus('學期會籍（500 元）'), 'semester');
    assert.equal(parseFeeStatus('不知道'), null);
});

test('officers add unpaid members, filter them, and receipts mark them paid', async () => {
    const { request } = fixture();
    const created = await request('/api/members', 'finance', 'POST', { name: '新社員', studentId: '113590001' });
    assert.equal(created.status, 201);
    const member = await created.json();
    assert.equal(member.level, 'member');
    assert.equal(member.feeStatus, 'unpaid');
    assert.equal(member.status.unpaid, true);
    const trial = await (await request('/api/members', 'finance', 'POST', { name: '體驗生', level: 'trial', trialUses: 2 })).json();
    assert.equal(trial.status.trialRemaining, 0);
    assert.equal((await request('/api/members', 'finance', 'POST', { name: '錯誤', level: 'boss' })).status, 400);
    assert.equal((await request('/api/members', 'finance', 'POST', { name: '錯誤', feeStatus: 'semester', feeSemester: '2026' })).status, 400);

    let unpaid = await (await request('/api/members?filter=unpaid', 'finance')).json();
    assert.deepEqual(unpaid.map(item => item.name).sort(), ['新社員', '體驗生']);

    const today = new Date().toISOString().slice(0, 10);
    const receipt = await request('/api/member-fee-receipts', 'finance', 'POST', { studentId: '113590001', amount: 500, date: today, receiver: '總務' });
    assert.equal(receipt.status, 201);
    const record = await receipt.json();
    assert.equal(record.memberId, member.id, 'receipt is matched to the roster by student ID');
    assert.equal(record.feeType, 'semester');
    assert.equal(record.memberStatus.paid, true);
    await request('/api/member-fee-receipts', 'finance', 'POST', { memberId: trial.id, amount: 1000, date: today, receiver: '總務' });
    unpaid = await (await request('/api/members?filter=unpaid', 'finance')).json();
    assert.deepEqual(unpaid, []);
    const voting = await (await request('/api/members?filter=voting', 'finance')).json();
    assert.equal(voting.length, 2);
    assert.equal(voting.find(item => item.id === trial.id).level, 'member', 'paying promotes a trial member');
    assert.equal((await request('/api/member-fee-receipts', 'finance', 'POST', { memberId: 'missing', amount: 500, receiver: '總務' })).status, 404);

    const lifetime = voting.find(item => item.id === trial.id);
    await request('/api/member-fee-receipts', 'finance', 'POST', { memberId: trial.id, amount: 500, date: today, receiver: '總務' });
    const after = (await (await request('/api/members', 'finance')).json()).find(item => item.id === lifetime.id);
    assert.equal(after.feeStatus, 'lifetime', 'a semester payment never downgrades lifetime membership');
});

test('the president binds accounts to members and members see their own record', async () => {
    const { request, store } = fixture();
    const member = await (await request('/api/members', 'president', 'POST', { name: '社員甲', studentId: '113590002' })).json();
    assert.equal((await request('/api/users', 'finance', 'PATCH', { username: 'member', memberId: member.id })).status, 403);
    assert.equal((await request('/api/users', 'president', 'PATCH', { username: 'member', memberId: 'missing' })).status, 404);
    const bound = await request('/api/users', 'president', 'PATCH', { username: 'member', memberId: member.id });
    assert.equal(bound.status, 200);
    assert.equal((await bound.json()).memberId, member.id);
    assert.equal(JSON.parse(store.get('user:member')).version, 'v1', 'binding alone keeps the session');
    const conflict = await request('/api/users', 'president', 'PATCH', { username: 'cadre', memberId: member.id });
    assert.equal(conflict.status, 409);

    const created = await request('/api/users', 'president', 'POST', { username: 'second', password: 'password123', role: 'member', memberId: member.id });
    assert.equal(created.status, 409, 'a member can only be bound to one account');

    const users = await (await request('/api/users', 'president')).json();
    assert.equal(users.find(item => item.username === 'member').member.name, '社員甲');
    const roster = await (await request('/api/members', 'president')).json();
    assert.equal(roster[0].account, 'member');
    assert.equal((await (await request('/api/members?filter=unbound', 'president')).json()).length, 0);

    const me = await (await request('/api/me', 'member')).json();
    assert.equal(me.username, 'member');
    assert.equal(me.member.name, '社員甲');
    assert.equal(me.member.status.unpaid, true);
    assert.equal(me.member.note, undefined, 'officer notes are not shown to the member');
    const cadreMe = await (await request('/api/me', 'cadre')).json();
    assert.equal(cadreMe.member, null);
    assert.equal((await request('/api/me', null)).status, 401);

    assert.equal((await request(`/api/members/${member.id}`, 'president', 'DELETE')).status, 200);
    assert.equal(JSON.parse(store.get('user:member')).memberId, undefined, 'deleting the member releases the account');

    const unbind = await request('/api/users', 'president', 'PATCH', { username: 'member', memberId: '' });
    assert.equal(unbind.status, 200);
});

test('every account can look up regulations; only the president edits them', async () => {
    const { request } = fixture();
    const list = await (await request('/api/regulations', 'member')).json();
    assert.equal(list.length, DEFAULT_REGULATIONS.length);
    assert.ok(list.some(item => item.title === '無人機社社費細則' && item.content.includes('學期會籍制：每學期繳納新臺幣500元')));
    assert.ok(list.some(item => item.title === '國立臺北科技大學學生社團組織及活動實施辦法'));
    assert.equal((await request('/api/regulations', null)).status, 401);
    assert.equal((await request('/api/regulations', 'cadre', 'POST', { title: 'x', content: 'y' })).status, 403);
    const added = await request('/api/regulations', 'president', 'POST', { title: '器材借用辦法', content: '第一條 目的\n一、測試。' });
    assert.equal(added.status, 201);
    const regulation = await added.json();
    const edited = await request(`/api/regulations/${regulation.id}`, 'president', 'PATCH', { version: '115.10.01' });
    assert.equal((await edited.json()).version, '115.10.01');
    assert.equal((await request(`/api/regulations/${regulation.id}`, 'president', 'PATCH', { content: '' })).status, 400);
    assert.equal((await request('/api/regulations/charter', 'president', 'DELETE')).status, 200);
    const after = await (await request('/api/regulations', 'member')).json();
    assert.equal(after.length, DEFAULT_REGULATIONS.length);
    assert.ok(!after.some(item => item.id === 'charter'));
    assert.ok(after.some(item => item.title === '器材借用辦法'));
});
