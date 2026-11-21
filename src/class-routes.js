// HTTP routes for class check-in (社課簽到): the officers' session list and attendance
// tools, and the public page members open from the QR code (學號＋姓名, like /meeting/<id>).
import { canViewCms } from './auth.js';
import { FREE_TRIAL_CLASSES, MEMBER_LEVELS, membershipStatus } from './membership.js';
import { escapeHtml } from './html.js';
import { findMemberByIdentity } from './meetings.js';
import { MEMBERS_KEY } from './kv-keys.js';
import { parseStoredList } from './validation.js';
import { ClassError, academicYearOf, applyTrialDelta, attendeeFromMember, classCsv, classListView, classView, publicClassView, requireToken, trialSummary, trialUsesIn, publicListView, compareAttendance, rosterCsv, classStartsAt } from './classes.js';
import { confirmedOf, waitlistOf, taipeiParts } from './events.js';
import { captchaStore, verifyTurnstile } from './session.js';
import { createCaptcha, verifyCaptcha } from './captcha.js';
import { readPushSettings } from './message-routes.js';
import { pushNotice } from './messages.js';

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

// ---- Public listing and pre-registration (事先報名) ---------------------------------

const REG_GUEST_PER_IP = 20;       // per IP per hour
const REG_PER_CLASS_PER_DAY = 400; // per class per day

function listingPage() {
    return `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>社課列表與報名 | 北科無人機社</title>
<style>:root { color-scheme: light dark; --bg:#f5f7fa; --fg:#14202b; --card:#fff; --line:#d5dce3; --muted:#5b6b7a; --accent:#1b5fc4; --ok:#0a7a4b; --warn:#9a5b00; --bad:#b42318; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#0b1120; --fg:#e2e8f0; --card:#111a2e; --line:#23324d; --muted:#94a3b8; --accent:#60a5fa; --ok:#34d399; --warn:#fbbf24; --bad:#f87171; } }
:root[data-theme="dark"] { --bg:#0b1120; --fg:#e2e8f0; --card:#111a2e; --line:#23324d; --muted:#94a3b8; --accent:#60a5fa; --ok:#34d399; --warn:#fbbf24; --bad:#f87171; }
* { box-sizing: border-box; } body { margin: 0; font-family: "Noto Sans TC", system-ui, sans-serif; background: var(--bg); color: var(--fg); line-height: 1.7; }
main { max-width: 720px; margin: 0 auto; padding: 24px 16px 64px; } h1 { font-size: 1.4rem; margin: 0 0 4px; } h2 { font-size: 1.1rem; margin: 0 0 4px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px; margin-top: 14px; } .muted { color: var(--muted); font-size: .9rem; }
input[type=text] { width: 100%; padding: 10px; border-radius: 10px; border: 1px solid var(--line); background: var(--bg); color: var(--fg); font: inherit; margin-top: 4px; }
label { display: block; margin-top: 10px; font-size: .9rem; } button { padding: 10px 16px; border-radius: 10px; border: 0; font: inherit; font-weight: 700; cursor: pointer; background: var(--accent); color: #fff; }
button.secondary { background: transparent; color: var(--fg); border: 1px solid var(--line); } button:disabled { opacity: .5; }
.row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; align-items: center; } .ok { color: var(--ok); font-weight: 700; } .warn { color: var(--warn); } .bad { color: var(--bad); }
.pill { display: inline-block; padding: 1px 10px; border-radius: 999px; font-size: .8rem; border: 1px solid currentColor; } .msg { margin-top: 10px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 10px; } .captcha svg { background: #fff; border-radius: 6px; max-width: 100%; height: auto; }</style></head>
<body><main id="app"><p class="muted">載入中…</p></main><script src="/class-register.js"></script></body></html>`;
}

