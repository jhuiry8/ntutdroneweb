// HTTP routes for regulations (法規查詢) and the amendment procedure (修正案).
import { DEFAULT_REGULATIONS } from './regulations.js';
import { REGULATION_KINDS, AMENDMENT_ACTIONS, RegulationRuleError, checkAssembly, checkProposalSource, requirementsFor } from './regulation-rules.js';
import { canManageUsers, canViewCms } from './auth.js';
import { readJsonObject } from './request.js';
import { sessionUser } from './session.js';
import { ValidationError, financeText, financeDate, parseStoredList } from './validation.js';
import { REGULATIONS_KEY, REGULATION_AMENDMENTS_KEY } from './kv-keys.js';

export function parseRegulations(json) {
    if (!json) return structuredClone(DEFAULT_REGULATIONS);
    const list = JSON.parse(json);
    if (!Array.isArray(list)) throw new Error('法規資料格式錯誤');
    return list;
}

function regulationKind(regulation) { return REGULATION_KINDS[regulation?.kind] ? regulation.kind : 'bylaw'; }

function rocDate(date) {
    const [year, month, day] = date.slice(0, 10).split('-');
    return `${Number(year) - 1911}.${month}.${day}`;
}

// A proposal to amend, create or repeal a regulation. Nothing changes until it is adopted.
function normalizeAmendmentInput(body, regulations) {
    const action = String(body?.action || 'amend');
    if (!AMENDMENT_ACTIONS[action]) throw new ValidationError('修正案類型無效');
    const reason = String(body?.reason ?? '').trim();
    if (!reason || reason.length > 2000) throw new ValidationError('請填寫修正理由（2,000 字以內）');
    let regulation = null, kind;
    if (action === 'create') {
        kind = String(body?.kind || 'bylaw');
        if (!['bylaw', 'school'].includes(kind)) throw new ValidationError('只能制定新的施行細則，或登錄學校法規');
        if (regulations.length >= 50) throw new ValidationError('法規最多 50 份');
    } else {
        regulation = regulations.find(item => item.id === body?.regulationId);
        if (!regulation) throw new ValidationError('找不到要修正的法規');
        if (regulation.repealed) throw new ValidationError('此法規已廢止');
        kind = regulationKind(regulation);
        if (action === 'repeal' && kind === 'charter') throw new ValidationError('組織章程不可廢止；解散社團依章程第十條第四款另行決議');
    }
    const fields = { action, kind, reason, regulationId: regulation?.id || '', baseRevision: regulation ? (regulation.revision || 0) : null, ...checkProposalSource(kind, body?.source, body?.signers) };
    if (kind === 'bylaw') fields.needsAssembly = body?.needsAssembly === true;
    if (action === 'repeal') return { ...fields, title: regulation.title };
    const title = financeText(body?.title ?? regulation?.title, '法規名稱', 120);
    const category = String(body?.category ?? regulation?.category ?? '').trim() || (kind === 'school' ? '學校法規' : '本社規章');
    const content = String(body?.content ?? '').replace(/\r\n?/g, '\n').trim();
    if (category.length > 40) throw new ValidationError('分類超過允許長度');
    if (!content || content.length > 50000) throw new ValidationError('法規內容不可空白，且不可超過 50,000 字');
    if (regulation && content === regulation.content && title === regulation.title) throw new ValidationError('條文沒有任何變更');
    return { ...fields, title, category, content, baseContent: regulation?.content || '' };
}

