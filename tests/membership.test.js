import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { semesterOf, previousSemester, nextSemester, membershipStatus, receiptFeeType, feePrices, parseMemberLevel, parseFeeStatus } from '../src/membership.js';
import { DEFAULT_REGULATIONS } from '../src/regulations.js';
import { assemblyThresholds, checkAssembly, checkProposalSource } from '../src/regulation-rules.js';

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

test('fee prices follow the promo schedule and amounts map to plans', () => {
    assert.deepEqual(feePrices('115-1'), { semester: 300, lifetime: 800, promo: true });
    assert.deepEqual(feePrices('115-2'), { semester: 500, lifetime: 1000, promo: false });
    assert.deepEqual(feePrices('116-1'), { semester: 300, lifetime: 800, promo: true });
    assert.equal(receiptFeeType('', 300), 'semester');
    assert.equal(receiptFeeType('', 500), 'semester');
    assert.equal(receiptFeeType('', 800), 'lifetime');
    assert.equal(receiptFeeType('', 1000), 'lifetime');
    assert.equal(receiptFeeType('', 200), 'other');
    assert.equal(receiptFeeType('semester', 800), 'semester', 'an explicit plan choice wins');
    assert.equal(parseFeeStatus('300'), 'semester');
    assert.equal(parseFeeStatus('800'), 'lifetime');
});

test('previous and next semester helpers cross academic years', () => {
    assert.equal(previousSemester('115-1'), '114-2');
    assert.equal(previousSemester('115-2'), '115-1');
    assert.equal(nextSemester('115-1'), '115-2');
    assert.equal(nextSemester('115-2'), '116-1');
    assert.equal(previousSemester('bad'), '');
});

test('one-year membership stays valid for the paid term and the next term', () => {
    const at = date => new Date(`${date}T00:00:00Z`);
    const paidIn = (feeSemester, date) => membershipStatus({ level: 'member', feeStatus: 'semester', feeSemester }, at(date));
    // paid 115-1: valid in 115-1 and 115-2, expired in 116-1
    assert.equal(paidIn('115-1', '2026-11-15').paid, true);
    const second = paidIn('115-1', '2027-03-01');
    assert.equal(second.paid, true);
    assert.equal(second.voting, true);
    assert.match(second.feeLabel, /一年會籍（有效至 115-2）/);
    const over = paidIn('115-1', '2027-09-01');
    assert.equal(over.paid, false);
    assert.match(over.feeLabel, /115-1 已到期/);
    // paid 115-2: valid in 115-2 and 116-1, expired in 116-2
    assert.equal(paidIn('115-2', '2027-03-01').paid, true);
    const crossYear = paidIn('115-2', '2027-09-01');
    assert.equal(crossYear.paid, true);
    assert.match(crossYear.feeLabel, /有效至 116-1/);
    assert.equal(paidIn('115-2', '2028-03-01').paid, false);
    // a future-dated feeSemester is not valid yet
    assert.equal(paidIn('116-1', '2026-11-15').paid, false);
});

