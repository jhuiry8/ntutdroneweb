// HTTP routes for positions and permissions (職位與權限), the audit log, the officer roster (幹部名冊,
// 學年任期), officers' own profiles and the optional public /officers page.
import { hasPermission, hasAnyPermission } from './auth.js';
import { PERMISSIONS, POSITIONS, PRESIDENT_ONLY_PERMISSIONS } from './permissions.js';
import { orgStoreRequest } from './org-store.js';
import { OrgError, academicYearOf, taipeiDate, officersCsv, validYear, PROFILE_FIELDS, PUBLIC_PROFILE_FIELDS } from './org.js';
import { readJsonObject } from './request.js';
import { sessionUser, listUsers } from './session.js';
import { fileStoreRequest } from './file-store.js';
import { isImageType, visibleLevels } from './files.js';
import { isRealPresident, missingPermissions, positionPermissions } from './org-access.js';
import { MEMBERS_KEY } from './kv-keys.js';
import { renderOfficersPage } from './templates.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const noStore = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };

// A public photo must be an image in the file library whose visibility is public (served without a session).
async function publicPhotoUrl(env, fileId) {
    if (!fileId || !env.FILE_STORE) return '';
    try {
        const { status, body } = await fileStoreRequest(env, 'get', { id: fileId });
        return status === 200 && body.visibility === 'public' && isImageType(body.type) ? `/files/${fileId}` : '';
    } catch { return ''; }
}

async function catalogMap(env) {
    const { body } = await orgStoreRequest(env, 'overview', {});
    return { catalog: Object.fromEntries(body.catalog.map(item => [item.id, item])), overview: body };
}

