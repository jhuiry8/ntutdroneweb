// OrgStore Durable Object: 職位設定、帳號的職位與個別授權、幹部名冊（學年任期、指派、個人資料）、
// 代理社長開關與稽核紀錄。Every change runs in one transaction and writes an audit entry, so
// concurrent edits cannot overwrite each other and no change goes unrecorded.
//
// Keys
//   config            { positionOverrides, customPositions, acting, officerLimit, publicOfficers }
//   acct:<username>   { positions[], grants[], revokes[], source, updatedAt }  (standing positions)
//   term:<year>       { year, start, end, assignments[] }   (roster of one 學年)
//   profile:<user>    { fields, photoFileId, visibility, updatedAt }
//   audit:<seq>       { seq, at, actor, action, target, detail }
import { isExportRequest, exportStorage } from './do-export.js';
import {
    PERMISSIONS, POSITIONS, LEGACY_ROLE_PERMISSIONS, LEGACY_ROLE_POSITION, PRESIDENT_ONLY_PERMISSIONS, CUSTOM_POSITION_ID, ROLES,
    isPermissionCode, positionCatalog, computePermissions, legacyRoleOf, positionRank
} from './permissions.js';
import {
    OrgError, taipeiDate, validDate, validYear, termDefaults, assignmentActive, assignmentStatus, normalizeProfile, publicOfficerView, addDays, yearLabel
} from './org.js';

const AUDIT_KEEP = 5000;
const MAX_CUSTOM_POSITIONS = 30;
const MAX_ASSIGNMENTS_PER_TERM = 300;
const DEFAULT_CONFIG = { positionOverrides: {}, customPositions: {}, acting: { active: false }, officerLimit: 3, publicOfficers: false };