test('membership status follows the four-level and fee rules', () => {
    const today = new Date('2026-11-15T00:00:00Z');
    const unpaid = membershipStatus({ level: 'member', feeStatus: 'unpaid' }, today);
    assert.equal(unpaid.unpaid, true);
    assert.equal(unpaid.voting, false);
    const current = membershipStatus({ level: 'member', feeStatus: 'semester', feeSemester: '115-1' }, today);
    assert.equal(current.paid, true);
    assert.equal(current.voting, true);
    const expired = membershipStatus({ level: 'member', feeStatus: 'semester', feeSemester: '114-1' }, today);
    assert.equal(expired.paid, false);
    assert.match(expired.feeLabel, /114-1 已到期/);
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
    assert.equal(receiptFeeType('', 200), 'other');
    assert.equal(receiptFeeType('semester', 1000), 'semester');
    assert.equal(parseMemberLevel('PREP_OFFICER'), 'prep');
    assert.equal(parseMemberLevel('非正式社員/體驗學員'), 'trial');
    assert.equal(parseFeeStatus('LIFETIME_PAID'), 'lifetime');
    assert.equal(parseFeeStatus('學期會籍（500 元）'), 'semester');
    assert.equal(parseFeeStatus('一年會籍（500 元）'), 'semester');
    assert.equal(parseFeeStatus('一年會籍'), 'semester');
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

test('assembly thresholds follow the charter', () => {
    assert.deepEqual(assemblyThresholds(30, 20, true), { attendance: 20, agree: 14 });
    assert.deepEqual(assemblyThresholds(30, 10, false), { attendance: 10, agree: 5 });
    assert.equal(checkAssembly({ total: 30, attendance: 20, agree: 14 }, true).agree, 14);
    assert.throws(() => checkAssembly({ total: 30, attendance: 19, agree: 19 }, true), /出席人數未達門檻：需 20 人/);
    assert.throws(() => checkAssembly({ total: 30, attendance: 20, agree: 13 }, true), /同意人數未達門檻：需 14 人/);
    assert.throws(() => checkAssembly({ total: 30, attendance: 31, agree: 1 }, false), /不可超過社員總額/);
    assert.throws(() => checkProposalSource('charter', 'petition', 4), /5 人以上/);
    assert.throws(() => checkProposalSource('charter', '', 0), /章程第十三條/);
    assert.deepEqual(checkProposalSource('bylaw', '', 0), {});
});

test('regulations change only through amendments that meet the required procedure', async () => {
    const { request } = fixture();
    const list = await (await request('/api/regulations', 'member')).json();
    assert.equal(list.length, DEFAULT_REGULATIONS.length);
    assert.ok(list.some(item => item.title === '無人機社社費細則' && item.content.includes('一年會籍制：一次繳納新臺幣500元，自繳費學期起連續兩學期')));
    assert.equal((await request('/api/regulations', null)).status, 401);
    assert.equal((await request('/api/regulations/charter', 'president', 'PATCH', { content: 'x' })).status, 404, 'no direct edits');
    assert.equal((await request('/api/regulations/charter', 'president', 'DELETE')).status, 404, 'no direct deletes');

    const charter = list.find(item => item.id === 'charter');
    const amended = charter.content.replace('社長任期為一學年', '社長任期為一學年（測試修正）');
    assert.equal((await request('/api/regulation-amendments', 'member', 'POST', { regulationId: 'charter', content: amended, reason: 'x', source: 'committee' })).status, 403);
    assert.equal((await request('/api/regulation-amendments', 'cadre', 'POST', { regulationId: 'charter', content: amended, reason: '修正任期文字', source: 'petition', signers: 3 })).status, 400);
    assert.equal((await request('/api/regulation-amendments', 'cadre', 'POST', { regulationId: 'charter', content: charter.content, reason: '沒改', source: 'committee' })).status, 400);
    const proposed = await request('/api/regulation-amendments', 'cadre', 'POST', { regulationId: 'charter', content: amended, reason: '修正任期文字', source: 'petition', signers: 6 });
    assert.equal(proposed.status, 201);
    const amendment = await proposed.json();
    assert.equal(amendment.status, 'proposed');
    assert.equal((await (await request('/api/regulations', 'member')).json()).find(item => item.id === 'charter').content, charter.content, 'a proposal does not change the text');
    assert.equal((await (await request('/api/regulation-amendments', 'member')).json()).length, 1, 'members can see proposals');

    const adopt = body => request(`/api/regulation-amendments/${amendment.id}/adopt`, 'president', 'POST', body);
    assert.equal((await request(`/api/regulation-amendments/${amendment.id}/adopt`, 'cadre', 'POST', {})).status, 403);
    const short = await adopt({ assembly: { date: '2026-11-20', total: 30, attendance: 19, agree: 19 } });
    assert.equal(short.status, 400);
    assert.match((await short.json()).error, /需 20 人/);
    const passed = await adopt({ assembly: { date: '2026-11-20', total: 30, attendance: 21, agree: 15 } });
    assert.equal(passed.status, 200);
    assert.equal((await passed.json()).status, 'awaiting_school', 'charter changes wait for school acknowledgement');
    assert.equal((await (await request('/api/regulations', 'member')).json()).find(item => item.id === 'charter').content, charter.content);
    const approved = await request(`/api/regulation-amendments/${amendment.id}/school-approval`, 'president', 'POST', { schoolApprovedAt: '2026-12-01' });
    assert.equal((await approved.json()).status, 'effective');
    const effective = (await (await request('/api/regulations', 'member')).json()).find(item => item.id === 'charter');
    assert.equal(effective.content, amended);
    assert.equal(effective.version, '115.12.01 修正');
    assert.equal(effective.history.length, 1);
    assert.equal(effective.history[0].content, charter.content);

    // A bylaw needs an officers' meeting and the president's approval, plus an assembly when flagged.
    const fees = list.find(item => item.id === 'membership-fees');
    const feeDraft = await (await request('/api/regulation-amendments', 'finance', 'POST', { regulationId: 'membership-fees', content: fees.content.replace('新臺幣500元', '新臺幣600元'), reason: '調整社費', needsAssembly: true })).json();
    const stale = await (await request('/api/regulation-amendments', 'finance', 'POST', { regulationId: 'membership-fees', content: fees.content + '\n附記', reason: '另一案' })).json();
    assert.equal((await request(`/api/regulation-amendments/${feeDraft.id}/adopt`, 'president', 'POST', { officersMeetingDate: '2026-11-10', presidentApprovedAt: '2026-11-11' })).status, 400, 'assembly required');
    const feeAdopted = await request(`/api/regulation-amendments/${feeDraft.id}/adopt`, 'president', 'POST', { officersMeetingDate: '2026-11-10', presidentApprovedAt: '2026-11-21', assembly: { date: '2026-11-20', total: 30, attendance: 10, agree: 5 } });
    assert.equal((await feeAdopted.json()).status, 'effective');
    assert.equal((await request(`/api/regulation-amendments/${stale.id}/adopt`, 'president', 'POST', { officersMeetingDate: '2026-11-10', presidentApprovedAt: '2026-11-11' })).status, 409, 'outdated proposals are refused');
    assert.equal((await request(`/api/regulation-amendments/${stale.id}/close`, 'member', 'POST', { outcome: 'withdrawn' })).status, 403);
    assert.equal((await (await request(`/api/regulation-amendments/${stale.id}/close`, 'finance', 'POST', { outcome: 'withdrawn' })).json()).status, 'withdrawn');

    // School rules are only replaced with the school's announced text; the charter cannot be repealed.
    assert.equal((await request('/api/regulation-amendments', 'cadre', 'POST', { action: 'repeal', regulationId: 'charter', reason: '測試' })).status, 400);
    const school = list.find(item => item.id === 'school-club-rules');
    const schoolDraft = await (await request('/api/regulation-amendments', 'cadre', 'POST', { regulationId: 'school-club-rules', content: school.content + '\n新條文', reason: '學校公告新版' })).json();
    assert.equal((await request(`/api/regulation-amendments/${schoolDraft.id}/adopt`, 'president', 'POST', { schoolAnnouncedAt: '2026-11-01' })).status, 400, 'source required');
    assert.equal((await (await request(`/api/regulation-amendments/${schoolDraft.id}/adopt`, 'president', 'POST', { schoolAnnouncedAt: '2026-11-01', source: '115學年度第1學期學務會議' })).json()).status, 'effective');

    const rejected = await (await request('/api/regulation-amendments', 'cadre', 'POST', { action: 'repeal', regulationId: 'class-rules', reason: '測試廢止' })).json();
    assert.equal((await request(`/api/regulation-amendments/${rejected.id}/close`, 'president', 'POST', { outcome: 'rejected' })).status, 400, 'a reason is required');
    assert.equal((await (await request(`/api/regulation-amendments/${rejected.id}/close`, 'president', 'POST', { outcome: 'rejected', note: '幹部會議未通過' })).json()).status, 'rejected');
    assert.equal((await request(`/api/regulation-amendments/${rejected.id}/adopt`, 'president', 'POST', {})).status, 409);
});

test('officers can select many members and update or delete them at once', async () => {
    const { request, store } = fixture();
    const ids = [];
    for (const name of ['甲', '乙', '丙']) ids.push((await (await request('/api/members', 'finance', 'POST', { name })).json()).id);
    assert.equal((await request('/api/members/bulk', 'cadre', 'POST', { ids, level: 'officer' })).status, 403);
    assert.equal((await request('/api/members/bulk', 'finance', 'POST', { ids: [], level: 'officer' })).status, 400);
    assert.equal((await request('/api/members/bulk', 'finance', 'POST', { ids })).status, 400, 'something must change');
    assert.equal((await request('/api/members/bulk', 'finance', 'POST', { ids: [...ids, 'missing'], level: 'officer' })).status, 409);
    assert.equal((await request('/api/members/bulk', 'finance', 'POST', { ids, feeStatus: 'semester', feeSemester: 'bad' })).status, 400);
    assert.equal(JSON.parse(store.get('members:list'))[0].feeStatus, 'unpaid', 'an invalid value changes nothing');

    const updated = await request('/api/members/bulk', 'finance', 'POST', { ids: ids.slice(0, 2), feeStatus: 'semester', feeSemester: '115-1' });
    assert.deepEqual(await updated.json(), { updated: 2, deleted: 0 });
    await request('/api/members/bulk', 'finance', 'POST', { ids: ids.slice(0, 2), level: 'prep' });
    const list = JSON.parse(store.get('members:list'));
    assert.deepEqual(list.map(item => [item.level, item.feeStatus, item.feeSemester]), [['prep', 'semester', '115-1'], ['prep', 'semester', '115-1'], ['member', 'unpaid', '']], 'level-only change keeps the fee semester');

    await request('/api/users', 'president', 'PATCH', { username: 'member', memberId: ids[0] });
    assert.deepEqual(await (await request('/api/members/bulk', 'finance', 'POST', { ids: ids.slice(0, 2), action: 'delete' })).json(), { updated: 0, deleted: 2 });
    assert.equal(JSON.parse(store.get('members:list')).length, 1);
    assert.equal(JSON.parse(store.get('user:member')).memberId, undefined, 'bound accounts are released');
});