// Returns a Response for /api/org/*, /api/officers/* and /officers, or null for any other path.
export async function handleOrgRequest(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (path === '/officers' || path === '/api/public/officers') {
        if (method !== 'GET') return null;
        if (!env.ORG_STORE) return new Response('找不到頁面', { status: 404 });
        const { body } = await orgStoreRequest(env, 'public-roster', {});
        // The page is switched on in the roster settings; while it is off it does not exist.
        if (!body.enabled) return path === '/officers' ? new Response('找不到頁面', { status: 404, headers: noStore }) : json({ error: '找不到頁面' }, 404);
        const officers = [];
        for (const item of body.officers) {
            const { photoFileId, year, ...rest } = item;
            officers.push({ ...rest, ...(photoFileId ? { photoUrl: await publicPhotoUrl(env, photoFileId) } : {}) });
        }
        const cleaned = officers.map(item => (item.photoUrl ? item : { position: item.position, name: item.name, bio: item.bio }));
        if (path === '/api/public/officers') return Response.json({ year: body.year, officers: cleaned }, { headers: { 'Cache-Control': 'public, max-age=300' } });
        const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'zh';
        return new Response(renderOfficersPage({ officers: cleaned, year: body.year }, lang), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
    }

    if (!path.startsWith('/api/org/') && !path.startsWith('/api/officers/')) return null;
    const user = await sessionUser(request, env);
    if (!user) return json({ error: '未授權' }, 401);
    if (!env.ORG_STORE) return json({ error: '尚未設定 ORG_STORE（Durable Object），無法使用職位與幹部名冊' }, 503);
    const forbidden = message => json({ error: message || '權限不足' }, 403);
    const org = (op, payload = {}) => orgStoreRequest(env, op, { actor: user.username, actorIsPresident: isRealPresident(user), ...payload });
    const reply = result => json(result.body, result.status);
    const canSeeRoster = hasAnyPermission(user, ['officers.view', 'officers.manage', 'users.manage']);

    // ---------- the signed-in officer's own profile ----------
    if (path === '/api/officers/me' && ['GET', 'PUT'].includes(method)) {
        const history = (await org('history', { username: user.username })).body;
        const mine = history.assignments.map(({ profile, ...entry }) => entry);
        if (method === 'GET') {
            const profile = (await org('profile-get', { username: user.username })).body;
            const members = await fieldDefaults(env, user);
            return json({ username: user.username, assignments: mine, profile, defaults: members, fields: PROFILE_FIELDS, publicFields: PUBLIC_PROFILE_FIELDS, canEdit: mine.some(a => ['active', 'upcoming'].includes(a.status)) });
        }
        const input = await readJsonObject(request, 32 * 1024);
        if (input.photoFileId && !/^[0-9a-f-]{36}$/.test(String(input.photoFileId))) return json({ error: '大頭照檔案編號無效' }, 400);
        if (input.photoFileId) {
            if (!env.FILE_STORE) return json({ error: '尚未設定檔案庫，無法選擇大頭照' }, 503);
            const { status, body } = await fileStoreRequest(env, 'get', { id: String(input.photoFileId) });
            if (status !== 200 || !visibleLevels(user).includes(body.visibility)) return json({ error: '找不到這個檔案' }, 404);
            if (!isImageType(body.type)) return json({ error: '大頭照必須是圖片' }, 400);
            const profile = (await org('profile-get', { username: user.username })).body;
            const wantsPublic = input.visibility?.photo !== undefined ? input.visibility.photo === true : profile.visibility?.photo === true;
            if (wantsPublic && body.visibility !== 'public') return json({ error: '公開顯示的大頭照必須是檔案庫中「公開」的圖片' }, 400);
        } else if (input.visibility?.photo === true) {
            const profile = (await org('profile-get', { username: user.username })).body;
            const photoId = input.photoFileId === undefined ? profile.photoFileId : '';
            if (photoId && !(await publicPhotoUrl(env, photoId))) return json({ error: '公開顯示的大頭照必須是檔案庫中「公開」的圖片' }, 400);
        }
        return reply(await org('profile-set', { username: user.username, input }));
    }

    // ---------- overview, positions and permissions ----------
    // Position names and permission labels are not secret: every signed-in account sees them (the dashboard shows
    // officers their own positions). Who holds what is only in the account list, which needs users.manage.
    if (path === '/api/org/overview' && method === 'GET') {
        const { overview } = await catalogMap(env);
        const manager = hasAnyPermission(user, ['users.manage', 'officers.manage', 'officers.view', 'audit.view']);
        return json({
            permissions: Object.entries(PERMISSIONS).map(([code, item]) => ({ code, ...item, presidentOnly: PRESIDENT_ONLY_PERMISSIONS.includes(code) })),
            positions: overview.catalog, config: manager ? overview.config : { acting: { active: Boolean(overview.config.acting.active) }, officerLimit: overview.config.officerLimit, publicOfficers: overview.config.publicOfficers }, currentYear: academicYearOf(), today: taipeiDate(),
            canManage: hasPermission(user, 'users.manage'), canActing: isRealPresident(user) && hasPermission(user, 'users.manage'), realPresident: isRealPresident(user)
        });
    }

    const positionMatch = /^\/api\/org\/positions\/([a-z][a-z0-9_-]{1,29})$/.exec(path);
    if ((positionMatch && ['PUT', 'DELETE'].includes(method)) || (path === '/api/org/positions' && method === 'POST')) {
        if (!hasPermission(user, 'users.manage')) return forbidden('只有社長可以調整職位與權限');
        const { catalog } = await catalogMap(env);
        if (method === 'DELETE') return reply(await org('position-delete', { id: positionMatch[1] }));
        const body = await readJsonObject(request, 32 * 1024);
        const permissions = Array.isArray(body.permissions) ? body.permissions.map(String) : [];
        // Nobody can put a permission on a position that they do not hold themselves.
        const previous = method === 'PUT' ? catalog[positionMatch[1]]?.permissions || [] : [];
        const lacking = missingPermissions(user, permissions.filter(code => !previous.includes(code)));
        if (lacking.length) return forbidden(`不能授予自己沒有的權限：${lacking.slice(0, 5).join('、')}`);
        if (method === 'POST') return reply(await org('position-create', { id: body.id, name: body.name, description: body.description, permissions }));
        return reply(await org('position-update', { id: positionMatch[1], permissions }));
    }

    if (path === '/api/org/acting' && method === 'PUT') {
        if (!hasPermission(user, 'users.manage') || !isRealPresident(user)) return forbidden('只有社長或系統管理者可以開關代理社長');
        const body = await readJsonObject(request);
        if (typeof body.active !== 'boolean') return json({ error: 'active 必須是 true 或 false' }, 400);
        return reply(await org('acting-set', { active: body.active, note: body.note }));
    }

    if (path === '/api/org/settings' && method === 'PUT') {
        if (!hasPermission(user, 'officers.manage')) return forbidden();
        const body = await readJsonObject(request);
        return reply(await org('settings-set', { officerLimit: body.officerLimit, publicOfficers: body.publicOfficers }));
    }

    if (path === '/api/org/migrate' && method === 'POST') {
        if (!hasPermission(user, 'users.manage')) return forbidden();
        const users = await listUsers(env);
        return reply(await org('migrate-all', { users: users.map(item => ({ username: item.username, legacyRole: item.role })) }));
    }

    if (path === '/api/org/audit' && method === 'GET') {
        if (!hasAnyPermission(user, ['audit.view', 'users.manage'])) return forbidden();
        const params = url.searchParams;
        return reply(await org('audit-list', { limit: params.get('limit'), action: params.get('action') || '', target: params.get('target') || '', actorName: params.get('actor') || '', before: params.get('before') || '' }));
    }

    // ---------- terms and the roster ----------
    if (path === '/api/org/terms' && method === 'GET') {
        if (!canSeeRoster) return forbidden();
        return json({ terms: (await org('terms')).body, currentYear: academicYearOf() });
    }
    const termMatch = /^\/api\/org\/terms\/(\d{3})$/.exec(path);
    if (termMatch && method === 'PUT') {
        if (!hasPermission(user, 'officers.manage')) return forbidden();
        const body = await readJsonObject(request);
        return reply(await org('term-set', { year: termMatch[1], start: body.start, end: body.end }));
    }

    if ((path === '/api/org/officers' || path === '/api/org/officers.csv') && method === 'GET') {
        if (!canSeeRoster) return forbidden();
        let year;
        try { year = validYear(url.searchParams.get('year') || academicYearOf()); } catch (error) { return json({ error: error.message }, 400); }
        const rows = await rosterRows(env, org, year);
        if (path === '/api/org/officers.csv') {
            return new Response(officersCsv(rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="officers-${year}.csv"`, 'Cache-Control': 'no-store' } });
        }
        const terms = (await org('terms')).body;
        const settings = (await orgStoreRequest(env, 'overview', {})).body.config;
        return json({ year, term: terms.find(term => term.year === year) || null, terms, assignments: rows, officerLimit: settings.officerLimit, today: taipeiDate(), canManage: hasPermission(user, 'officers.manage') });
    }

    if (path === '/api/org/officers/history' && method === 'GET') {
        if (!canSeeRoster) return forbidden();
        const username = String(url.searchParams.get('username') || '').toLowerCase();
        const history = (await org('history', { username })).body;
        const { catalog } = await catalogMap(env);
        return json({ username, assignments: history.assignments.map(item => ({ ...item, positionName: catalog[item.position]?.name || item.position, yearLabel: `${item.year} 學年` })) });
    }

    if (path === '/api/org/officers' && method === 'POST') {
        if (!hasPermission(user, 'officers.manage')) return forbidden('沒有指派幹部職位的權限');
        const body = await readJsonObject(request);
        const denied = await cannotGive(env, user, String(body.position || ''));
        if (denied) return json({ error: denied.message }, denied.status);
        const target = await activeAccount(env, body.username);
        if (!target) return json({ error: '找不到這個啟用中的帳號' }, 404);
        return reply(await org('assign', { year: body.year, username: target.username, position: body.position, start: body.start, end: body.end, note: body.note }));
    }

    const assignmentMatch = /^\/api\/org\/officers\/(\d{3})\/([0-9a-f-]{36})(?:\/(end|replace))?$/.exec(path);
    if (assignmentMatch && ['POST', 'PATCH'].includes(method)) {
        if (!hasPermission(user, 'officers.manage')) return forbidden('沒有指派幹部職位的權限');
        const [, year, id, action] = assignmentMatch;
        const body = await readJsonObject(request);
        if (method === 'PATCH' && !action) return reply(await org('assignment-update', { year, id, start: body.start, end: body.end, note: body.note }));
        if (method === 'POST' && action === 'end') return reply(await org('end-assignment', { year, id, effective: body.effective, reason: body.reason }));
        if (method === 'POST' && action === 'replace') {
            const target = await activeAccount(env, body.username);
            if (!target) return json({ error: '找不到這個啟用中的帳號' }, 404);
            const roster = (await org('roster', { year })).body;
            const old = roster.assignments.find(item => item.id === id);
            if (old) { const denied = await cannotGive(env, user, old.position); if (denied) return json({ error: denied.message }, denied.status); }
            return reply(await org('replace-assignment', { year, id, username: target.username, start: body.start, note: body.note }));
        }
        return json({ error: '方法不允許' }, 405);
    }

    return json({ error: 'Not Found' }, 404);
}

// Officers are assigned only positions whose permissions the assigning person holds (the 社長 holds them all).
async function cannotGive(env, actor, position) {
    const { catalog } = await catalogMap(env);
    if (!catalog[position] || position === 'member') return { status: 400, message: '職位無效' };
    if (position === 'president' && !isRealPresident(actor)) return { status: 403, message: '只有社長可以指派社長' };
    const lacking = missingPermissions(actor, positionPermissions(catalog, [position]));
    return lacking.length ? { status: 403, message: `不能指派權限比自己多的職位：${lacking.slice(0, 5).join('、')}` } : null;
}

async function activeAccount(env, username) {
    const name = String(username ?? '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(name)) return null;
    const raw = await env.DRONE_DB.get(`user:${name}`);
    const account = raw ? JSON.parse(raw) : null;
    return account && account.active !== false ? account : null;
}

// Name, student ID and the like prefilled from the roster entry bound to the account (the officer can change them).
async function fieldDefaults(env, user) {
    if (!user.memberId) return {};
    try {
        const members = JSON.parse((await env.DRONE_DB.get(MEMBERS_KEY)) || '[]');
        const member = members.find(item => item.id === user.memberId);
        return member ? { name: member.name || '', studentId: member.studentId || '', email: member.email || '', phone: member.phone || '' } : {};
    } catch { return {}; }
}

async function rosterRows(env, org, year) {
    const { catalog } = await catalogMap(env);
    const roster = (await org('roster', { year })).body;
    const accounts = new Map((await listUsers(env)).map(item => [item.username, item]));
    const memberNames = new Map();
    try { for (const member of JSON.parse((await env.DRONE_DB.get(MEMBERS_KEY)) || '[]')) memberNames.set(member.id, member.name); } catch { /* no roster yet */ }
    return roster.assignments.map(item => ({
        ...item, positionName: catalog[item.position]?.name || item.position, yearLabel: `${item.year} 學年`,
        displayName: memberNames.get(accounts.get(item.username)?.memberId) || item.username
    })).sort((a, b) => (POSITIONS[a.position] ? Object.keys(POSITIONS).indexOf(a.position) : 99) - (POSITIONS[b.position] ? Object.keys(POSITIONS).indexOf(b.position) : 99) || a.start.localeCompare(b.start));
}