export async function orgStoreRequest(env, op, payload = {}) {
    if (!env.ORG_STORE) throw new OrgError('此網站尚未設定 ORG_STORE，無法使用職位與幹部名冊', 503);
    const stub = env.ORG_STORE.get(env.ORG_STORE.idFromName('club-org'));
    const response = await stub.fetch(`https://org-store/${op}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await response.json();
    if (response.status >= 500) throw new Error(body?.error || 'Org store failed');
    return { status: response.status, body };
}

const unique = list => [...new Set(list)];
const sameSet = (a, b) => a.length === b.length && a.every(item => b.includes(item));

export class OrgStore {
    constructor(ctx) { this.storage = ctx.storage; }

    async fetch(request) {
        try {
            if (isExportRequest(request)) return exportStorage(this.storage);
            if (request.method !== 'POST') return Response.json({ error: '方法不允許' }, { status: 405 });
            const op = new URL(request.url).pathname.replace(/^\//, '');
            const payload = await request.json();
            const result = await this.storage.transaction(storage => this.run(storage, op, payload));
            return Response.json(result.body, { status: result.status ?? 200 });
        } catch (error) {
            if (error instanceof OrgError) return Response.json({ error: error.message }, { status: error.status });
            console.error('Org store operation failed', error?.message || String(error));
            return Response.json({ error: '職位資料操作失敗' }, { status: 500 });
        }
    }

    // ---------- storage helpers ----------

    async config(storage) {
        const stored = (await storage.get('config')) || {};
        return { ...DEFAULT_CONFIG, ...stored, positionOverrides: { ...(stored.positionOverrides || {}) }, customPositions: { ...(stored.customPositions || {}) }, acting: { ...DEFAULT_CONFIG.acting, ...(stored.acting || {}) } };
    }
    async terms(storage) {
        const entries = await storage.list({ prefix: 'term:' });
        return [...entries.values()].sort((a, b) => b.year.localeCompare(a.year));
    }
    async audit(storage, actor, action, target, detail = {}) {
        const seq = ((await storage.get('meta:audit-seq')) || 0) + 1;
        await storage.put('meta:audit-seq', seq);
        await storage.put(`audit:${String(seq).padStart(12, '0')}`, { seq, at: new Date().toISOString(), actor: String(actor || 'system'), action, target: String(target ?? ''), detail });
        if (seq % 100 === 0) {
            const keys = [...(await storage.list({ prefix: 'audit:' })).keys()];
            if (keys.length > AUDIT_KEEP) await storage.delete(keys.slice(0, keys.length - AUDIT_KEEP));
        }
    }

    // The standing account record; created from the old role on first sight (idempotent migration).
    async account(storage, username, legacyRole, catalog) {
        const key = `acct:${username}`;
        const stored = await storage.get(key);
        if (stored) return { record: stored, migrated: false };
        const role = ROLES.includes(legacyRole) ? legacyRole : 'member';
        const position = LEGACY_ROLE_POSITION[role];
        const base = catalog[position]?.permissions || [];
        // Old finance accounts keep every ability the old role had (the 總務 position alone is narrower).
        const grants = (LEGACY_ROLE_PERMISSIONS[role] || []).filter(code => !base.includes(code));
        const record = { positions: position === 'member' ? [] : [position], grants, revokes: [], source: `migrated:${role}`, updatedAt: new Date().toISOString() };
        await storage.put(key, record);
        await this.audit(storage, 'system', 'account.migrate', username, { role, positions: record.positions, grants });
        return { record, migrated: true };
    }

    async resolve(storage, { username, legacyRole }, ctx) {
        const { config, catalog, terms, today } = ctx;
        const { record, migrated } = await this.account(storage, username, username === 'admin' ? 'president' : legacyRole, catalog);
        const rosterPositions = [];
        for (const term of terms) for (const a of term.assignments) {
            if (a.username === username && assignmentActive(a, today)) rosterPositions.push({ position: a.position, year: term.year, id: a.id });
        }
        let held = unique([...record.positions, ...rosterPositions.map(item => item.position)].filter(id => catalog[id]));
        if (username === 'admin' && !held.includes('president')) held.push('president');
        const realPresident = held.includes('president');
        const actingActive = Boolean(config.acting.active);
        const actingApplied = actingActive && held.includes('vice') && !realPresident;
        let permissions = computePermissions({ positions: held, grants: record.grants, revokes: record.revokes, catalog, acting: actingActive });
        // A president can never be locked out of account and permission management.
        if (realPresident && !permissions.includes('users.manage')) permissions = [...permissions, 'users.manage'];
        held.sort((a, b) => positionRank(a) - positionRank(b));
        return {
            username, positions: held, standing: record.positions, roster: rosterPositions, grants: record.grants, revokes: record.revokes, permissions,
            role: legacyRoleOf(held, catalog), realPresident, acting: actingApplied, migrated
        };
    }

    async context(storage, today = taipeiDate()) {
        const config = await this.config(storage);
        return { config, catalog: positionCatalog(config), terms: await this.terms(storage), today };
    }

    // ---------- operations ----------

    async run(storage, op, payload) {
        const actor = String(payload.actor || 'system');
        const today = payload.today ? validDate(payload.today) : taipeiDate();
        switch (op) {
            case 'resolve': {
                const ctx = await this.context(storage, today);
                return { body: await this.resolve(storage, payload, ctx) };
            }
            case 'resolve-many': {
                const ctx = await this.context(storage, today);
                const result = {};
                for (const item of payload.users || []) result[item.username] = await this.resolve(storage, item, ctx);
                return { body: result };
            }
            case 'overview': {
                const ctx = await this.context(storage, today);
                const accounts = {};
                for (const [key, value] of (await storage.list({ prefix: 'acct:' })).entries()) accounts[key.slice(5)] = value;
                return { body: { catalog: Object.values(ctx.catalog), config: { acting: ctx.config.acting, officerLimit: ctx.config.officerLimit, publicOfficers: ctx.config.publicOfficers }, accounts } };
            }
            case 'position-update': return this.positionUpdate(storage, actor, payload);
            case 'position-create': return this.positionCreate(storage, actor, payload);
            case 'position-delete': return this.positionDelete(storage, actor, payload);
            case 'account-set': return this.accountSet(storage, actor, payload);
            case 'account-from-role': return this.accountFromRole(storage, actor, payload);
            case 'acting-set': return this.actingSet(storage, actor, payload);
            case 'settings-set': return this.settingsSet(storage, actor, payload);
            case 'position-holders': {
                // Who holds one of these positions today: standing positions plus active roster assignments.
                const ctx = await this.context(storage, today);
                const wanted = new Set((payload.positions || []).map(String));
                const found = new Map();
                const add = (username, position) => { if (wanted.has(position)) found.set(username, [...(found.get(username) || []), position]); };
                for (const [key, value] of (await storage.list({ prefix: 'acct:' })).entries()) for (const id of value.positions) add(key.slice(5), id);
                for (const term of ctx.terms) for (const a of term.assignments) if (assignmentActive(a, today)) add(a.username, a.position);
                return { body: { holders: [...found.entries()].map(([username, positions]) => ({ username, positions: unique(positions) })) } };
            }
            case 'terms': {
                const terms = await this.terms(storage);
                return { body: terms.map(term => ({ year: term.year, start: term.start, end: term.end, count: term.assignments.length, current: term.start <= today && today <= term.end })) };
            }
            case 'term-set': return this.termSet(storage, actor, payload);
            case 'assign': return this.assign(storage, actor, payload, today);
            case 'end-assignment': return this.endAssignment(storage, actor, payload, today);
            case 'replace-assignment': return this.replaceAssignment(storage, actor, payload, today);
            case 'assignment-update': return this.assignmentUpdate(storage, actor, payload);
            case 'roster': return this.roster(storage, payload, today);
            case 'history': return this.history(storage, payload, today);
            case 'profile-get': return { body: (await storage.get(`profile:${payload.username}`)) || { fields: {}, photoFileId: '', visibility: {} } };
            case 'profile-set': return this.profileSet(storage, actor, payload, today);
            case 'public-roster': return this.publicRoster(storage, today);
            case 'audit-list': return this.auditList(storage, payload);
            case 'audit-add': await this.audit(storage, actor, String(payload.action), payload.target, payload.detail || {}); return { body: { ok: true } };
            case 'migrate-all': {
                const ctx = await this.context(storage, today);
                let created = 0;
                for (const item of payload.users || []) if ((await this.resolve(storage, item, ctx)).migrated) created++;
                return { body: { total: (payload.users || []).length, migrated: created } };
            }
            default: return { status: 404, body: { error: '不支援的操作' } };
        }
    }

    // ---------- positions ----------

    validPermissionList(list) {
        if (!Array.isArray(list)) throw new OrgError('權限清單格式錯誤');
        const bad = list.find(code => !isPermissionCode(code));
        if (bad !== undefined) throw new OrgError(`未知的權限代碼：${String(bad).slice(0, 40)}`);
        return unique(list);
    }
    async positionUpdate(storage, actor, { id, permissions }) {
        const config = await this.config(storage);
        const catalog = positionCatalog(config);
        const position = catalog[id];
        if (!position) throw new OrgError('職位不存在', 404);
        if (position.locked) throw new OrgError('社長職位固定擁有全部權限，不能修改', 403);
        const next = this.validPermissionList(permissions);
        if (next.some(code => PRESIDENT_ONLY_PERMISSIONS.includes(code))) throw new OrgError('帳號管理權限只能由社長個別授予，不能加進職位', 403);
        const before = position.permissions;
        if (position.builtin) config.positionOverrides[id] = next; else config.customPositions[id] = { ...config.customPositions[id], permissions: next };
        await storage.put('config', config);
        await this.audit(storage, actor, 'position.permissions', id, { name: position.name, before, after: next });
        return { body: positionCatalog(config)[id] };
    }
    async positionCreate(storage, actor, { id, name, permissions, description }) {
        const config = await this.config(storage);
        const key = String(id ?? '').trim();
        if (!CUSTOM_POSITION_ID.test(key)) throw new OrgError('職位代號須為 2–30 位小寫英數、底線或連字號，並以英文字母開頭');
        if (POSITIONS[key] || config.customPositions[key]) throw new OrgError('職位代號已存在', 409);
        const label = String(name ?? '').trim();
        if (!label || label.length > 30) throw new OrgError('職位名稱為必填，且不可超過 30 字');
        if (Object.keys(config.customPositions).length >= MAX_CUSTOM_POSITIONS) throw new OrgError(`自訂職位最多 ${MAX_CUSTOM_POSITIONS} 個`);
        const list = this.validPermissionList(permissions ?? []);
        if (list.some(code => PRESIDENT_ONLY_PERMISSIONS.includes(code))) throw new OrgError('帳號管理權限只能由社長個別授予，不能加進職位', 403);
        config.customPositions[key] = { name: label, description: String(description ?? '').trim().slice(0, 200), permissions: list };
        await storage.put('config', config);
        await this.audit(storage, actor, 'position.create', key, { name: label, permissions: list });
        return { status: 201, body: positionCatalog(config)[key] };
    }
    async positionDelete(storage, actor, { id }) {
        const config = await this.config(storage);
        if (!config.customPositions[id]) throw new OrgError(POSITIONS[id] ? '內建職位不能刪除，可改用「恢復預設權限」' : '職位不存在', POSITIONS[id] ? 403 : 404);
        const users = [];
        for (const [key, value] of (await storage.list({ prefix: 'acct:' })).entries()) if (value.positions.includes(id)) users.push(key.slice(5));
        for (const term of await this.terms(storage)) for (const a of term.assignments) if (a.position === id) users.push(a.username);
        if (users.length) throw new OrgError(`仍有 ${unique(users).length} 個帳號擔任此職位，請先移除再刪除`, 409);
        const removed = config.customPositions[id];
        delete config.customPositions[id];
        await storage.put('config', config);
        await this.audit(storage, actor, 'position.delete', id, { name: removed.name, permissions: removed.permissions });
        return { body: { success: true } };
    }

    // ---------- accounts ----------

    async accountSet(storage, actor, { username, positions, grants, revokes, actorIsPresident, legacyRole, resetGrants }) {
        const name = String(username || '');
        if (!name) throw new OrgError('缺少帳號');
        const ctx = await this.context(storage);
        const { catalog } = ctx;
        const current = (await this.account(storage, name, legacyRole, catalog)).record;
        if ((current.positions.includes('president') || name === 'admin') && !actorIsPresident) throw new OrgError('只有社長可以修改社長帳號的職位與權限', 403);
        const next = { ...current };
        if (positions !== undefined) {
            if (!Array.isArray(positions)) throw new OrgError('職位清單格式錯誤');
            const list = unique(positions.map(String).filter(id => id !== 'member'));
            const unknown = list.find(id => !catalog[id]);
            if (unknown) throw new OrgError(`職位不存在：${unknown.slice(0, 30)}`);
            next.positions = list;
        }
        if (grants !== undefined) next.grants = this.validPermissionList(grants);
        if (revokes !== undefined) next.revokes = this.validPermissionList(revokes);
        if (resetGrants) { next.grants = []; next.revokes = []; }
        const presidentChange = next.positions.includes('president') !== current.positions.includes('president');
        if (presidentChange && !actorIsPresident) throw new OrgError('只有社長可以任命或解除社長', 403);
        const grantedPresidentOnly = next.grants.filter(code => PRESIDENT_ONLY_PERMISSIONS.includes(code) && !current.grants.includes(code));
        if (grantedPresidentOnly.length && !actorIsPresident) throw new OrgError('帳號管理權限只能由社長授予', 403);
        // The president (and the system administrator) can never lose account management.
        const holdsPresident = next.positions.includes('president') || name === 'admin';
        if (holdsPresident && next.revokes.some(code => PRESIDENT_ONLY_PERMISSIONS.includes(code))) throw new OrgError('社長不能被收回帳號管理權限', 400);
        if (name === 'admin' && !next.positions.includes('president')) throw new OrgError('不可降權主要管理員', 400);
        // A revoke only makes sense for something the person could otherwise have; drop grants that are revoked.
        next.grants = next.grants.filter(code => !next.revokes.includes(code));
        next.updatedAt = new Date().toISOString();
        await storage.put(`acct:${name}`, next);
        const changed = {};
        if (!sameSet(current.positions, next.positions)) changed.positions = { before: current.positions, after: next.positions };
        if (!sameSet(current.grants, next.grants)) changed.grants = { before: current.grants, after: next.grants };
        if (!sameSet(current.revokes, next.revokes)) changed.revokes = { before: current.revokes, after: next.revokes };
        if (Object.keys(changed).length) await this.audit(storage, actor, 'account.permissions', name, changed);
        return { body: { username: name, positions: next.positions, grants: next.grants, revokes: next.revokes, role: legacyRoleOf(next.positions, catalog), changed: Object.keys(changed) } };
    }

    // The old 帳號 role dropdown: the account gets exactly what that role migrates to (positions, legacy grants, no revokes).
    async accountFromRole(storage, actor, { username, role, actorIsPresident }) {
        if (!ROLES.includes(role)) throw new OrgError('角色無效');
        const { catalog } = await this.context(storage);
        const current = (await this.account(storage, username, role, catalog)).record;
        if ((current.positions.includes('president') || username === 'admin') && !actorIsPresident) throw new OrgError('只有社長可以修改社長帳號的職位與權限', 403);
        const position = LEGACY_ROLE_POSITION[role];
        const base = catalog[position]?.permissions || [];
        const next = { positions: position === 'member' ? [] : [position], grants: (LEGACY_ROLE_PERMISSIONS[role] || []).filter(code => !base.includes(code)), revokes: [], source: `role:${role}`, updatedAt: new Date().toISOString() };
        if (next.positions.includes('president') !== current.positions.includes('president') && !actorIsPresident) throw new OrgError('只有社長可以任命或解除社長', 403);
        if (username === 'admin' && role !== 'president') throw new OrgError('不可降權主要管理員', 400);
        await storage.put(`acct:${username}`, next);
        await this.audit(storage, actor, 'account.permissions', username, { role, positions: { before: current.positions, after: next.positions }, grants: { before: current.grants, after: next.grants }, revokes: { before: current.revokes, after: [] } });
        return { body: { username, positions: next.positions, grants: next.grants, revokes: [], role } };
    }

    async actingSet(storage, actor, { active, note }) {
        const config = await this.config(storage);
        const on = active === true;
        if (on === Boolean(config.acting.active)) return { body: config.acting };
        config.acting = on ? { active: true, since: new Date().toISOString(), by: actor, note: String(note ?? '').trim().slice(0, 200) } : { active: false, endedAt: new Date().toISOString(), endedBy: actor };
        await storage.put('config', config);
        await this.audit(storage, actor, on ? 'acting.on' : 'acting.off', 'vice', { note: String(note ?? '').trim().slice(0, 200) });
        return { body: config.acting };
    }

    async settingsSet(storage, actor, { officerLimit, publicOfficers }) {
        const config = await this.config(storage);
        const before = { officerLimit: config.officerLimit, publicOfficers: config.publicOfficers };
        if (officerLimit !== undefined) {
            const limit = Number(officerLimit);
            if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new OrgError('兼任上限需為 1 至 20 的整數');
            config.officerLimit = limit;
        }
        if (publicOfficers !== undefined) config.publicOfficers = publicOfficers === true;
        await storage.put('config', config);
        await this.audit(storage, actor, 'settings.update', 'officers', { before, after: { officerLimit: config.officerLimit, publicOfficers: config.publicOfficers } });
        return { body: { officerLimit: config.officerLimit, publicOfficers: config.publicOfficers } };
    }

    // ---------- terms and assignments ----------

    async termSet(storage, actor, { year, start, end }) {
        const key = validYear(year);
        const defaults = termDefaults(key);
        const existing = await storage.get(`term:${key}`);
        const term = existing || { year: key, start: defaults.start, end: defaults.end, assignments: [] };
        if (start !== undefined) term.start = validDate(start, '開始日');
        if (end !== undefined) term.end = validDate(end, '結束日');
        if (term.start > term.end) throw new OrgError('結束日不可早於開始日');
        for (const other of await this.terms(storage)) {
            if (other.year !== key && other.start <= term.end && term.start <= other.end) throw new OrgError(`與 ${yearLabel(other.year)}（${other.start} ~ ${other.end}）的任期重疊`, 409);
        }
        const outside = term.assignments.find(a => a.start < term.start || a.end > term.end);
        if (outside) throw new OrgError('有指派的任期超出新的學年期間，請先調整該指派', 409);
        await storage.put(`term:${key}`, term);
        await this.audit(storage, actor, existing ? 'term.update' : 'term.create', key, { start: term.start, end: term.end });
        return { status: existing ? 200 : 201, body: term };
    }

    async getTerm(storage, year, create = false) {
        const key = validYear(year);
        const term = await storage.get(`term:${key}`);
        if (term) return term;
        if (!create) throw new OrgError('找不到該學年的名冊', 404);
        const defaults = termDefaults(key);
        for (const other of await this.terms(storage)) {
            if (other.start <= defaults.end && defaults.start <= other.end) throw new OrgError(`與 ${yearLabel(other.year)} 的任期重疊，請先調整學年期間`, 409);
        }
        return { year: key, ...defaults, assignments: [] };
    }

    overlapWarnings(terms, config, catalog, username, candidate) {
        const mine = [];
        for (const term of terms) for (const a of term.assignments) {
            if (a.username !== username || catalog[a.position]?.intern) continue;
            if (a.id === candidate.id) continue;
            const lastDay = a.endedOn ? addDays(a.endedOn, -1) : a.end;
            if (a.start <= candidate.end && candidate.start <= lastDay) mine.push(a);
        }
        const count = mine.length + (catalog[candidate.position]?.intern ? 0 : 1);
        return count > config.officerLimit ? [`${username} 同時擔任 ${count} 個幹部職位，超過學校規定的兼任上限 ${config.officerLimit}（章程第五條第七款）`] : [];
    }

    async assign(storage, actor, { year, username, position, start, end, note, actorIsPresident }, today) {
        const ctx = await this.context(storage, today);
        const name = String(username ?? '').trim().toLowerCase();
        if (!name) throw new OrgError('請選擇帳號');
        if (!ctx.catalog[position] || position === 'member') throw new OrgError('職位無效');
        if (position === 'president' && !actorIsPresident) throw new OrgError('只有社長可以指派社長', 403);
        const term = await this.getTerm(storage, year, true);
        if (term.assignments.length >= MAX_ASSIGNMENTS_PER_TERM) throw new OrgError(`每個學年最多 ${MAX_ASSIGNMENTS_PER_TERM} 筆指派`, 409);
        const assignment = {
            id: crypto.randomUUID(), username: name, position,
            start: start ? validDate(start, '任期開始日') : term.start, end: end ? validDate(end, '任期結束日') : term.end,
            note: String(note ?? '').trim().slice(0, 200), createdAt: new Date().toISOString(), createdBy: actor
        };
        if (assignment.start > assignment.end) throw new OrgError('任期結束日不可早於開始日');
        if (assignment.start < term.start || assignment.end > term.end) throw new OrgError(`任期必須在 ${yearLabel(term.year)}（${term.start} ~ ${term.end}）之內`);
        const clash = term.assignments.find(a => a.username === name && a.position === position && assignmentStatus(a, today) !== 'replaced' && !(a.endedOn && a.endedOn <= assignment.start)
            && a.start <= assignment.end && assignment.start <= (a.endedOn ? addDays(a.endedOn, -1) : a.end));
        if (clash) throw new OrgError('此帳號在該期間已擔任相同職位', 409);
        const warnings = this.overlapWarnings(ctx.terms, ctx.config, ctx.catalog, name, assignment);
        if (!(await storage.get(`term:${term.year}`))) await this.audit(storage, actor, 'term.create', term.year, { start: term.start, end: term.end });
        term.assignments.push(assignment);
        await storage.put(`term:${term.year}`, term);
        await this.audit(storage, actor, 'officer.assign', name, { year: term.year, position, start: assignment.start, end: assignment.end });
        return { status: 201, body: { assignment, warnings } };
    }

    findAssignment(term, id) {
        const assignment = term.assignments.find(a => a.id === id);
        if (!assignment) throw new OrgError('找不到這筆指派', 404);
        return assignment;
    }

    async endAssignment(storage, actor, { year, id, effective, reason, actorIsPresident }, today) {
        const term = await this.getTerm(storage, year);
        const assignment = this.findAssignment(term, id);
        if (assignment.position === 'president' && !actorIsPresident) throw new OrgError('只有社長可以解除社長', 403);
        if (assignment.endedOn && assignment.endedOn <= today) throw new OrgError('此指派已經結束', 409);
        const on = effective ? validDate(effective, '解任生效日') : today;
        if (!['dismissed', 'resigned', 'completed'].includes(reason ?? 'dismissed')) throw new OrgError('解任原因無效');
        Object.assign(assignment, { endedOn: on, endedReason: reason ?? 'dismissed', endedBy: actor });
        await storage.put(`term:${term.year}`, term);
        await this.audit(storage, actor, 'officer.end', assignment.username, { year: term.year, position: assignment.position, endedOn: on, reason: assignment.endedReason });
        return { body: { assignment } };
    }

    // 遞補：the old holder ends on the start date and the new one takes the same position from then on (章程第八條).
    async replaceAssignment(storage, actor, { year, id, username, start, note, actorIsPresident }, today) {
        const ctx = await this.context(storage, today);
        const term = await this.getTerm(storage, year);
        const old = this.findAssignment(term, id);
        if (old.position === 'president' && !actorIsPresident) throw new OrgError('只有社長可以更換社長', 403);
        const name = String(username ?? '').trim().toLowerCase();
        if (!name || name === old.username) throw new OrgError('請選擇接任的帳號');
        const from = start ? validDate(start, '接任日') : today;
        if (from < old.start || from > old.end) throw new OrgError('接任日必須在原任期之內');
        old.endedOn = from; old.endedReason = 'replaced'; old.endedBy = actor;
        const next = { id: crypto.randomUUID(), username: name, position: old.position, start: from, end: old.end, note: String(note ?? '').trim().slice(0, 200), replaces: old.id, createdAt: new Date().toISOString(), createdBy: actor };
        const warnings = this.overlapWarnings(ctx.terms, ctx.config, ctx.catalog, name, next);
        term.assignments.push(next);
        await storage.put(`term:${term.year}`, term);
        await this.audit(storage, actor, 'officer.replace', name, { year: term.year, position: old.position, from: old.username, start: from });
        return { status: 201, body: { assignment: next, replaced: old, warnings } };
    }

    async assignmentUpdate(storage, actor, { year, id, start, end, note }) {
        const term = await this.getTerm(storage, year);
        const assignment = this.findAssignment(term, id);
        const before = { start: assignment.start, end: assignment.end, note: assignment.note };
        const next = { start: start !== undefined ? validDate(start, '任期開始日') : assignment.start, end: end !== undefined ? validDate(end, '任期結束日') : assignment.end };
        if (next.start > next.end) throw new OrgError('任期結束日不可早於開始日');
        if (next.start < term.start || next.end > term.end) throw new OrgError('任期必須在學年期間之內');
        Object.assign(assignment, next);
        if (note !== undefined) assignment.note = String(note ?? '').trim().slice(0, 200);
        await storage.put(`term:${term.year}`, term);
        await this.audit(storage, actor, 'officer.update', assignment.username, { year: term.year, position: assignment.position, before, after: { start: assignment.start, end: assignment.end, note: assignment.note } });
        return { body: { assignment } };
    }

    async withProfiles(storage, rows) {
        const profiles = new Map();
        for (const row of rows) if (!profiles.has(row.username)) profiles.set(row.username, (await storage.get(`profile:${row.username}`)) || { fields: {}, photoFileId: '', visibility: {} });
        return rows.map(row => ({ ...row, profile: profiles.get(row.username) }));
    }

    async roster(storage, { year }, today) {
        const key = validYear(year);
        const term = await storage.get(`term:${key}`);
        if (!term) return { body: { term: null, assignments: [] } };
        const rows = term.assignments.map(a => ({ ...a, year: term.year, status: assignmentStatus(a, today) }));
        return { body: { term: { year: term.year, start: term.start, end: term.end }, assignments: await this.withProfiles(storage, rows) } };
    }

    async history(storage, { username }, today) {
        const rows = [];
        for (const term of await this.terms(storage)) for (const a of term.assignments) if (a.username === username) rows.push({ ...a, year: term.year, status: assignmentStatus(a, today) });
        return { body: { assignments: await this.withProfiles(storage, rows), today } };
    }

    async profileSet(storage, actor, { username, input }, today) {
        const history = (await this.history(storage, { username }, today)).body.assignments;
        // Only people who hold (or are about to hold) an officer position keep a roster profile.
        if (!history.some(a => ['active', 'upcoming'].includes(a.status))) throw new OrgError('只有現任或即將上任的幹部可以填寫幹部資料', 403);
        const current = (await storage.get(`profile:${username}`)) || {};
        const next = { ...normalizeProfile(input || {}, current), updatedAt: new Date().toISOString() };
        await storage.put(`profile:${username}`, next);
        await this.audit(storage, actor, 'officer.profile', username, { fields: Object.keys(input?.fields || {}), photo: input?.photoFileId !== undefined, visibility: Object.keys(input?.visibility || {}) });
        return { body: next };
    }

    async publicRoster(storage, today) {
        const ctx = await this.context(storage, today);
        if (!ctx.config.publicOfficers) return { body: { enabled: false, officers: [] } };
        const rows = [];
        for (const term of ctx.terms) for (const a of term.assignments) if (assignmentActive(a, today)) rows.push({ ...a, year: term.year });
        const withProfiles = await this.withProfiles(storage, rows);
        const officers = withProfiles
            .sort((a, b) => positionRank(a.position) - positionRank(b.position) || a.start.localeCompare(b.start))
            .map(row => ({ ...publicOfficerView({ profile: row.profile, position: ctx.catalog[row.position].name }), year: row.year }))
            .filter(view => view.name || view.bio || view.photoFileId);
        return { body: { enabled: true, year: ctx.terms.find(term => term.start <= today && today <= term.end)?.year || '', officers } };
    }

    async auditList(storage, { limit, action, target, actorName, before }) {
        const entries = [...(await storage.list({ prefix: 'audit:' })).values()].reverse();
        const max = Math.min(Math.max(Number(limit) || 100, 1), 500);
        const filtered = entries.filter(entry => (!action || entry.action.startsWith(String(action))) && (!target || entry.target === String(target)) && (!actorName || entry.actor === String(actorName)) && (!before || entry.seq < Number(before)));
        return { body: { entries: filtered.slice(0, max), more: filtered.length > max } };
    }
}

export { PERMISSIONS };