// The record of how an amendment was passed. Throws when a threshold is not met.
function resolutionFor(amendment, body) {
    const needs = requirementsFor(amendment.kind, amendment.needsAssembly);
    const resolution = {};
    try {
        if (needs.assembly) resolution.assembly = { date: financeDate(body?.assembly?.date), ...checkAssembly(body?.assembly, needs.assembly === 'major') };
        if (needs.officersMeeting) resolution.officersMeetingDate = financeDate(body?.officersMeetingDate);
        if (needs.presidentApproval) resolution.presidentApprovedAt = financeDate(body?.presidentApprovedAt);
        if (needs.schoolAnnouncement) {
            resolution.schoolAnnouncedAt = financeDate(body?.schoolAnnouncedAt);
            resolution.source = financeText(body?.source, '學校公告來源', 200);
        }
        if (needs.school && body?.schoolApprovedAt) resolution.schoolApprovedAt = financeDate(body.schoolApprovedAt);
    } catch (error) {
        if (error instanceof RegulationRuleError) throw new ValidationError(error.message);
        throw error;
    }
    if (resolution.assembly && resolution.officersMeetingDate && resolution.assembly.date < resolution.officersMeetingDate) throw new ValidationError('社員大會日期不可早於幹部會議日期');
    if (resolution.presidentApprovedAt && [resolution.officersMeetingDate, resolution.assembly?.date].some(date => date && resolution.presidentApprovedAt < date)) throw new ValidationError('社長核定日期不可早於幹部會議或社員大會日期');
    if (resolution.schoolApprovedAt && resolution.assembly && resolution.schoolApprovedAt < resolution.assembly.date) throw new ValidationError('學校核備日期不可早於社員大會日期');
    return resolution;
}

function applyAmendment(regulations, amendment, now) {
    const date = amendment.resolution.schoolApprovedAt || amendment.resolution.presidentApprovedAt || amendment.resolution.schoolAnnouncedAt || amendment.resolution.assembly?.date || now.slice(0, 10);
    const version = amendment.versionLabel || `${rocDate(date)} ${AMENDMENT_ACTIONS[amendment.action]}`;
    if (amendment.action === 'create') {
        regulations.push({ id: crypto.randomUUID(), kind: amendment.kind, title: amendment.title, category: amendment.category, version, content: amendment.content, revision: 1, history: [], lastAmendmentId: amendment.id, updatedAt: now });
        return;
    }
    const regulation = regulations.find(item => item.id === amendment.regulationId);
    const history = Array.isArray(regulation.history) ? regulation.history : [];
    history.push({ revision: regulation.revision || 0, version: regulation.version, title: regulation.title, content: regulation.content, replacedAt: now, replacedBy: amendment.id });
    if (history.length > 20) history.splice(0, history.length - 20);
    regulation.history = history;
    regulation.revision = (regulation.revision || 0) + 1;
    regulation.lastAmendmentId = amendment.id;
    regulation.updatedAt = now;
    if (amendment.action === 'repeal') { regulation.repealed = { date, amendmentId: amendment.id }; regulation.version = version; return; }
    Object.assign(regulation, { title: amendment.title, category: amendment.category, content: amendment.content, version });
}

