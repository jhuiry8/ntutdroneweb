// HTTP routes for class check-in (社課簽到): the officers' session list and attendance
// tools, and the public page members open from the QR code (學號＋姓名, like /meeting/<id>).
import { canViewCms } from './auth.js';
import { FREE_TRIAL_CLASSES, MEMBER_LEVELS, membershipStatus } from './membership.js';
import { escapeHtml } from './html.js';
import { findMemberByIdentity } from './meetings.js';
import { MEMBERS_KEY } from './kv-keys.js';
import { parseStoredList } from './validation.js';
import { ClassError, academicYearOf, applyTrialDelta, attendeeFromMember, classCsv, classListView, classView, publicClassView, requireToken, trialSummary } from './classes.js';

const json = (body, status = 200) => Response.json(body, { status });

export async function classStore(env, path, payload) {
    const namespace = env.CLASS_STORE;
    const stub = namespace.get(namespace.idFromName('club-classes'));
    const response = await stub.fetch(`https://class-store${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await response.json();
    if (response.status >= 500) throw new Error(body?.error || 'Class store failed');
    return { status: response.status, body };
}

// Per member: { total, year } attendance counts, or {} when the binding is missing (older deployments, unit tests).
export async function classAttendanceCounts(env, today = new Date()) {
    if (!env.CLASS_STORE) return {};
    // The roster and /api/me must keep working when the class store is down.
    try { return (await classStore(env, '/summary', { year: academicYearOf(today) })).body || {}; }
    catch (error) { console.error('Class attendance counts failed', error?.message || String(error)); return {}; }
}

// ---- Roster (KV) ---------------------------------------------------------
// The roster is one JSON list under members:list, so every write below is a read-modify-write of
// the whole list. Each helper reads right before it writes and changes only the fields it owns
// (trialUses / trialYear, or one appended member), which keeps the window for a lost update to a
// few milliseconds. It cannot be closed without moving the roster into a Durable Object.
async function readRoster(env) { return parseStoredList(await env.DRONE_DB.get(MEMBERS_KEY)); }

// adjustments: [{ memberId, delta, year }]. Applied in one read-modify-write.
export async function adjustTrialUses(env, adjustments, today = new Date()) {
    const members = await readRoster(env);
    let changed = false;
    for (const { memberId, delta, year } of adjustments) {
        const member = members.find(item => item.id === memberId);
        if (member && applyTrialDelta(member, delta, year, today)) { member.updatedAt = new Date().toISOString(); changed = true; }
    }
    if (changed) await env.DRONE_DB.put(MEMBERS_KEY, JSON.stringify(members));
    return changed;
}

// Adds a trial member for a visitor who chose to join. If the 學號 appeared on the roster in the
// meantime, the existing entry is returned unchanged.
async function addTrialMember(env, { name, studentId }, today = new Date()) {
    const members = await readRoster(env);
    const existing = members.find(item => String(item.studentId || '').replace(/\s+/g, '').toUpperCase() === studentId);
    if (existing) return { member: existing, existed: true };
    const now = new Date().toISOString();
    const member = { id: crypto.randomUUID(), name, studentId, email: '', phone: '', position: '', note: '透過社課簽到加入', joinedAt: now.slice(0, 10), level: 'trial', feeStatus: 'unpaid', feeSemester: '', trialUses: 0, trialYear: academicYearOf(today), createdAt: now, updatedAt: now };
    members.push(member);
    await env.DRONE_DB.put(MEMBERS_KEY, JSON.stringify(members));
    return { member, existed: false };
}

// ---- Public page ---------------------------------------------------------

// Failed 學號＋姓名 attempts per IP per class; successful member check-ins are handed back, so a
// whole class on one campus IP can still sign in.
const FAILURES_PER_IP = 30;
const WINDOW_SECONDS = 900;
const COOKIE_SECONDS = 12 * 3600;

async function sha256(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
function cookie(request, name) {
    for (const part of (request.headers.get('Cookie') || '').split(';')) {
        const [key, ...rest] = part.trim().split('=');
        if (key === name) return rest.join('=');
    }
    return '';
}
const deviceCookieName = id => `cls_${id.replace(/-/g, '').slice(0, 24)}`;

function publicPage(id) {
    return `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>社課簽到 | 北科無人機社</title>
<style>:root { color-scheme: dark; } * { box-sizing: border-box; } body { margin: 0; font-family: "Noto Sans TC", system-ui, sans-serif; background: #0b1120; color: #e2e8f0; line-height: 1.7; }
main { max-width: 560px; margin: 0 auto; padding: 24px 16px 64px; } h1 { font-size: 1.4rem; margin: 0 0 4px; } h2 { font-size: 1.1rem; margin: 0 0 8px; }
.card { background: #111a2e; border: 1px solid #23324d; border-radius: 14px; padding: 16px; margin-top: 14px; } .muted { color: #94a3b8; font-size: .9rem; }
input[type=text] { width: 100%; padding: 12px; border-radius: 10px; border: 1px solid #334155; background: #0f172a; color: #e2e8f0; font-size: 1rem; margin-top: 6px; }
label { display: block; margin-top: 10px; font-size: .9rem; color: #cbd5e1; } button { padding: 12px 18px; border-radius: 10px; border: 0; font-size: 1rem; font-weight: 700; cursor: pointer; }
.primary { background: #3b82f6; color: #fff; } .secondary { background: #334155; color: #e2e8f0; } button:disabled { opacity: .5; }
.row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; } .row button { flex: 1; min-width: 90px; } .ok { color: #34d399; font-weight: 700; } .warn { color: #fbbf24; }
.error { background: rgba(239,68,68,.12); border: 1px solid rgba(239,68,68,.4); color: #fecaca; padding: 10px 12px; border-radius: 10px; margin-top: 12px; } .check { display: flex; gap: 8px; align-items: flex-start; } .check input { margin-top: 6px; }</style></head>
<body><main id="app" data-class="${escapeHtml(id)}"><p class="muted">載入中…</p></main><script src="/class.js"></script></body></html>`;
}

function meSummary(entry) {
    const me = { name: entry.name, kind: entry.kind, kindLabel: { member: '社員', trial: '非正式社員', guest: '訪客' }[entry.kind], overLimit: entry.overLimit, approved: entry.approved, joined: entry.joined === true };
    return me;
}

async function handlePublicClass(request, env, deps, path, method) {
    const pageMatch = /^\/class\/([\w-]{1,80})$/.exec(path);
    if (pageMatch && method === 'GET') return new Response(publicPage(pageMatch[1]), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
    const match = /^\/api\/public\/classes\/([\w-]{1,80})(\/checkin)?$/.exec(path);
    if (!match || !env.CLASS_STORE) return json({ error: 'Not Found' }, 404);
    const [, id, action] = match;
    const url = new URL(request.url);
    const found = await classStore(env, '/get', { id });
    if (found.status !== 200) return json({ error: '找不到這場社課' }, 404);
    const session = found.body;
    const deviceToken = cookie(request, deviceCookieName(id));
    const deviceHash = /^[a-f0-9]{64}$/.test(deviceToken) ? await sha256(deviceToken) : '';
    const mine = deviceHash ? session.attendance.find(entry => entry.deviceHash === deviceHash) : null;
    const noCache = { 'Cache-Control': 'no-store' };

    if (!action) {
        if (method !== 'GET') return json({ error: '方法不允許' }, 405);
        let tokenError = '';
        try { requireToken(session, url.searchParams.get('t'), Date.now()); } catch (error) { if (!(error instanceof ClassError)) throw error; tokenError = error.message; }
        return new Response(JSON.stringify({ ...publicClassView(session), tokenError, me: mine ? meSummary(mine) : null }), { headers: { 'Content-Type': 'application/json', ...noCache } });
    }
    if (method !== 'POST') return json({ error: '方法不允許' }, 405);
    const body = await deps.readJsonLimited(request, 8 * 1024);
    // Without a valid, unexpired token nothing about the roster is revealed.
    try { requireToken(session, body?.t, Date.now()); } catch (error) { if (error instanceof ClassError) return json({ error: error.message }, error.status); throw error; }

    const ip = request.headers.get('CF-Connecting-IP') || '';
    const attemptKey = `class-checkin:${id}:${ip || 'unknown'}`;
    if (!(await deps.takeAttempt(env, [{ key: attemptKey, max: FAILURES_PER_IP, windowSeconds: WINDOW_SECONDS }]))) return json({ error: '錯誤次數過多，請 15 分鐘後再試，或洽幹部協助' }, 429);

    const newToken = deviceHash ? deviceToken : Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
    const newDeviceHash = await sha256(newToken);
    const year = academicYearOf(session.date);
    const studentId = String(body?.studentId ?? '').replace(/\s+/g, '').toUpperCase();
    const name = String(body?.name ?? '').trim();
    const roster = await readRoster(env);
    const member = findMemberByIdentity(roster, studentId, name);
    let attendee;
    if (member) attendee = attendeeFromMember(member, year);
    else if (body?.asGuest !== true) return json({ error: '學號或姓名與社員名冊不符。若是第一次來，可以用訪客身分簽到；否則請確認後再試。', notInRoster: true }, 404);
    else {
        if (!studentId || studentId.length > 30 || !name || name.length > 50) return json({ error: '請填寫學號（30 字內）與姓名（50 字內）' }, 400);
        if (roster.some(item => String(item.studentId || '').replace(/\s+/g, '').toUpperCase() === studentId)) return json({ error: '這個學號已在社員名冊中，但姓名不符，請洽幹部協助' }, 409);
        attendee = { kind: 'guest', memberId: '', studentId, name, level: '', paid: null };
        if (body?.join === true) {
            if (roster.some(item => !String(item.studentId || '').trim() && String(item.name || '').replace(/\s+/g, '').toLowerCase() === name.replace(/\s+/g, '').toLowerCase())) return json({ error: '名冊中已有同名但未填學號的社員，請洽幹部補上學號', notInRoster: true }, 409);
            // Check the link, the duplicate and the device before anything is written to the roster.
            const gate = await classStore(env, '/op', { id, op: 'precheck', token: body?.t, attendee, deviceHash: newDeviceHash });
            if (gate.status !== 200) return json(gate.body, gate.status);
            const added = await addTrialMember(env, { name, studentId });
            attendee = { ...attendeeFromMember(added.member, year), joined: !added.existed };
        }
    }

    const result = await classStore(env, '/op', { id, op: 'checkin', actor: { username: 'guest' }, token: body?.t, attendee, deviceHash: newDeviceHash });
    if (result.status !== 200) return json(result.body, result.status);
    // Any successful check-in (visitors and new joiners too) hands its attempt back, so a crowd of newcomers on one campus IP is not throttled.
    await deps.giveBackAttempt(env, [attemptKey]);

    const { entry, created } = result.body;
    if (created && entry.deducted) await settleTrial(env, id, entry, 1);
    // priorUses was read before this request, so it already includes the class when the person is only signing back in.
    const remaining = entry.kind === 'trial' ? Math.max(0, FREE_TRIAL_CLASSES - (attendee.priorUses + (created && entry.deducted ? 1 : 0))) : null;
    return new Response(JSON.stringify({ ...publicClassView(result.body.session), tokenError: '', me: { ...meSummary(entry), remaining } }), { headers: { 'Content-Type': 'application/json', ...noCache, 'Set-Cookie': `${deviceCookieName(id)}=${newToken}; Path=/; HttpOnly; Max-Age=${COOKIE_SECONDS}; Secure; SameSite=Strict` } });
}

// Moves the member's roster counter for a deducted entry. The attendance record is already saved; when
// the roster write fails the entry is flagged so an officer can see the counter was not updated.
async function settleTrial(env, classId, entry, delta) {
    try { await adjustTrialUses(env, [{ memberId: entry.memberId, delta, year: entry.trialYear }]); }
    catch (error) {
        console.error('Trial counter update failed', error?.message || String(error));
        if (delta > 0) await classStore(env, '/op', { id: classId, op: 'sync-failed', actor: { officer: true }, entryId: entry.id }).catch(() => {});
    }
}

// ---- Officer API ---------------------------------------------------------

// Returns a Response for class check-in routes, or null when the path is not one of them.
export async function handleClassRequest(request, env, deps) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (path.startsWith('/api/public/classes/') || /^\/class\/[\w-]{1,80}$/.test(path)) return handlePublicClass(request, env, deps, path, method);
    if (!path.startsWith('/api/classes')) return null;

    const user = await deps.sessionUser(request, env);
    if (!user) return json({ error: '未授權' }, 401);
    if (!canViewCms(user)) return json({ error: '只有幹部可以管理社課簽到' }, 403);
    if (!env.CLASS_STORE) return json({ error: '尚未設定 CLASS_STORE Durable Object' }, 503);
    const actor = { username: user.username, officer: true };
    const view = result => json(result.status === 200 ? classView(result.body.session || result.body) : result.body, result.status);
    const op = (id, name, payload) => classStore(env, '/op', { id, op: name, actor, ...payload });

    if (path === '/api/classes' && method === 'GET') {
        const list = (await classStore(env, '/list', {})).body;
        const roster = await readRoster(env);
        const nowMs = Date.now();
        return json({
            classes: list.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).map(session => classListView(session, nowMs)),
            roster: roster.map(member => ({ id: member.id, name: member.name, studentId: member.studentId, levelLabel: MEMBER_LEVELS[membershipStatus(member).level], ...trialSummary(member) })),
            freeTrialClasses: FREE_TRIAL_CLASSES
        });
    }
    if (path === '/api/classes' && method === 'POST') {
        const created = await classStore(env, '/create', { fields: await deps.readJsonLimited(request, 16 * 1024), actor });
        return json(created.status === 201 ? classView(created.body) : created.body, created.status);
    }

    const match = /^\/api\/classes\/([\w-]{1,80})(?:\/(status|token|attendance|export\.csv))?$/.exec(path);
    if (!match) return json({ error: 'Not Found' }, 404);
    const [, id, action] = match;

    if (!action) {
        if (method === 'GET') return view(await classStore(env, '/get', { id }));
        if (method === 'PATCH') return view(await op(id, 'update', { fields: await deps.readJsonLimited(request, 16 * 1024) }));
        if (method === 'DELETE') {
            const removed = await classStore(env, '/delete', { id, actor });
            if (removed.status !== 200) return json(removed.body, removed.status);
            // Attendance goes with the session, so the free classes it used are given back.
            const refunds = removed.body.session.attendance.filter(entry => entry.deducted && entry.memberId && !entry.syncError).map(entry => ({ memberId: entry.memberId, delta: -1, year: entry.trialYear }));
            if (refunds.length) await adjustTrialUses(env, refunds);
            return json({ success: true });
        }
        return json({ error: '方法不允許' }, 405);
    }

    if (action === 'export.csv') {
        if (method !== 'GET') return json({ error: '方法不允許' }, 405);
        const found = await classStore(env, '/get', { id });
        if (found.status !== 200) return json(found.body, found.status);
        return new Response(classCsv(found.body), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="class-${found.body.date}.csv"`, 'Cache-Control': 'no-store' } });
    }

    if (method !== 'POST') return json({ error: '方法不允許' }, 405);
    const body = await deps.readJsonLimited(request, 16 * 1024);

    if (action === 'status') return view(await op(id, 'status', { status: String(body?.status || '') }));
    if (action === 'token') {
        const result = await op(id, 'token', { ttlMinutes: body?.ttlMinutes });
        if (result.status !== 200) return json(result.body, result.status);
        const session = result.body.session;
        return json({ ...classView(session), checkinPath: `/class/${session.id}?t=${session.token}`, checkinUrl: `${url.origin}/class/${session.id}?t=${session.token}` });
    }

    // attendance: add a roster member or a visitor, remove an entry, or let an over-limit trial entry through.
    if (body?.remove === true || body?.approve === true) {
        const entryId = String(body?.entryId || '');
        const result = await op(id, body.remove ? 'remove' : 'approve', { entryId, approved: body.approved });
        if (result.status !== 200) return json(result.body, result.status);
        const entry = result.body.entry;
        if (result.body.removed && entry.deducted && entry.memberId && !entry.syncError) await settleTrial(env, id, entry, -1);
        return view(result);
    }
    let attendee;
    if (body?.memberId) {
        const found = await classStore(env, '/get', { id });
        if (found.status !== 200) return json(found.body, found.status);
        const member = (await readRoster(env)).find(item => item.id === body.memberId);
        if (!member) return json({ error: '找不到社員' }, 404);
        attendee = attendeeFromMember(member, academicYearOf(found.body.date));
    } else if (body?.guest) {
        const name = String(body.guest.name ?? '').trim(), studentId = String(body.guest.studentId ?? '').replace(/\s+/g, '').toUpperCase();
        if (!name) return json({ error: '請填寫訪客姓名' }, 400);
        attendee = { kind: 'guest', memberId: '', studentId, name, level: '', paid: null };
    } else return json({ error: '請選擇社員或填寫訪客資料' }, 400);
    const result = await op(id, 'add', { attendee });
    if (result.status !== 200) return json(result.body, result.status);
    if (result.body.entry.deducted) await settleTrial(env, id, result.body.entry, 1);
    return view(result);
}