// Roster member behind a signed-in account (null when the account is not bound to a roster entry).
async function memberOfUser(env, user) {
    if (!user?.memberId) return null;
    return (await readRoster(env)).find(item => item.id === user.memberId) || null;
}
function trialInfo(member, session, today = new Date()) {
    if (!member || membershipStatus(member, today).level !== 'trial') return null;
    const used = trialUsesIn(member, academicYearOf(session.date), today);
    const remaining = Math.max(0, FREE_TRIAL_CLASSES - used);
    return { remaining, limit: FREE_TRIAL_CLASSES, needsFee: remaining === 0 };
}
// Describes a signed-in account as a registrant.
function whoFromUser(user, member, today = new Date()) {
    if (member) {
        const status = membershipStatus(member, today);
        return { kind: status.level === 'trial' ? 'trial' : 'member', memberId: member.id, studentId: member.studentId || '', name: member.name || user.username, level: status.level, username: user.username };
    }
    return { kind: 'member', memberId: '', studentId: '', name: user.username, level: '', username: user.username };
}

async function handlePublicListing(request, env, deps, path, method) {
    if (path === '/classes' && method === 'GET') return new Response(listingPage(), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    if (path === '/api/public/classes' && method === 'GET') {
        if (!env.CLASS_STORE) return json({ classes: [], signedIn: false });
        const now = new Date().toISOString();
        const today = taipeiParts(now).date;
        const [list, counts] = await Promise.all([classStore(env, '/list', {}), classStore(env, '/reg/counts', {})]);
        const user = await deps.sessionUser(request, env);
        const mine = user ? (await classStore(env, '/reg/mine', { username: user.username })).body : {};
        const member = user ? await memberOfUser(env, user) : null;
        const classes = list.body.filter(session => session.status === 'open' && session.date >= today)
            .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
            .map(session => ({ ...publicListView(session, counts.body[session.id], now), me: mine[session.id] || null, trial: user ? trialInfo(member, session) : null }));
        return new Response(JSON.stringify({ classes, signedIn: Boolean(user), name: user ? (member?.name || user.username) : '', freeTrialClasses: FREE_TRIAL_CLASSES }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }
    return json({ error: '方法不允許' }, 405);
}

async function handlePublicRegistration(request, env, deps, id, action) {
    if (request.method !== 'POST') return json({ error: '方法不允許' }, 405);
    const found = await classStore(env, '/get', { id });
    if (found.status !== 200) return json({ error: '找不到這場社課' }, 404);
    const session = found.body;
    const input = await deps.readJsonLimited(request, 8 * 1024);
    const user = await deps.sessionUser(request, env);
    const now = new Date().toISOString();
    const done = async result => {
        const counts = (await classStore(env, '/reg/counts', {})).body[id];
        return { ...publicListView(result.session, counts, now) };
    };

    if (action === 'cancel') {
        if (user) {
            const result = await classStore(env, '/reg/cancel', { id, actor: { username: user.username } });
            return result.status === 200 ? json({ class: await done(result.body), promoted: result.body.promoted.length }) : json(result.body, result.status);
        }
        const hash = await sha256(String(input?.token || ''));
        const result = await classStore(env, '/reg/cancel', { id, regId: String(input?.registrationId || ''), cancelHash: hash, actor: {} });
        return result.status === 200 ? json({ class: await done(result.body), promoted: result.body.promoted.length }) : json(result.body, result.status);
    }

    // ---- register ----
    let who, member = null, cancelToken = '';
    if (user) {
        member = await memberOfUser(env, user);
        who = whoFromUser(user, member);
    } else {
        const ip = request.headers.get('CF-Connecting-IP') || '';
        const allowed = await deps.takeAttempt(env, [
            { key: `class-reg:${id}:all`, max: REG_PER_CLASS_PER_DAY, windowSeconds: 86400 },
            ...(ip ? [{ key: `class-reg:ip:${ip}`, max: REG_GUEST_PER_IP, windowSeconds: 3600 }] : [])
        ]);
        if (!allowed) return json({ error: '報名次數過多，請稍後再試' }, 429);
        const human = env.TURNSTILE_SECRET_KEY
            ? await verifyTurnstile(env, String(input?.turnstileToken || ''), ip)
            : await verifyCaptcha(captchaStore(env), String(input?.captchaId || ''), input?.captcha);
        if (!human) return json({ error: '驗證碼錯誤或已過期，請重新輸入' }, 400);
        const studentId = String(input?.studentId ?? '').replace(/\s+/g, '').toUpperCase();
        const name = String(input?.name ?? '').trim();
        if (!studentId || studentId.length > 30 || !name || name.length > 50) return json({ error: '請填寫學號（30 字內）與姓名（50 字內）' }, 400);
        const roster = await readRoster(env);
        member = findMemberByIdentity(roster, studentId, name);
        if (member) {
            const status = membershipStatus(member);
            who = { kind: status.level === 'trial' ? 'trial' : 'member', memberId: member.id, studentId, name: member.name, level: status.level, username: '' };
        } else if (roster.some(item => String(item.studentId || '').replace(/\s+/g, '').toUpperCase() === studentId)) {
            return json({ error: '這個學號已在社員名冊中，但姓名不符，請確認或洽幹部協助' }, 409);
        } else who = { kind: 'guest', memberId: '', studentId, name, level: '', username: '' };
        cancelToken = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
        who.cancelHash = await sha256(cancelToken);
    }
    const result = await classStore(env, '/reg/register', { id, who, actor: { username: who.username } });
    if (result.status !== 200) return json(result.body, result.status);
    const reg = result.body.reg;
    const position = reg.status === 'waitlist' ? waitlistOf(result.body.regs).findIndex(item => item.id === reg.id) + 1 : 0;
    // Trial members are told how many free classes remain; at zero they may still register and an officer decides.
    return json({ registration: { id: reg.id, status: reg.status, position }, ...(cancelToken ? { cancelToken } : {}), trial: trialInfo(member, session), class: await done(result.body) }, 201);
}

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
    if (path === '/api/public/classes/captcha' && method === 'GET') {
        if (env.TURNSTILE_SECRET_KEY) return json({ turnstile: env.TURNSTILE_SITE_KEY || '' });
        const captcha = await createCaptcha(captchaStore(env));
        return json({ captchaId: captcha.id, svg: captcha.svg });
    }
    const match = /^\/api\/public\/classes\/([\w-]{1,80})(\/checkin|\/register|\/cancel)?$/.exec(path);
    if (!match || !env.CLASS_STORE) return json({ error: 'Not Found' }, 404);
    const [, id, rawAction] = match;
    const action = rawAction || '';
    if (action === '/register' || action === '/cancel') return handlePublicRegistration(request, env, deps, id, action.slice(1));
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
    if (path === '/classes' || path === '/api/public/classes') return handlePublicListing(request, env, deps, path, method);
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
        const counts = (await classStore(env, '/reg/counts', {})).body;
        const roster = await readRoster(env);
        const nowMs = Date.now();
        return json({
            classes: list.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).map(session => ({ ...classListView(session, nowMs), registeredCount: counts[session.id]?.confirmed || 0, waitlistCount: counts[session.id]?.waitlist || 0 })),
            roster: roster.map(member => ({ id: member.id, name: member.name, studentId: member.studentId, levelLabel: MEMBER_LEVELS[membershipStatus(member).level], ...trialSummary(member) })),
            freeTrialClasses: FREE_TRIAL_CLASSES
        });
    }
    if (path === '/api/classes' && method === 'POST') {
        const created = await classStore(env, '/create', { fields: await deps.readJsonLimited(request, 16 * 1024), actor });
        return json(created.status === 201 ? classView(created.body) : created.body, created.status);
    }

    const match = /^\/api\/classes\/([\w-]{1,80})(?:\/(status|token|attendance|export\.csv|roster\.csv|registrations)(?:\/([\w-]{1,80}))?)?$/.exec(path);
    if (!match) return json({ error: 'Not Found' }, 404);
    const [, id, action, regId] = match;

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

    if (action === 'roster.csv') {
        if (method !== 'GET') return json({ error: '方法不允許' }, 405);
        const found = await classStore(env, '/reg/list', { id });
        if (found.status !== 200) return json(found.body, found.status);
        return new Response(rosterCsv(found.body.session, found.body.regs), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="class-roster-${found.body.session.date}.csv"`, 'Cache-Control': 'no-store' } });
    }

    if (action === 'registrations') {
        const found = await classStore(env, '/reg/list', { id });
        if (found.status !== 200) return json(found.body, found.status);
        const roster = await readRoster(env);
        const view = ({ session, regs }) => {
            const ordered = [...confirmedOf(regs), ...waitlistOf(regs)];
            return {
                registrations: ordered.map((reg, index) => {
                    const member = reg.memberId ? roster.find(item => item.id === reg.memberId) : null;
                    const trial = trialInfo(member, session);
                    const { cancelHash, key, ...rest } = reg;
                    return { ...rest, order: index + 1, kindLabel: { member: '社員', trial: '非正式社員', guest: '訪客' }[reg.kind] || reg.kind, trialRemaining: trial ? trial.remaining : null, needsFee: trial ? trial.needsFee : false };
                }),
                confirmed: confirmedOf(regs).length, waitlist: waitlistOf(regs).length,
                comparison: compareAttendance(session, regs)
            };
        };
        if (method === 'GET') return json(view(found.body));
        if (method === 'DELETE' && regId) {
            const result = await classStore(env, '/reg/cancel', { id, regId, actor });
            return result.status === 200 ? json(view(result.body)) : json(result.body, result.status);
        }
        if (method !== 'POST' || regId) return json({ error: '方法不允許' }, 405);
        const input = await deps.readJsonLimited(request, 16 * 1024);
        let who;
        if (input?.memberId) {
            const member = roster.find(item => item.id === input.memberId);
            if (!member) return json({ error: '找不到社員' }, 404);
            const status = membershipStatus(member);
            who = { kind: status.level === 'trial' ? 'trial' : 'member', memberId: member.id, studentId: member.studentId || '', name: member.name || member.studentId, level: status.level, username: '' };
        } else if (input?.guest) {
            const name = String(input.guest.name ?? '').trim(), studentId = String(input.guest.studentId ?? '').replace(/\s+/g, '').toUpperCase();
            if (!name) return json({ error: '請填寫姓名' }, 400);
            who = { kind: 'guest', memberId: '', studentId, name, level: '', username: '' };
        } else return json({ error: '請選擇社員或填寫訪客資料' }, 400);
        const result = await classStore(env, '/reg/add', { id, who, force: input?.force === true, actor });
        return result.status === 200 ? json(view(result.body)) : json(result.body, result.status);
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

// ---- Day-before reminder ---------------------------------------------------------
// Runs from the existing daily 20:00 Taipei cron (EVENT_REMINDER_CRON, see worker.js scheduled()); it adds no
// cron of its own. One announcement per class (announcements can only target everyone or officers, so it shows
// the headcount instead of naming anyone), sent once (reminderSentAt).
export async function runClassReminders(env, { now = new Date() } = {}) {
    if (!env.CLASS_STORE || !env.MESSAGE_STORE) return { reminded: 0 };
    const tomorrow = taipeiParts(new Date(now.getTime() + 24 * 3600 * 1000).toISOString()).date;
    const [list, counts, settings] = await Promise.all([classStore(env, '/list', {}), classStore(env, '/reg/counts', {}), readPushSettings(env)]);
    let reminded = 0;
    for (const session of list.body) {
        const count = counts.body[session.id];
        if (session.registrationEnabled !== true || session.status !== 'open' || session.reminderSentAt || session.date !== tomorrow || !count?.confirmed) continue;
        const content = `明天 ${session.date}${session.time ? ` ${session.time}` : ''} 有社課「${session.topic}」${session.location ? `，地點：${session.location}` : ''}${session.instructor ? `，講師：${session.instructor}` : ''}。已報名 ${count.confirmed} 人${count.waitlist ? `、候補 ${count.waitlist} 人` : ''}，已報名的同學請準時出席；無法參加請盡早到社課列表頁取消，讓候補的人遞補。`;
        const stub = env.MESSAGE_STORE.get(env.MESSAGE_STORE.idFromName('club-messages'));
        const response = await stub.fetch('https://message-store/create-announcement', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actor: { username: 'system', name: '社課提醒', officer: true, president: false }, fields: { title: `明日社課提醒：${session.topic}`, content, audience: 'all' } })
        });
        if (!response.ok) { console.error('Class reminder failed', response.status); continue; }
        await classStore(env, '/reg/mark-reminded', { id: session.id });
        reminded++;
        if (settings.enabled && settings.announcements) {
            try { await pushNotice(settings, { title: `明日社課提醒：${session.topic}`, body: content, link: '' }); } catch { /* push is best effort */ }
        }
    }
    return { reminded };
}
