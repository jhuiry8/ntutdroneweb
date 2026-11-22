import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { ClassStore } from '../src/classes.js';
import { MessageStore } from '../src/messages.js';
import { MeetingStore } from '../src/meetings.js';
import { EquipmentStore } from '../src/equipment-store.js';
import { FormStore } from '../src/form-store.js';
import { FlightStore } from '../src/flight-store.js';
import {
    PERMISSIONS, PERMISSION_CODES, POSITIONS, LEGACY_ROLE_PERMISSIONS, positionCatalog, computePermissions, permissionsFromRole, hasPermission
} from '../src/permissions.js';
import { canManageUsers, canEditCms, canViewCms, canManageFinance, canManageMembers, canManageEquipment, canUploadFiles, publicUser } from '../src/auth.js';
import { academicYearOf, csvCell, officersCsv, publicOfficerView, taipeiDate } from '../src/org.js';
import { withSiteStore } from './helpers/site-store.js';
import { createOrgStore, createFileStore, durableObject } from './helpers/org-store.js';

// ---------- fixture ----------

const DEFAULT_ACCOUNTS = { admin: 'president', fin: 'finance', cad: 'cadre', mem: 'member', mem2: 'member', vice: 'member', treas: 'member', comm: 'member', intern: 'member', tech: 'member', pubr: 'member', net: 'member', pres2: 'member' };