// Returns a Response for /api/regulations and /api/regulation-amendments*, or null for any other path.
export async function handleRegulationRequest(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // ==================== API: Regulations lookup (法規查詢) ====================
    // Regulations are read-only here. They change only through an amendment that
    // records how it was passed (see regulation-rules.js).
    if (path === '/api/regulations' && method === 'GET') {
        const user = await sessionUser(request, env);
        if (!user) return Response.json({ error: '未授權' }, { status: 401 });
        return Response.json(parseRegulations(await env.DRONE_DB.get(REGULATIONS_KEY)));
    }

    if (path === '/api/regulation-amendments' && ['GET', 'POST'].includes(method)) {
        const user = await sessionUser(request, env);
        if (!user) return Response.json({ error: '未授權' }, { status: 401 });
        const amendments = parseStoredList(await env.DRONE_DB.get(REGULATION_AMENDMENTS_KEY));
        if (method === 'GET') return Response.json(amendments.sort((a, b) => b.proposedAt.localeCompare(a.proposedAt)));
        // Officers file proposals on behalf of whoever raised them (committee, petition, officers' meeting).
        if (!canViewCms(user)) return Response.json({ error: '權限不足：修正案由幹部代為登錄' }, { status: 403 });
        if (amendments.filter(item => item.status === 'proposed' || item.status === 'awaiting_school').length >= 30) return Response.json({ error: '進行中的修正案最多 30 件，請先處理既有提案' }, { status: 400 });
        const regulations = parseRegulations(await env.DRONE_DB.get(REGULATIONS_KEY));
        const amendment = { id: crypto.randomUUID(), ...normalizeAmendmentInput(await readJsonObject(request, 300_000), regulations), status: 'proposed', proposedBy: user.username, proposedAt: new Date().toISOString() };
        amendments.push(amendment);
        if (amendments.length > 300) amendments.splice(0, amendments.length - 300);
        await env.DRONE_DB.put(REGULATION_AMENDMENTS_KEY, JSON.stringify(amendments));
        return Response.json(amendment, { status: 201 });
    }

    const amendmentAction = /^\/api\/regulation-amendments\/([^/]+)\/(adopt|school-approval|close)$/.exec(path);
    if (amendmentAction && method === 'POST') {
        const user = await sessionUser(request, env);
        if (!user) return Response.json({ error: '未授權' }, { status: 401 });
        const [, id, action] = amendmentAction;
        const amendments = parseStoredList(await env.DRONE_DB.get(REGULATION_AMENDMENTS_KEY));
        const amendment = amendments.find(item => item.id === decodeURIComponent(id));
        if (!amendment) return Response.json({ error: '修正案不存在' }, { status: 404 });
        const body = await readJsonObject(request);
        const now = new Date().toISOString();
        if (action === 'close') {
            const outcome = String(body.outcome || '');
            if (!['rejected', 'withdrawn'].includes(outcome)) return Response.json({ error: '結案方式無效' }, { status: 400 });
            if (amendment.status !== 'proposed' && !(amendment.status === 'awaiting_school' && outcome === 'rejected')) return Response.json({ error: '此修正案已結案' }, { status: 409 });
            if (outcome === 'rejected' && !canManageUsers(user)) return Response.json({ error: '只有社長可以登錄未通過結果' }, { status: 403 });
            if (outcome === 'withdrawn' && !canManageUsers(user) && amendment.proposedBy !== user.username) return Response.json({ error: '只有登錄者或社長可以撤回' }, { status: 403 });
            const note = String(body.note || '').trim().slice(0, 500);
            if (outcome === 'rejected' && !note) return Response.json({ error: '請填寫未通過的情形（例如社員大會出席或同意人數未達門檻、學校未核備）' }, { status: 400 });
            Object.assign(amendment, { status: outcome, closedAt: now, closedBy: user.username, closeNote: note });
            await env.DRONE_DB.put(REGULATION_AMENDMENTS_KEY, JSON.stringify(amendments));
            return Response.json(amendment);
        }
        if (!canManageUsers(user)) return Response.json({ error: '只有社長可以登錄表決及核備結果' }, { status: 403 });
        const regulations = parseRegulations(await env.DRONE_DB.get(REGULATIONS_KEY));
        const target = amendment.regulationId ? regulations.find(item => item.id === amendment.regulationId) : null;
        if (amendment.regulationId && (!target || (target.revision || 0) !== amendment.baseRevision)) return Response.json({ error: '此法規在提案後已有其他修正生效，請以最新條文重新提案' }, { status: 409 });
        if (action === 'adopt') {
            if (amendment.status !== 'proposed') return Response.json({ error: '只有提案中的修正案可以登錄通過' }, { status: 409 });
            amendment.resolution = resolutionFor(amendment, body);
            amendment.adoptedAt = now; amendment.adoptedBy = user.username;
            amendment.versionLabel = String(body.version || '').trim().slice(0, 60);
            if (amendment.kind === 'charter' && !amendment.resolution.schoolApprovedAt) amendment.status = 'awaiting_school';
        } else {
            if (amendment.status !== 'awaiting_school') return Response.json({ error: '此修正案不在待學校核備階段' }, { status: 409 });
            amendment.resolution.schoolApprovedAt = financeDate(body.schoolApprovedAt);
        }
        if (action === 'school-approval' || amendment.status !== 'awaiting_school') {
            applyAmendment(regulations, amendment, now);
            amendment.status = 'effective'; amendment.effectiveAt = now;
            await env.DRONE_DB.put(REGULATIONS_KEY, JSON.stringify(regulations));
        }
        await env.DRONE_DB.put(REGULATION_AMENDMENTS_KEY, JSON.stringify(amendments));
        return Response.json(amendment);
    }

    return null;
}