function fixture({ withOrg = true, accounts = DEFAULT_ACCOUNTS } = {}) {
    const store = new Map();
    const db = {
        async get(key) { return store.get(key) ?? null; },
        async put(key, value) { store.set(key, typeof value === 'string' ? value : JSON.stringify(value)); },
        async delete(key) { store.delete(key); },
        async list({ prefix }) { return { keys: [...store.keys()].filter(name => name.startsWith(prefix)).map(name => ({ name })) }; }
    };
    for (const [username, role] of Object.entries(accounts)) {
        store.set(`user:${username}`, JSON.stringify({ username, role, active: true, version: 'v1', createdAt: '2025-01-01T00:00:00Z' }));
        store.set(`session:${username}`, JSON.stringify({ username, version: 'v1' }));
    }
    store.set('members:list', JSON.stringify([{ id: 'm1', name: '王小明', studentId: '110000001' }]));
    const env = withSiteStore({ DRONE_DB: db, FILE_STORE: createFileStore(), CLASS_STORE: durableObject(ClassStore), MESSAGE_STORE: durableObject(MessageStore), MEETING_STORE: durableObject(MeetingStore), EQUIPMENT_STORE: durableObject(EquipmentStore), FORM_STORE: durableObject(FormStore), FLIGHT_STORE: durableObject(FlightStore) });
    if (withOrg) env.ORG_STORE = createOrgStore();
    const request = async (path, who, method = 'GET', body) => {
        const response = await worker.fetch(new Request(`https://example.com${path}`, {
            method,
            headers: { ...(who ? { Cookie: `session=${who}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) })
        }), env);
        const type = response.headers.get('Content-Type') || '';
        return { status: response.status, headers: response.headers, body: type.includes('json') ? await response.json() : await response.text() };
    };
    const as = (who, positions, extra = {}) => request('/api/users', 'admin', 'PATCH', { username: who, positions, ...extra });
    const me = async who => (await request('/api/me', who)).body;
    return { env, store, request, as, me };
}

const can = async (f, who, code) => (await f.me(who)).permissions.includes(code);

// ---------- the permission model ----------

test('every permission code has a Chinese description and a group', () => {
    assert.ok(PERMISSION_CODES.length >= 30);
    for (const code of PERMISSION_CODES) {
        assert.match(PERMISSIONS[code].label, /[一-鿿]/, code);
        assert.ok(PERMISSIONS[code].group, code);
    }
});

test('built-in positions only use known permission codes and follow the charter', () => {
    const catalog = positionCatalog();
    for (const position of Object.values(catalog)) for (const code of position.permissions) assert.ok(PERMISSIONS[code], `${position.id} ${code}`);
    assert.deepEqual(catalog.president.permissions, PERMISSION_CODES);
    const has = (id, ...codes) => codes.every(code => catalog[id].permissions.includes(code));
    const lacks = (id, ...codes) => codes.every(code => !catalog[id].permissions.includes(code));
    // 副社長: look across the groups, no editing of money or accounts
    assert.ok(has('vice', 'cms.view', 'finance.view', 'members.view', 'equipment.view', 'reports.view'));
    assert.ok(lacks('vice', 'finance.edit', 'users.manage', 'cms.edit'));
    // 活動公關組
    assert.ok(has('pr', 'cms.edit', 'events.manage', 'announce.post', 'files.upload'));
    assert.ok(lacks('pr', 'finance.view', 'members.view', 'equipment.manage'));
    // 教學技術組
    assert.ok(has('tech', 'classes.manage', 'classes.checkin', 'surveys.manage', 'notes.manage', 'equipment.manage', 'loans.approve'));
    assert.ok(lacks('tech', 'finance.view', 'members.edit', 'cms.edit'));
    // 行政庶務組: 執秘 / 總務 / 場地
    assert.ok(has('secretary', 'meetings.manage', 'members.view', 'members.edit'));
    assert.ok(lacks('secretary', 'finance.view', 'finance.edit'));
    assert.ok(has('treasurer', 'finance.view', 'finance.edit', 'receipts.manage'));
    assert.ok(lacks('treasurer', 'members.edit', 'finance.audit', 'finance.approve'));
    assert.ok(has('venue', 'forms.manage'));
    assert.ok(lacks('venue', 'finance.view', 'members.view'));
    // 法規監察委員會: read-only finance plus the audit record
    for (const id of ['committee', 'committee_chair']) {
        assert.ok(has(id, 'finance.view', 'finance.audit', 'regulations.amend'));
        assert.ok(lacks(id, 'finance.edit', 'finance.approve', 'members.view', 'users.manage'));
    }
    // 實習幹部: check-in, look at equipment, loan drafts; no money, no personal data
    assert.deepEqual([...catalog.intern.permissions].sort(), ['classes.checkin', 'equipment.view', 'loans.draft']);
    assert.deepEqual(catalog.member.permissions, []);
});

test('actual permissions = union of positions + grants - revokes; users.manage never sits on a custom position', () => {
    const catalog = positionCatalog({ customPositions: { netadmin: { name: '網管', permissions: ['site.settings', 'users.manage', 'cms.view'] } } });
    assert.deepEqual([...catalog.netadmin.permissions].sort(), ['cms.view', 'site.settings']);
    const result = computePermissions({ positions: ['pr', 'tech'], grants: ['finance.view'], revokes: ['cms.edit', 'classes.manage'], catalog });
    assert.ok(result.includes('events.manage') && result.includes('equipment.manage') && result.includes('finance.view'));
    assert.ok(!result.includes('cms.edit') && !result.includes('classes.manage'));
    // a revoke wins over a position and a grant of the same code
    assert.ok(!computePermissions({ positions: ['pr'], grants: ['cms.edit'], revokes: ['cms.edit'], catalog }).includes('cms.edit'));
});

test('legacy helpers keep the exact behaviour of the four old roles', () => {
    const expected = {
        canManageUsers: { president: 1 },
        canEditCms: { president: 1, cadre: 1 },
        canViewCms: { president: 1, finance: 1, cadre: 1 },
        canManageFinance: { president: 1, finance: 1 },
        canManageMembers: { president: 1, finance: 1 },
        canManageEquipment: { president: 1, finance: 1, cadre: 1 },
        canUploadFiles: { president: 1, finance: 1, cadre: 1 }
    };
    const fns = { canManageUsers, canEditCms, canViewCms, canManageFinance, canManageMembers, canManageEquipment, canUploadFiles };
    for (const [name, fn] of Object.entries(fns)) for (const role of ['president', 'finance', 'cadre', 'member']) {
        assert.equal(fn({ role }), Boolean(expected[name][role]), `${name}(${role})`);
    }
    for (const fn of Object.values(fns)) { assert.equal(fn(null), false); assert.equal(fn(undefined), false); assert.equal(fn({}), false); }
    // resolved permissions win over the role
    assert.equal(canEditCms({ role: 'president', permissions: ['cms.view'] }), false);
    assert.equal(canViewCms({ role: 'member', permissions: ['cms.view'] }), true);
    assert.equal(hasPermission({ role: 'cadre' }, 'cms.edit'), true);
    assert.deepEqual(permissionsFromRole('member'), []);
    assert.equal(LEGACY_ROLE_PERMISSIONS.finance.includes('finance.approve'), false);
});

test('academic year (學年) starts on 1 August', () => {
    assert.equal(academicYearOf('2026-08-01'), '115');
    assert.equal(academicYearOf('2027-07-31'), '115');
    assert.equal(academicYearOf('2027-08-01'), '116');
    assert.equal(academicYearOf('2026-07-31'), '114');
});

// ---------- migration and /api/me ----------

test('old roles migrate to positions automatically, repeatably and without losing accounts', async () => {
    const f = fixture();
    const before = [...f.store.keys()].filter(key => key.startsWith('user:')).sort();
    const first = (await f.request('/api/org/migrate', 'admin', 'POST')).body;
    assert.equal(first.total, before.length);
    assert.equal(first.migrated, first.total - 1, 'everyone except the caller (resolved on sign-in) is migrated');
    assert.equal((await f.request('/api/org/migrate', 'admin', 'POST')).body.migrated, 0);
    assert.deepEqual([...f.store.keys()].filter(key => key.startsWith('user:')).sort(), before);
    const admin = await f.me('admin');
    assert.deepEqual(admin.positions, ['president']);
    assert.equal(admin.role, 'president');
    assert.deepEqual(admin.permissions, PERMISSION_CODES);
    const fin = await f.me('fin');
    assert.deepEqual(fin.positions, ['treasurer']);
    assert.equal(fin.role, 'finance');
    // the old finance role keeps every ability it had (members, equipment, files) until the president narrows it
    for (const code of LEGACY_ROLE_PERMISSIONS.finance) assert.ok(fin.permissions.includes(code), code);
    assert.ok(!fin.permissions.includes('users.manage') && !fin.permissions.includes('finance.approve'));
    const cad = await f.me('cad');
    assert.deepEqual(cad.positions, ['cadre']);
    assert.equal(cad.role, 'cadre');
    assert.deepEqual([...cad.permissions].sort(), [...LEGACY_ROLE_PERMISSIONS.cadre].sort());
    const mem = await f.me('mem');
    assert.deepEqual(mem.positions, []);
    assert.equal(mem.role, 'member');
    assert.deepEqual(mem.permissions, []);
});

test('/api/me keeps role and adds positions and permissions; without an OrgStore the old role decides', async () => {
    const f = fixture();
    const body = await f.me('cad');
    assert.equal(body.role, 'cadre');
    assert.ok(Array.isArray(body.positions) && Array.isArray(body.permissions));
    assert.ok(body.username && 'active' in body && 'createdAt' in body);
    const legacy = fixture({ withOrg: false });
    const old = await legacy.me('fin');
    assert.equal(old.role, 'finance');
    assert.deepEqual(old.positions, ['treasurer']);
    assert.deepEqual(old.permissions, LEGACY_ROLE_PERMISSIONS.finance);
    // and the old routes still work for every legacy role
    assert.equal((await legacy.request('/api/finance/summary', 'fin')).status, 200);
    assert.equal((await legacy.request('/api/finance/summary', 'cad')).status, 403);
    assert.equal((await legacy.request('/api/users', 'admin')).status, 200);
    assert.equal((await legacy.request('/api/users', 'cad')).status, 403);
    assert.equal(publicUser({ username: 'x', role: 'cadre' }).permissions, undefined);
});

test('a session user is never written back with its resolved permissions', async () => {
    const f = fixture();
    await f.as('mem', ['pr']);
    const before = JSON.parse(f.store.get('user:mem'));
    f.store.set('user:mem', JSON.stringify({ ...before, passwordHash: 'x' }));
    // change-password reads the stored record; resolved fields must not leak into KV
    await f.request('/api/change-password', 'mem', 'POST', { oldPassword: 'x', newPassword: 'longenough1' }).catch(() => {});
    for (const key of ['permissions', 'positions', 'realPresident', 'actingPresident']) assert.equal(key in JSON.parse(f.store.get('user:mem')), false);
});

// ---------- granting, revoking, custom positions ----------

test('the president edits a position, grants and revokes per account, and creates a custom position', async () => {
    const f = fixture();
    assert.equal((await f.as('pubr', ['pr'])).status, 200);
    assert.ok(await can(f, 'pubr', 'events.manage'));
    assert.equal((await f.request('/api/events', 'pubr')).status, 200);
    // 1. change a position's default permissions
    assert.equal((await f.request('/api/org/positions/pr', 'admin', 'PUT', { permissions: ['cms.view', 'cms.edit'] })).status, 200);
    assert.ok(!(await can(f, 'pubr', 'events.manage')) && await can(f, 'pubr', 'cms.edit'));
    assert.equal((await f.request('/api/events/anything/registrations', 'pubr')).status !== 200, true);
    // 2. grant and revoke for one account
    assert.equal((await f.as('pubr', undefined, { grants: ['finance.view'], revokes: ['cms.edit'] })).status, 200);
    const mine = await f.me('pubr');
    assert.ok(mine.permissions.includes('finance.view') && !mine.permissions.includes('cms.edit') && mine.permissions.includes('cms.view'));
    assert.equal((await f.request('/api/finance/summary', 'pubr')).status, 200);
    assert.equal((await f.request('/api/posts', 'pubr', 'POST', { title: 'x', slug: 'x', content: 'y' })).status, 403);
    // 3. custom position 網管
    const created = await f.request('/api/org/positions', 'admin', 'POST', { id: 'netadmin', name: '網管', permissions: ['site.settings', 'cms.view'] });
    assert.equal(created.status, 201);
    assert.equal((await f.request('/api/org/positions', 'admin', 'POST', { id: 'netadmin', name: '重複', permissions: [] })).status, 409);
    assert.equal((await f.request('/api/org/positions', 'admin', 'POST', { id: 'Bad Id', name: 'x', permissions: [] })).status, 400);
    assert.equal((await f.request('/api/org/positions', 'admin', 'POST', { id: 'ghost', name: 'x', permissions: ['no.such'] })).status, 400);
    assert.equal((await f.request('/api/site-settings', 'net', 'PUT', { memberLogin: false })).status, 403);
    assert.equal((await f.as('net', ['netadmin'])).status, 200);
    assert.deepEqual([...(await f.me('net')).permissions].sort(), ['cms.view', 'site.settings']);
    assert.equal((await f.request('/api/site-settings', 'net', 'PUT', { memberLogin: true })).status, 200);
    assert.equal((await f.request('/api/users', 'net')).status, 403);
    // a position in use cannot be deleted; an unused one can
    assert.equal((await f.request('/api/org/positions/netadmin', 'admin', 'DELETE')).status, 409);
    await f.as('net', []);
    assert.equal((await f.request('/api/org/positions/netadmin', 'admin', 'DELETE')).status, 200);
    assert.equal((await f.request('/api/org/positions/pr', 'admin', 'DELETE')).status, 403, 'built-in positions cannot be deleted');
});

test('only the president changes positions and permissions; nobody hands out what they lack', async () => {
    const f = fixture();
    await f.as('pubr', ['pr']);
    assert.equal((await f.request('/api/org/positions/pr', 'pubr', 'PUT', { permissions: ['cms.view'] })).status, 403);
    assert.equal((await f.request('/api/users', 'pubr', 'PATCH', { username: 'mem', positions: ['pr'] })).status, 403);
    // a person who was given users.manage still cannot give away more than they hold
    assert.equal((await f.as('net', [], { grants: ['users.manage', 'cms.view'] })).status, 200);
    assert.ok(await can(f, 'net', 'users.manage'));
    assert.equal((await f.request('/api/users', 'net', 'PATCH', { username: 'mem', grants: ['finance.edit'] })).status, 403);
    assert.equal((await f.request('/api/users', 'net', 'PATCH', { username: 'mem', grants: ['users.manage'] })).status, 403, 'users.manage only comes from the president');
    assert.equal((await f.request('/api/users', 'net', 'PATCH', { username: 'mem', positions: ['president'] })).status, 403);
    assert.equal((await f.request('/api/users', 'net', 'PATCH', { username: 'mem', role: 'president' })).status, 403);
    assert.equal((await f.request('/api/users', 'net', 'POST', { username: 'newone', password: 'longenough1', role: 'president' })).status, 403);
    assert.equal((await f.request('/api/users', 'net', 'PATCH', { username: 'mem', grants: ['cms.view'] })).status, 200);
    assert.equal((await f.request('/api/org/positions/pr', 'net', 'PUT', { permissions: ['cms.view', 'finance.edit'] })).status, 403);
    assert.equal((await f.request('/api/org/positions', 'net', 'POST', { id: 'sneaky', name: 'x', permissions: ['finance.edit'] })).status, 403);
    // users.manage cannot be put on any position
    assert.equal((await f.request('/api/org/positions/pr', 'admin', 'PUT', { permissions: ['users.manage'] })).status, 403);
    assert.equal((await f.request('/api/org/positions/president', 'admin', 'PUT', { permissions: ['cms.view'] })).status, 403);
});

test('the president cannot be locked out: no revoke of users.manage, at least one president remains', async () => {
    const f = fixture();
    assert.equal((await f.as('pres2', ['president'])).status, 200);
    assert.ok(await can(f, 'pres2', 'users.manage'));
    assert.equal((await f.as('pres2', undefined, { revokes: ['users.manage'] })).status, 400);
    assert.equal((await f.as('admin', undefined, { revokes: ['users.manage'] })).status, 400);
    assert.ok(await can(f, 'admin', 'users.manage'));
    // the main administrator can neither lose the position nor be switched off
    assert.equal((await f.as('admin', [])).status, 400);
    assert.equal((await f.request('/api/users', 'admin', 'PATCH', { username: 'admin', role: 'cadre' })).status, 400);
    assert.equal((await f.request('/api/users', 'admin', 'PATCH', { username: 'admin', active: false })).status, 400);
    // the second president can be demoted because the administrator remains
    assert.equal((await f.as('pres2', [])).status, 200);
    assert.ok(!(await can(f, 'pres2', 'users.manage')));
    // a president who is only on the roster still keeps account management while the term lasts
    assert.equal((await f.request('/api/users', 'pres2', 'GET')).status, 403);
});

test('legacy role changes through /api/users still work and keep positions in sync', async () => {
    const f = fixture();
    assert.equal((await f.request('/api/users', 'admin', 'PATCH', { username: 'mem', role: 'finance' })).status, 200);
    // a role change signs the person out (as before): sign in again
    const signIn = who => f.store.set(`session:${who}`, JSON.stringify({ username: who, version: JSON.parse(f.store.get(`user:${who}`)).version }));
    signIn('mem');
    const body = await f.me('mem');
    assert.equal(body.role, 'finance');
    assert.deepEqual(body.positions, ['treasurer']);
    assert.ok(body.permissions.includes('members.edit'));
    assert.equal((await f.request('/api/users', 'admin', 'PATCH', { username: 'mem', role: 'member' })).status, 200);
    signIn('mem');
    assert.deepEqual((await f.me('mem')).permissions, []);
    assert.equal((await f.request('/api/users', 'admin', 'PATCH', { username: 'mem', role: 'wizard' })).status, 400);
    const created = await f.request('/api/users', 'admin', 'POST', { username: 'newcomer', password: 'longenough1', role: 'cadre' });
    assert.equal(created.status, 201);
    const list = (await f.request('/api/users', 'admin')).body;
    const row = list.find(item => item.username === 'newcomer');
    assert.equal(row.role, 'cadre');
    assert.deepEqual(row.positions, ['cadre']);
    assert.ok(Array.isArray(row.permissions));
    const byPosition = await f.request('/api/users', 'admin', 'POST', { username: 'tech2', password: 'longenough1', positions: ['tech', 'pr'] });
    assert.equal(byPosition.status, 201);
    assert.deepEqual((await f.request('/api/users', 'admin')).body.find(item => item.username === 'tech2').positions, ['pr', 'tech'].sort((a, b) => ['pr', 'tech'].indexOf(a) - ['pr', 'tech'].indexOf(b)));
});

// ---------- API enforcement ----------

test('unauthorised accounts get 403 on every major API (members and interns)', async () => {
    const f = fixture();
    await f.as('intern', ['intern']);
    const calls = [
        ['GET', '/api/posts'], ['POST', '/api/posts', { title: 'a', slug: 'a', content: 'b' }], ['POST', '/api/pages', { title: 'a', slug: 'a', content: 'b' }], ['POST', '/api/homepage', {}], ['GET', '/api/homepage'],
        ['GET', '/api/notes'], ['POST', '/api/notes', { title: 'a', date: '2026-01-01' }],
        ['GET', '/api/finance/summary'], ['POST', '/api/finance/transactions', {}], ['PATCH', '/api/finance/transactions/x/review', { status: 'approved' }], ['POST', '/api/finance/transactions/x/audit', { verdict: 'signed' }],
        ['PUT', '/api/finance/budgets', { budgets: [] }], ['POST', '/api/finance/import', { rows: [] }], ['GET', '/api/finance/budgets'],
        ['GET', '/api/members'], ['POST', '/api/members', {}], ['POST', '/api/members/import', {}], ['GET', '/api/member-fee-receipts'], ['POST', '/api/member-fee-receipts', {}],
        ['GET', '/api/equipment'], ['POST', '/api/equipment', {}],
        ['POST', '/api/loans/abc/lend', {}], ['POST', '/api/classes', {}],
        ['POST', '/api/files', {}], ['GET', '/api/files/audit'],
        ['POST', '/api/regulation-amendments', {}], ['POST', '/api/regulation-amendments/x/adopt', {}],
        ['GET', '/api/users'], ['POST', '/api/users', {}], ['PATCH', '/api/users', {}],
        ['PUT', '/api/org/positions/pr', { permissions: [] }], ['POST', '/api/org/positions', {}], ['PUT', '/api/org/acting', { active: true }], ['PUT', '/api/org/settings', {}],
        ['GET', '/api/org/audit'], ['GET', '/api/org/officers'], ['GET', '/api/org/officers.csv'], ['POST', '/api/org/officers', {}], ['POST', '/api/org/migrate'],
        ['PUT', '/api/site-settings', { memberLogin: true }], ['GET', '/api/backup/status'], ['POST', '/api/backup/run'], ['POST', '/api/meetings', {}], ['POST', '/api/events', {}], ['POST', '/api/announcements', { title: 'a', content: 'b' }],
        ['GET', '/api/flights?scope=all']
    ];
    for (const who of ['mem', 'intern']) for (const [method, path, body] of calls) {
        if (who === 'intern' && method === 'GET' && path === '/api/equipment') continue; // equipment.view is part of the intern position
        const response = await f.request(path, who, method, body);
        // loans.draft (intern) may read loans, nothing else on this list is allowed
        assert.equal(response.status, 403, `${who} ${method} ${path} -> ${response.status}`);
    }
    for (const [method, path, body] of calls) assert.equal((await f.request(path, undefined, method, body)).status, 401, `anonymous ${method} ${path}`);
});

test('each position can use exactly its own areas', async () => {
    const f = fixture();
    await f.as('pubr', ['pr']); await f.as('tech', ['tech']); await f.as('treas', ['treasurer']); await f.as('comm', ['committee']); await f.as('vice', ['vice']);
    const status = async (who, method, path, body) => (await f.request(path, who, method, body)).status;
    // 活動公關組
    assert.notEqual(await status('pubr', 'POST', '/api/posts', { title: 'a', slug: 'pr-post', content: 'b' }), 403);
    assert.equal(await status('pubr', 'GET', '/api/finance/summary'), 403);
    assert.equal(await status('pubr', 'GET', '/api/members'), 403);
    assert.equal(await status('pubr', 'GET', '/api/equipment'), 403);
    // 教學技術組
    assert.equal(await status('tech', 'GET', '/api/equipment'), 200);
    assert.notEqual(await status('tech', 'GET', '/api/classes'), 403);
    assert.equal(await status('tech', 'POST', '/api/posts', { title: 'a', slug: 't', content: 'b' }), 403);
    assert.equal(await status('tech', 'GET', '/api/finance/summary'), 403);
    // 總務
    assert.equal(await status('treas', 'GET', '/api/finance/summary'), 200);
    assert.equal(await status('treas', 'POST', '/api/finance/transactions', { kind: 'income', amount: 100, account: 'cash', item: '社費', date: '2026-01-02' }), 201);
    assert.equal(await status('treas', 'GET', '/api/member-fee-receipts'), 200);
    assert.equal(await status('treas', 'POST', '/api/members', {}), 403);
    assert.equal(await status('treas', 'PATCH', '/api/finance/transactions/x/review', { status: 'approved' }), 403, '總務 does not approve their own entries');
    // 副社長: look, do not touch
    assert.equal(await status('vice', 'GET', '/api/finance/summary'), 200);
    assert.equal(await status('vice', 'GET', '/api/members'), 200);
    assert.equal(await status('vice', 'POST', '/api/finance/transactions', {}), 403);
    assert.equal(await status('vice', 'GET', '/api/users'), 403);
    // 委員: finance is read only
    assert.equal(await status('comm', 'GET', '/api/finance/summary'), 200);
    assert.equal(await status('comm', 'POST', '/api/finance/transactions', {}), 403);
    assert.equal(await status('comm', 'GET', '/api/members'), 403);
    assert.equal(await status('comm', 'GET', '/api/org/audit'), 200);
});

test('interns run the class check-in and see equipment but never money or personal data', async () => {
    const f = fixture();
    await f.as('intern', ['intern']); await f.as('tech', ['tech']);
    const created = await f.request('/api/classes', 'tech', 'POST', { topic: '基礎課', date: '2026-12-01', time: '19:00', location: 'A101' });
    assert.ok([200, 201].includes(created.status), JSON.stringify(created.body));
    const list = await f.request('/api/classes', 'intern');
    assert.equal(list.status, 200);
    assert.ok(list.body.roster.every(member => member.studentId === ''), 'student IDs stay hidden from interns');
    assert.equal((await f.request('/api/classes', 'tech')).body.roster[0].studentId, '110000001');
    assert.equal((await f.request('/api/classes', 'intern', 'POST', { topic: 'x', date: '2026-12-02' })).status, 403);
    const id = list.body.classes[0].id;
    assert.equal((await f.request(`/api/classes/${id}`, 'intern', 'DELETE')).status, 403);
    assert.equal((await f.request(`/api/classes/${id}`, 'intern', 'PATCH', { title: 'x' })).status, 403);
    assert.equal((await f.request(`/api/classes/${id}/export.csv`, 'intern')).status, 403);
    assert.equal((await f.request(`/api/classes/${id}/attendance`, 'intern', 'POST', { guest: { name: '訪客甲' } })).status, 200);
    assert.equal((await f.request('/api/equipment', 'intern')).status, 200);
    assert.equal((await f.request('/api/equipment', 'intern', 'POST', { assetName: 'x' })).status, 403);
    assert.equal((await f.request('/api/loans', 'intern')).status, 200);
    assert.equal((await f.request('/api/loans/abc/lend', 'intern', 'POST', {})).status, 403);
    assert.equal((await f.request('/api/finance/summary', 'intern')).status, 403);
    assert.equal((await f.request('/api/members', 'intern')).status, 403);
    assert.equal((await f.request('/api/meetings', 'intern')).status, 200);
});

// ---------- finance audit and conflict of interest ----------

test('the committee audits ledger entries; a 委員 who is also 總務 cannot audit entries they handled', async () => {
    const f = fixture();
    await f.as('treas', ['treasurer']); await f.as('comm', ['committee']); await f.as('vice', ['committee', 'treasurer']);
    const entry = async who => (await f.request('/api/finance/transactions', who, 'POST', { kind: 'expense', amount: 500, account: 'cash', item: '器材', date: '2026-02-03' })).body;
    const mine = await entry('treas');
    const double = await entry('vice');
    // the committee member signs and comments, but the entry itself does not change
    const signed = await f.request(`/api/finance/transactions/${mine.id}/audit`, 'comm', 'POST', { verdict: 'signed' });
    assert.equal(signed.status, 201);
    assert.equal(signed.body.audits[0].by, 'comm');
    assert.equal(signed.body.status, 'pending');
    assert.equal(signed.body.amount, 500);
    assert.equal((await f.request(`/api/finance/transactions/${mine.id}/audit`, 'comm', 'POST', { verdict: 'opinion', note: '' })).status, 400);
    assert.equal((await f.request(`/api/finance/transactions/${mine.id}/audit`, 'comm', 'POST', { verdict: 'maybe' })).status, 400);
    assert.equal((await f.request(`/api/finance/transactions/${mine.id}/audit`, 'comm', 'POST', { verdict: 'opinion', note: '發票缺漏' })).status, 201);
    assert.equal((await f.request('/api/finance/transactions/nope/audit', 'comm', 'POST', { verdict: 'signed' })).status, 404);
    // conflict of interest (章程第十二條第四款)
    const blocked = await f.request(`/api/finance/transactions/${double.id}/audit`, 'vice', 'POST', { verdict: 'signed' });
    assert.equal(blocked.status, 403);
    assert.match(blocked.body.error, /利益迴避/);
    // …but entries handled by somebody else are fine
    assert.equal((await f.request(`/api/finance/transactions/${mine.id}/audit`, 'vice', 'POST', { verdict: 'signed' })).status, 201);
    // an entry the president approved is also "handled" by the approver
    assert.equal((await f.request(`/api/finance/transactions/${mine.id}/review`, 'admin', 'PATCH', { status: 'approved' })).status, 200);
    assert.equal((await f.request(`/api/finance/transactions/${mine.id}/audit`, 'admin', 'POST', { verdict: 'signed' })).status, 201 === 201 ? (await f.request(`/api/finance/transactions/${mine.id}/audit`, 'admin', 'POST', { verdict: 'signed' })).status : 0);
    // the treasurer cannot audit at all (no finance.audit), nor can the audit be used to change the ledger
    assert.equal((await f.request(`/api/finance/transactions/${mine.id}/audit`, 'treas', 'POST', { verdict: 'signed' })).status, 403);
    const summary = (await f.request('/api/finance/summary', 'comm')).body;
    assert.equal(summary.totals.expense, 500, 'approved total unchanged by audits');
});

// ---------- acting president ----------

test('代理社長: only the president or the administrator switches it on, the 副社長 gets president rights meanwhile, and it is logged', async () => {
    const f = fixture();
    await f.as('vice', ['vice']); await f.as('treas', ['treasurer']);
    assert.ok(!(await can(f, 'vice', 'users.manage')));
    assert.equal((await f.request('/api/users', 'vice')).status, 403);
    assert.equal((await f.request('/api/org/acting', 'vice', 'PUT', { active: true })).status, 403);
    assert.equal((await f.request('/api/org/acting', 'treas', 'PUT', { active: true })).status, 403);
    assert.equal((await f.request('/api/org/acting', 'admin', 'PUT', { active: 'yes' })).status, 400);
    assert.equal((await f.request('/api/org/acting', 'admin', 'PUT', { active: true, note: '社長出國交流' })).status, 200);
    const acting = await f.me('vice');
    assert.deepEqual(acting.permissions, PERMISSION_CODES);
    assert.equal(acting.actingPresident, true);
    assert.equal(acting.role, 'cadre', 'the role stays that of the main position');
    assert.equal((await f.request('/api/finance/transactions/x/review', 'vice', 'PATCH', { status: 'approved' })).status, 404, 'passes the permission check (entry does not exist)');
    assert.equal((await f.request('/api/users', 'vice')).status, 200);
    // acting is not a real president: cannot name presidents, hand out users.manage or switch the mode
    assert.equal((await f.request('/api/users', 'vice', 'PATCH', { username: 'mem', positions: ['president'] })).status, 403);
    assert.equal((await f.request('/api/users', 'vice', 'PATCH', { username: 'mem', grants: ['users.manage'] })).status, 403);
    assert.equal((await f.request('/api/org/acting', 'vice', 'PUT', { active: false })).status, 403);
    // other people are not affected
    assert.ok(!(await can(f, 'treas', 'users.manage')));
    assert.equal((await f.request('/api/org/acting', 'admin', 'PUT', { active: false })).status, 200);
    assert.ok(!(await can(f, 'vice', 'users.manage')));
    const log = (await f.request('/api/org/audit?action=acting', 'admin')).body.entries;
    assert.deepEqual(log.map(entry => entry.action), ['acting.off', 'acting.on']);
    assert.equal(log[1].actor, 'admin');
    assert.equal(log[1].detail.note, '社長出國交流');
});

// ---------- audit log ----------

test('every permission change is recorded with who, when and what, and can be queried', async () => {
    const f = fixture();
    await f.request('/api/org/positions/pr', 'admin', 'PUT', { permissions: ['cms.view'] });
    await f.as('mem', ['pr'], { grants: ['finance.view'] });
    await f.request('/api/org/positions', 'admin', 'POST', { id: 'netadmin', name: '網管', permissions: ['site.settings'] });
    const all = (await f.request('/api/org/audit', 'admin')).body.entries;
    const actions = all.map(entry => entry.action);
    for (const action of ['position.permissions', 'account.permissions', 'position.create']) assert.ok(actions.includes(action), action);
    const change = all.find(entry => entry.action === 'account.permissions' && entry.target === 'mem');
    assert.equal(change.actor, 'admin');
    assert.ok(Date.parse(change.at) > 0);
    assert.deepEqual(change.detail.positions.after, ['pr']);
    assert.deepEqual(change.detail.grants.after, ['finance.view']);
    const positionChange = all.find(entry => entry.action === 'position.permissions');
    assert.ok(positionChange.detail.before.includes('events.manage') && !positionChange.detail.after.includes('events.manage'));
    assert.equal((await f.request('/api/org/audit?target=mem', 'admin')).body.entries.every(entry => entry.target === 'mem'), true);
    assert.equal((await f.request('/api/org/audit?limit=1', 'admin')).body.entries.length, 1);
    assert.equal((await f.request('/api/org/audit', 'mem')).status, 403);
});

// ---------- roster, terms, profile ----------

const day = offset => new Date(Date.now() + 8 * 3600000 + offset * 86400000).toISOString().slice(0, 10);

test('officers are assigned per 學年, may hold several positions, and permissions follow the assignment', async () => {
    const f = fixture();
    const year = academicYearOf();
    const denied = await f.request('/api/org/officers', 'mem', 'POST', { year, username: 'pubr', position: 'pr' });
    assert.equal(denied.status, 403);
    const first = await f.request('/api/org/officers', 'admin', 'POST', { year, username: 'pubr', position: 'pr' });
    assert.equal(first.status, 201);
    assert.equal((await f.request('/api/org/officers', 'admin', 'POST', { year, username: 'pubr', position: 'tech' })).status, 201, 'positions can be combined');
    assert.equal((await f.request('/api/org/officers', 'admin', 'POST', { year, username: 'pubr', position: 'pr' })).status, 409);
    assert.equal((await f.request('/api/org/officers', 'admin', 'POST', { year, username: 'ghost', position: 'pr' })).status, 404);
    assert.equal((await f.request('/api/org/officers', 'admin', 'POST', { year, username: 'mem', position: 'member' })).status, 400);
    assert.equal((await f.request('/api/org/officers', 'admin', 'POST', { year, username: 'mem', position: 'nope' })).status, 400);
    assert.equal((await f.request('/api/org/officers', 'admin', 'POST', { year, username: 'intern', position: 'intern' })).status, 201);
    const mine = await f.me('pubr');
    assert.deepEqual(mine.positions, ['pr', 'tech']);
    assert.ok(mine.permissions.includes('events.manage') && mine.permissions.includes('classes.manage'));
    assert.equal((await f.me('intern')).permissions.join(), ['classes.checkin', 'equipment.view', 'loans.draft'].join());
    const roster = (await f.request(`/api/org/officers?year=${year}`, 'admin')).body;
    assert.equal(roster.assignments.length, 3);
    assert.equal(roster.assignments.find(item => item.position === 'pr').positionName, '活動公關組');
    assert.equal(roster.assignments.every(item => item.status === 'active'), true);
    // someone with officers.manage but without the permissions of a position cannot assign it
    await f.as('mem2', [], { grants: ['officers.manage', 'officers.view'] });
    assert.equal((await f.request('/api/org/officers', 'mem2', 'POST', { year, username: 'mem', position: 'treasurer' })).status, 403);
    assert.equal((await f.request('/api/org/officers', 'mem2', 'POST', { year, username: 'mem', position: 'president' })).status, 403);
    assert.equal((await f.request('/api/org/officers', 'mem2', 'POST', { year, username: 'mem', position: 'intern' })).status, 403, 'cannot give permissions they lack');
    await f.as('mem2', [], { grants: ['officers.manage', 'officers.view', 'classes.checkin', 'equipment.view', 'loans.draft'] });
    assert.equal((await f.request('/api/org/officers', 'mem2', 'POST', { year, username: 'mem', position: 'intern' })).status, 201);
});

test('tenure: mid-term dismissal, replacement (遞補) and the switch to the next 學年 take effect on their dates', async t => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2027-03-10T04:00:00Z') });
    const f = fixture();
    assert.equal(academicYearOf(), '115');
    const a = (await f.request('/api/org/officers', 'admin', 'POST', { year: '115', username: 'treas', position: 'treasurer', note: '第一任' })).body.assignment;
    // the next year's roster is prepared in advance and does not apply yet
    const next = await f.request('/api/org/officers', 'admin', 'POST', { year: '116', username: 'pubr', position: 'pr' });
    assert.equal(next.status, 201);
    assert.equal(next.body.assignment.start, '2027-08-01');
    assert.ok(!(await can(f, 'pubr', 'events.manage')));
    assert.equal((await f.request('/api/org/officers?year=116', 'admin')).body.assignments[0].status, 'upcoming');
    assert.ok(await can(f, 'treas', 'finance.edit'));
    // 中途解任 takes effect on the day, and is kept in the record
    assert.equal((await f.request(`/api/org/officers/115/${a.id}/end`, 'admin', 'POST', { reason: 'resigned' })).status, 200);
    assert.ok(!(await can(f, 'treas', 'finance.edit')));
    const history = (await f.request('/api/org/officers/history?username=treas', 'admin')).body.assignments;
    assert.equal(history[0].status, 'ended');
    assert.equal(history[0].endedReason, 'resigned');
    assert.equal((await f.request(`/api/org/officers/115/${a.id}/end`, 'admin', 'POST', {})).status, 409, 'already ended');
    // 遞補: somebody else takes the position from the given day
    const b = (await f.request('/api/org/officers', 'admin', 'POST', { year: '115', username: 'comm', position: 'treasurer', start: '2027-03-10' })).body.assignment;
    assert.ok(await can(f, 'comm', 'finance.edit'));
    const replaced = await f.request(`/api/org/officers/115/${b.id}/replace`, 'admin', 'POST', { username: 'tech', start: '2027-03-10' });
    assert.equal(replaced.status, 201);
    assert.equal(replaced.body.assignment.replaces, b.id);
    assert.ok(!(await can(f, 'comm', 'finance.edit')) && await can(f, 'tech', 'finance.edit'));
    // last day of the term: the old team still has its permissions…
    t.mock.timers.setTime(Date.parse('2027-07-31T10:00:00Z'));
    assert.ok(await can(f, 'tech', 'finance.edit'));
    assert.ok(!(await can(f, 'pubr', 'events.manage')));
    // …and the next day the new roster takes over automatically, the old one lapses but stays in the history
    t.mock.timers.setTime(Date.parse('2027-08-01T01:00:00Z'));
    assert.equal(academicYearOf(), '116');
    assert.ok(!(await can(f, 'tech', 'finance.edit')));
    assert.ok(await can(f, 'pubr', 'events.manage'));
    assert.equal((await f.request('/api/org/officers?year=115', 'admin')).body.assignments.length, 3, 'past rosters are kept');
    assert.equal((await f.request('/api/org/officers?year=115', 'admin')).body.assignments.find(item => item.username === 'tech').status, 'completed');
    // terms may not overlap
    assert.equal((await f.request('/api/org/terms/116', 'admin', 'PUT', { start: '2027-07-01' })).status, 409);
    assert.equal((await f.request('/api/org/terms', 'admin')).body.terms.length, 2);
});

test('more than the allowed number of simultaneous positions gives a warning (default 3, adjustable)', async () => {
    const f = fixture();
    const year = academicYearOf();
    const post = position => f.request('/api/org/officers', 'admin', 'POST', { year, username: 'pubr', position });
    for (const position of ['pr', 'tech', 'venue']) assert.deepEqual((await post(position)).body.warnings, []);
    const over = await post('secretary');
    assert.equal(over.status, 201, 'a warning, not a block');
    assert.match(over.body.warnings[0], /4 個幹部職位.*上限 3/);
    // interns do not count
    assert.deepEqual((await f.request('/api/org/officers', 'admin', 'POST', { year, username: 'mem', position: 'intern' })).body.warnings, []);
    assert.equal((await f.request('/api/org/settings', 'admin', 'PUT', { officerLimit: 0 })).status, 400);
    assert.equal((await f.request('/api/org/settings', 'admin', 'PUT', { officerLimit: 5 })).status, 200);
    assert.deepEqual((await post('committee')).body.warnings, []);
    assert.equal((await f.request(`/api/org/officers?year=${year}`, 'admin')).body.officerLimit, 5);
});

test('officers fill in their own profile; nobody else can, and non-officers cannot', async () => {
    const f = fixture();
    const year = academicYearOf();
    await f.request('/api/org/officers', 'admin', 'POST', { year, username: 'pubr', position: 'pr' });
    const empty = (await f.request('/api/officers/me', 'pubr')).body;
    assert.equal(empty.canEdit, true);
    assert.equal(empty.assignments[0].position, 'pr');
    const saved = await f.request('/api/officers/me', 'pubr', 'PUT', {
        fields: { name: '林小公', studentId: 'B11000001', department: '電機三', email: 'pr@example.com', phone: '0912-345-678', lineId: 'pr_line', bio: '大家好', duties: '社群經營', handover: '帳號密碼在保險箱' },
        visibility: { name: true, bio: true, photo: false }
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.fields.department, '電機三');
    assert.equal((await f.request('/api/officers/me', 'pubr', 'PUT', { fields: { email: 'not-an-email' } })).status, 400);
    assert.equal((await f.request('/api/officers/me', 'pubr', 'PUT', { fields: { phone: 'call me' } })).status, 400);
    assert.equal((await f.request('/api/officers/me', 'pubr', 'PUT', { fields: { bio: 'x'.repeat(601) } })).status, 400);
    assert.equal((await f.request('/api/officers/me', 'pubr', 'PUT', { photoFileId: 'not-a-file' })).status, 400);
    assert.equal((await f.request('/api/officers/me', 'mem', 'PUT', { fields: { name: '路人' } })).status, 403, 'not an officer');
    assert.equal((await f.request('/api/officers/me', 'mem')).body.canEdit, false);
    // unknown fields are ignored, and the profile is always the caller's own
    await f.request('/api/officers/me', 'pubr', 'PUT', { username: 'admin', fields: { name: '林小公', role: 'president' } });
    assert.equal((await f.request('/api/officers/me', 'admin')).body.profile.fields.name, undefined);
    // the roster for admins shows everything, but the position is assigned and cannot be self-edited
    const row = (await f.request(`/api/org/officers?year=${year}`, 'admin')).body.assignments[0];
    assert.equal(row.profile.fields.phone, '0912-345-678');
    assert.equal((await f.request(`/api/org/officers?year=${year}`, 'pubr')).status, 403);
});

test('a profile photo must be an image from the file library; a public photo must be a public image', async () => {
    const f = fixture();
    const year = academicYearOf();
    await f.request('/api/org/officers', 'admin', 'POST', { year, username: 'pubr', position: 'pr' });
    const add = async (id, extra) => f.env.FILE_STORE.get().fetch('https://file-store/create', { method: 'POST', body: JSON.stringify({ record: { id, name: 'a.png', type: 'png', mime: 'image/png', size: 10, category: 'other', visibility: 'public', uploadedBy: 'admin', ...extra } }) });
    const publicId = '11111111-1111-4111-8111-111111111111', cadreId = '22222222-2222-4222-8222-222222222222', docId = '33333333-3333-4333-8333-333333333333', missing = '44444444-4444-4444-8444-444444444444';
    await add(publicId, {}); await add(cadreId, { visibility: 'cadre' }); await add(docId, { type: 'pdf', mime: 'application/pdf', visibility: 'member' });
    assert.equal((await f.request('/api/officers/me', 'pubr', 'PUT', { photoFileId: missing })).status, 404);
    assert.equal((await f.request('/api/officers/me', 'pubr', 'PUT', { photoFileId: docId })).status, 400);
    assert.equal((await f.request('/api/officers/me', 'pubr', 'PUT', { photoFileId: cadreId, visibility: { photo: true } })).status, 400);
    assert.equal((await f.request('/api/officers/me', 'pubr', 'PUT', { photoFileId: publicId, visibility: { photo: true } })).status, 200);
    assert.equal((await f.request('/api/officers/me', 'pubr', 'PUT', { visibility: { photo: false } })).status, 200);
});

test('the 社長 (officers.manage) can edit another officer\'s profile; other officers cannot', async () => {
    const f = fixture();
    const year = academicYearOf();
    await f.request('/api/org/officers', 'admin', 'POST', { year, username: 'pubr', position: 'pr' });
    await f.request('/api/org/officers', 'admin', 'POST', { year, username: 'tech', position: 'tech' });
    const saved = await f.request('/api/officers/profile/pubr', 'admin', 'PUT', { fields: { name: '林小公', department: '電機三' }, visibility: { name: true } });
    assert.equal(saved.status, 200);
    assert.equal((await f.request('/api/officers/profile/pubr', 'admin')).body.profile.fields.department, '電機三');
    assert.equal((await f.request('/api/officers/me', 'pubr')).body.profile.fields.name, '林小公');
    assert.equal((await f.request('/api/officers/profile/pubr', 'tech', 'PUT', { fields: { name: '亂改' } })).status, 403);
    assert.equal((await f.request('/api/officers/profile/mem', 'admin', 'PUT', { fields: { name: '路人' } })).status, 403, 'not an officer');
});

// ---------- the public page ----------

test('the public /officers page is off by default and only shows what officers marked public', async () => {
    const f = fixture();
    const year = academicYearOf();
    await f.request('/api/org/officers', 'admin', 'POST', { year, username: 'pubr', position: 'pr' });
    await f.request('/api/org/officers', 'admin', 'POST', { year, username: 'tech', position: 'tech' });
    await f.request('/api/org/officers', 'admin', 'POST', { year, username: 'treas', position: 'treasurer' });
    await f.request('/api/officers/me', 'pubr', 'PUT', { fields: { name: '林小公', studentId: 'B11000001', department: '電機三', email: 'pr@example.com', phone: '0912-345-678', lineId: 'pr_line', bio: '我喜歡空拍<script>alert(1)</script>', duties: '社群經營', handover: '密碼在保險箱' }, visibility: { name: true, bio: true } });
    await f.request('/api/officers/me', 'tech', 'PUT', { fields: { name: '隱藏者', phone: '0999-888-777', bio: '不公開' }, visibility: { name: false, bio: false } });
    assert.equal((await f.request('/officers')).status, 404);
    assert.equal((await f.request('/api/public/officers')).status, 404);
    assert.equal((await f.request('/api/org/settings', 'pubr', 'PUT', { publicOfficers: true })).status, 403);
    assert.equal((await f.request('/api/org/settings', 'admin', 'PUT', { publicOfficers: true })).status, 200);
    const page = await f.request('/officers');
    assert.equal(page.status, 200);
    assert.match(page.body, /林小公/);
    assert.match(page.body, /活動公關組/);
    assert.ok(!page.body.includes('<script>alert(1)</script>'), 'user text is escaped');
    assert.match(page.body, /&lt;script&gt;/);
    for (const secret of ['0912-345-678', 'B11000001', 'pr@example.com', 'pr_line', '電機三', '社群經營', '密碼在保險箱', '0999-888-777', '隱藏者', '不公開']) {
        assert.ok(!page.body.includes(secret), `leaked ${secret}`);
    }
    const api = await f.request('/api/public/officers');
    assert.equal(api.status, 200);
    assert.deepEqual(api.body.officers, [{ position: '活動公關組', name: '林小公', bio: '我喜歡空拍<script>alert(1)</script>' }]);
    for (const secret of ['0912-345-678', 'B11000001', 'pr@example.com']) assert.ok(!JSON.stringify(api.body).includes(secret));
    // only the current 學年 is shown: a lapsed roster disappears
    assert.equal(api.body.officers.length, 1);
});

test('the public view function drops every non-public field even if more fields are added later', () => {
    const view = publicOfficerView({ position: '社長', profile: { fields: { name: 'A', phone: '1', studentId: '2', bio: 'hi', secret: 'x' }, photoFileId: 'p', visibility: { name: true, phone: true, studentId: true, secret: true, bio: false, photo: false } } });
    assert.deepEqual(view, { position: '社長', name: 'A' });
});

test('a public photo is only used when the file is a public image', async () => {
    const f = fixture();
    const year = academicYearOf();
    await f.request('/api/org/officers', 'admin', 'POST', { year, username: 'pubr', position: 'pr' });
    const id = '55555555-5555-4555-8555-555555555555';
    const file = visibility => f.env.FILE_STORE.get().fetch(`https://file-store/${visibility === 'gone' ? 'delete' : 'create'}`, { method: 'POST', body: JSON.stringify(visibility === 'gone' ? { id, by: 'x' } : { record: { id, name: 'a.png', type: 'png', mime: 'image/png', size: 10, category: 'other', visibility, uploadedBy: 'admin' } }) });
    await file('public');
    await f.request('/api/officers/me', 'pubr', 'PUT', { fields: { name: '林小公' }, photoFileId: id, visibility: { name: true, photo: true } });
    await f.request('/api/org/settings', 'admin', 'PUT', { publicOfficers: true });
    assert.equal((await f.request('/api/public/officers')).body.officers[0].photoUrl, `/files/${id}`);
    await f.env.FILE_STORE.get().fetch('https://file-store/update', { method: 'POST', body: JSON.stringify({ id, fields: { visibility: 'cadre' }, by: 'admin' }) });
    const hidden = (await f.request('/api/public/officers')).body.officers[0];
    assert.equal(hidden.photoUrl, undefined, 'the photo is dropped once the file is no longer public');
});

// ---------- CSV export ----------

test('CSV export escapes spreadsheet formulas and quotes', async () => {
    assert.equal(csvCell('=1+1'), "'=1+1");
    assert.equal(csvCell('+SUM(A1)'), "'+SUM(A1)");
    assert.equal(csvCell('-2'), "'-2");
    assert.equal(csvCell('@cmd'), "'@cmd");
    assert.equal(csvCell('  =HYPERLINK("x")'), `"'  =HYPERLINK(""x"")"`);
    assert.equal(csvCell('a,b'), '"a,b"');
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(csvCell('line\nbreak'), '"line\nbreak"');
    const f = fixture();
    const year = academicYearOf();
    await f.request('/api/org/officers', 'admin', 'POST', { year, username: 'pubr', position: 'pr' });
    await f.request('/api/officers/me', 'pubr', 'PUT', { fields: { name: '=cmd|\' /C calc\'!A0', department: '@SUM(1)', duties: '+1,2', email: 'a@example.com' } });
    const csv = await f.request(`/api/org/officers.csv?year=${year}`, 'admin');
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('Content-Type'), /text\/csv/);
    assert.match(csv.headers.get('Content-Disposition'), /officers-115\.csv/);
    assert.ok(csv.body.startsWith('學年,職位,姓名,學號,系級'), 'the BOM is dropped by text()');
    assert.ok(officersCsv([]).startsWith('\uFEFF學年'), 'Excel needs the BOM for Chinese');
    assert.ok(csv.body.includes(`"'=cmd|' /C calc'!A0"`) || csv.body.includes("'=cmd|' /C calc'!A0"));
    assert.ok(csv.body.includes("'@SUM(1)") && csv.body.includes(`"'+1,2"`));
    for (const line of csv.body.split('\r\n').slice(1)) for (const cell of line.split(',')) assert.ok(!/^[=+@]/.test(cell.replace(/^"/, '')), cell);
    assert.equal((await f.request(`/api/org/officers.csv?year=${year}`, 'mem')).status, 403);
    assert.equal(officersCsv([]).split('\r\n').length, 2);
});

// ---------- misc ----------

test('officers.view gives read access to the roster (and CSV) but not to changing it', async () => {
    const f = fixture();
    await f.as('mem', ['secretary']);
    const year = academicYearOf();
    assert.equal((await f.request(`/api/org/officers?year=${year}`, 'mem')).status, 200);
    assert.equal((await f.request(`/api/org/officers.csv?year=${year}`, 'mem')).status, 200);
    assert.equal((await f.request('/api/org/officers', 'mem', 'POST', { year, username: 'pubr', position: 'pr' })).status, 403);
    assert.equal((await f.request('/api/org/officers?year=abc', 'mem')).status, 400);
});

test('without an OrgStore the organisation APIs report it instead of failing open', async () => {
    const f = fixture({ withOrg: false });
    assert.equal((await f.request('/api/org/overview', 'admin')).status, 503);
    assert.equal((await f.request('/officers')).status, 404);
    assert.equal((await f.request('/api/users', 'admin', 'PATCH', { username: 'mem', positions: ['pr'] })).status, 503);
});

test('a failing OrgStore denies the request instead of falling back to the old role', async () => {
    const f = fixture();
    f.env.ORG_STORE = { idFromName: name => name, get: () => ({ fetch: async () => Response.json({ error: 'down' }, { status: 500 }) }) };
    const response = await f.request('/api/finance/summary', 'fin');
    assert.equal(response.status, 500);
});

test('the dashboard shows only the sections an account may use', async () => {
    const f = fixture();
    await f.as('intern', ['intern']);
    const html = (await f.request('/admin/dashboard', 'intern')).body;
    assert.ok(!html.includes("showPanel('finance')") && !html.includes("showPanel('members')") && !html.includes("showPanel('users')"));
    assert.ok(html.includes("showPanel('officers')"), 'holders of a position can open the roster page to edit their own profile');
    assert.ok(!html.includes('id="panel-users"') && !html.includes('href="/admin/events"'));
    assert.ok(html.includes("showPanel('equipment')"));
    const admin = (await f.request('/admin/dashboard', 'admin')).body;
    for (const panel of ['finance', 'members', 'users', 'officers']) assert.ok(admin.includes(`showPanel('${panel}')`), panel);
    assert.ok(admin.includes('帳號、職位與權限') && admin.includes('幹部名冊'));
    assert.ok(!admin.includes('帳號與權限<'));
    const body = (await f.request('/admin/dashboard', 'intern')).body;
    assert.match(body, /data-admin="[^"]*&quot;permissions&quot;/);
    void taipeiDate; void POSITIONS;
});

// ---------- more security properties ----------

test('an officer whose position comes only from the roster still signs in while member login is closed', async () => {
    const f = fixture();
    await f.request('/api/site-settings', 'admin', 'PUT', { memberLogin: false });
    assert.equal((await f.request('/api/me', 'mem')).status, 401, 'plain members are closed out');
    await f.request('/api/org/officers', 'admin', 'POST', { year: academicYearOf(), username: 'mem', position: 'intern' });
    assert.equal((await f.request('/api/me', 'mem')).status, 200, 'an intern is an officer, not a plain member');
    assert.equal((await f.me('mem')).role, 'cadre');
});

test('only a president can change the permissions of a president account', async () => {
    const f = fixture();
    await f.as('net', [], { grants: ['users.manage'] });
    assert.equal((await f.request('/api/users', 'net', 'PATCH', { username: 'admin', revokes: ['cms.edit'] })).status, 403);
    assert.equal((await f.request('/api/users', 'net', 'PATCH', { username: 'admin', role: 'member' })).status, 400);
    assert.equal((await f.request('/api/users', 'net', 'PATCH', { username: 'admin', positions: [] })).status, 400);
    await f.as('pres2', ['president']);
    assert.equal((await f.request('/api/users', 'net', 'PATCH', { username: 'pres2', revokes: ['finance.edit'] })).status, 403);
    assert.equal((await f.request('/api/users', 'net', 'PATCH', { username: 'pres2', role: 'member' })).status, 403);
    assert.deepEqual((await f.me('pres2')).permissions, PERMISSION_CODES);
});

test('the daily backup includes the OrgStore (positions, permissions, roster)', async () => {
    const { collectBackup, DURABLE_OBJECTS } = await import('../src/backup.js');
    assert.ok(DURABLE_OBJECTS.some(([binding]) => binding === 'ORG_STORE'));
    const f = fixture();
    await f.request('/api/org/officers', 'admin', 'POST', { year: academicYearOf(), username: 'pubr', position: 'pr' });
    const backup = await collectBackup(f.env);
    const keys = backup.durableObjects.ORG_STORE.map(([key]) => key);
    assert.ok(keys.some(key => key.startsWith('term:')) && keys.some(key => key.startsWith('acct:')) && keys.some(key => key.startsWith('audit:')));
});

test('the member calendar feed uses the resolved permissions, not the stored role', async () => {
    const f = fixture();
    f.store.set('calendar:token:' + 'a'.repeat(32), 'mem');
    f.env.EVENT_STORE = durableObject((await import('../src/events.js')).EventStore);
    await f.as('mem', ['pr']);
    // an officers-only event is visible to the staff of the roster-assigned position
    const created = await f.request('/api/events', 'mem', 'POST', { title: '幹部內部研習', audience: 'officers', startsAt: '2030-01-01T10:00:00+08:00', endsAt: '2030-01-01T12:00:00+08:00', location: 'A' });
    assert.ok([200, 201].includes(created.status), JSON.stringify(created.body));
    const feed = await f.request(`/calendar/member/${'a'.repeat(32)}.ics`);
    assert.equal(feed.status, 200);
    assert.match(feed.body, /幹部內部研習/);
    await f.as('mem', []);
    const after = await f.request(`/calendar/member/${'a'.repeat(32)}.ics`);
    assert.ok(!after.body.includes('幹部內部研習'));
});
