// HTTP routes for meetings (社員大會、幹部會議、法規監察委員會), including
// the AI notice and minutes drafts and the printable minutes page.
import { marked } from 'marked';
import { canViewCms, canManageUsers } from './auth.js';
import { membershipStatus } from './membership.js';
import { sanitizeContent, escapeHtml } from './html.js';
import { aiProvider } from './forms.js';
import { draftMeetingNotice, draftMinutes } from './ai.js';
import { MEETING_TYPES, AGENDA_KINDS, THRESHOLDS, MEETING_STATUSES, meetingView, canSeeMeeting, minutesFacts, publicMeetingView, findMemberByIdentity, ipAllowed } from './meetings.js';

const MEMBERS_KEY = 'members:list';

// All meetings, or [] when the binding is missing (older deployments, unit tests).
export async function listMeetings(env) {
    if (!env.MEETING_STORE) return [];
    return (await meetingStore(env, '/list', {})).body || [];
}
const json = (body, status = 200) => Response.json(body, { status });

export async function meetingStore(env, path, payload) {
    const namespace = env.MEETING_STORE;
    const stub = namespace.get(namespace.idFromName('club-meetings'));
    const response = await stub.fetch(`https://meeting-store${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await response.json();
    if (response.status >= 500) throw new Error(body?.error || 'Meeting store failed');
    return { status: response.status, body };
}

async function roster(env) {
    const raw = await env.DRONE_DB.get(MEMBERS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
}

function attendeeFor(member) {
    return { memberId: member.id, name: member.name || member.studentId || '', voting: membershipStatus(member).voting };
}

// Electorate snapshot when the meeting opens (章程第十條「社員總額」= members with voting rights).
async function defaultTotal(env, type) {
    const statuses = (await roster(env)).map(member => membershipStatus(member));
    if (type === 'committee') return 5;
    if (type === 'officers') return statuses.filter(status => status.level === 'officer' || status.level === 'prep').length;
    return statuses.filter(status => status.voting).length;
}

function noticeFacts(meeting) {
    return {
        會議名稱: meeting.title, 類型: MEETING_TYPES[meeting.type].label, 日期: meeting.date, 時間: meeting.time || '（待補）',
        地點: meeting.location || '（待補）', 線上連結: meeting.onlineUrl || '', 召集人: meeting.convener || '（待補）',
        需要簽到碼: Boolean(meeting.checkInCode),
        議程: meeting.agenda.map((item, index) => ({ 序號: index + 1, 類別: AGENDA_KINDS[item.kind], 案由: item.title, 說明: item.description, 表決門檻: THRESHOLDS[item.threshold].label })),
        關鍵字與補充: meeting.keywords
    };
}

function minutesPage(meeting) {
    const body = sanitizeContent(marked.parse(meeting.minutes.content || ''));
    const stamp = meeting.minutes.finalizedAt ? `定稿：${meeting.minutes.finalizedAt.slice(0, 10)}（${escapeHtml(meeting.minutes.finalizedBy)}）` : '草稿（尚未定稿）';
    return `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(meeting.title)} 會議紀錄</title>
<style>@page { size: A4; margin: 18mm; } body { font-family: "Noto Serif TC", "PMingLiU", serif; color: #111; background: #fff; line-height: 1.8; max-width: 760px; margin: 24px auto; padding: 0 16px; }
h1 { font-size: 20pt; text-align: center; } h2 { font-size: 14pt; margin-top: 18px; } table { border-collapse: collapse; width: 100%; } td, th { border: 1px solid #333; padding: 4px 8px; }
.stamp { text-align: right; color: #555; font-size: 10pt; } .sign { display: flex; justify-content: space-around; margin-top: 48px; } @media print { .no-print { display: none; } }</style></head>
<body><p class="stamp">${stamp}</p>${body}<div class="sign"><span>主席簽名：＿＿＿＿＿＿</span><span>紀錄簽名：＿＿＿＿＿＿</span></div>
<p class="no-print" style="text-align:center; margin-top:24px;"><button onclick="window.print()">列印／另存 PDF</button></p></body></html>`;
}

const GUEST_ATTEMPTS_PER_IP = 30;
const GUEST_WINDOW_SECONDS = 900;
const GUEST_COOKIE_SECONDS = 12 * 3600;

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
const guestCookieName = id => `mtg_${id.replace(/-/g, '').slice(0, 24)}`;

function guestPage(id) {
    return `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>會議簽到與投票 | 北科無人機社</title>
<style>:root { color-scheme: dark; } * { box-sizing: border-box; } body { margin: 0; font-family: "Noto Sans TC", system-ui, sans-serif; background: #0b1120; color: #e2e8f0; line-height: 1.7; }
main { max-width: 640px; margin: 0 auto; padding: 24px 16px 64px; } h1 { font-size: 1.4rem; margin: 0 0 4px; } h2 { font-size: 1.1rem; margin: 0 0 8px; }
.card { background: #111a2e; border: 1px solid #23324d; border-radius: 14px; padding: 16px; margin-top: 14px; } .muted { color: #94a3b8; font-size: .9rem; }
input { width: 100%; padding: 12px; border-radius: 10px; border: 1px solid #334155; background: #0f172a; color: #e2e8f0; font-size: 1rem; margin-top: 6px; }
label { display: block; margin-top: 10px; font-size: .9rem; color: #cbd5e1; } button { padding: 12px 18px; border-radius: 10px; border: 0; font-size: 1rem; font-weight: 700; cursor: pointer; }
.primary { background: #3b82f6; color: #fff; } .danger { background: #ef4444; color: #fff; } .secondary { background: #334155; color: #e2e8f0; } button:disabled { opacity: .5; }
.row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; } .row button { flex: 1; min-width: 90px; } .ok { color: #34d399; font-weight: 700; } .bad { color: #f87171; font-weight: 700; } .warn { color: #fbbf24; }
.error { background: rgba(239,68,68,.12); border: 1px solid rgba(239,68,68,.4); color: #fecaca; padding: 10px 12px; border-radius: 10px; margin-top: 12px; } .pre { white-space: pre-wrap; }</style></head>
<body><main id="app" data-meeting="${escapeHtml(id)}"><p class="muted">載入中…</p></main><script src="/meeting.js"></script></body></html>`;
}

// Public pages for members without accounts: check in with 學號＋姓名, then vote.
async function handlePublicMeeting(request, env, deps, path, method) {
    const pageMatch = /^\/meeting\/([\w-]{1,80})$/.exec(path);
    if (pageMatch && method === 'GET') return new Response(guestPage(pageMatch[1]), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    const match = /^\/api\/public\/meetings\/([\w-]{1,80})(?:\/(checkin|ballot))?$/.exec(path);
    if (!match) return json({ error: 'Not Found' }, 404);
    const [, id, action] = match;
    const found = env.MEETING_STORE ? await meetingStore(env, '/get', { id }) : { status: 404 };
    const meeting = found.body;
    if (found.status !== 200 || !meeting.guestAccess || meeting.status === 'draft') return json({ error: '找不到開放簽到的會議' }, 404);
    const token = cookie(request, guestCookieName(id));
    const tokenHash = /^[a-f0-9]{64}$/.test(token) ? await sha256(token) : '';
    const guest = tokenHash ? (meeting.guests || []).find(entry => entry.tokenHash === tokenHash) : null;
    const ip = request.headers.get('CF-Connecting-IP') || '';

    if (!action && method === 'GET') return json(publicMeetingView(meeting, guest?.memberId || ''), 200);
    if (method !== 'POST') return json({ error: '方法不允許' }, 405);
    const body = await deps.readJsonLimited(request, 8 * 1024);

    if (action === 'checkin') {
        // Every attempt counts per IP, so student IDs cannot be guessed in bulk.
        if (!(await deps.takeAttempt(env, [{ key: `meeting-guest:${ip || 'unknown'}`, max: GUEST_ATTEMPTS_PER_IP, windowSeconds: GUEST_WINDOW_SECONDS }]))) return json({ error: '嘗試次數過多，請 15 分鐘後再試' }, 429);
        const member = findMemberByIdentity(await roster(env), body?.studentId, body?.name);
        if (!member) return json({ error: '學號或姓名與社員名冊不符，請確認後再試，或洽主席協助' }, 400);
        const newToken = guest ? token : Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
        const result = await meetingStore(env, '/op', { id, op: 'guest-checkin', actor: { username: 'guest' }, attendee: attendeeFor(member), tokenHash: await sha256(newToken), deviceHash: tokenHash, ip, code: body?.code });
        if (result.status !== 200) return json(result.body, result.status);
        return new Response(JSON.stringify(publicMeetingView(result.body, member.id)), { headers: { 'Content-Type': 'application/json', 'Set-Cookie': `${guestCookieName(id)}=${newToken}; Path=/; HttpOnly; Max-Age=${GUEST_COOKIE_SECONDS}; Secure; SameSite=Strict` } });
    }
    if (action === 'ballot') {
        if (!guest) return json({ error: '請先簽到' }, 403);
        if (!ipAllowed(ip, meeting.allowedIps)) return json({ error: '請連上會場網路後再投票' }, 403);
        const result = await meetingStore(env, '/op', { id, op: 'ballot', actor: { username: 'guest', memberId: guest.memberId }, itemId: String(body?.itemId || ''), choice: body?.choice });
        return json(result.status === 200 ? publicMeetingView(result.body, guest.memberId) : result.body, result.status);
    }
    return json({ error: 'Not Found' }, 404);
}

// Returns a Response for meeting routes, or null when the path is not one of them.
export async function handleMeetingRequest(request, env, deps) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (path.startsWith('/api/public/meetings/') || /^\/meeting\/[\w-]{1,80}$/.test(path)) return handlePublicMeeting(request, env, deps, path, method);
    const printMatch = /^\/admin\/meetings\/([\w-]{1,80})\/minutes$/.exec(path);
    if (!path.startsWith('/api/meetings') && !printMatch) return null;

    const user = await deps.sessionUser(request, env);
    if (!user) return printMatch ? Response.redirect(`${url.origin}/admin`, 302) : json({ error: '未授權' }, 401);
    const members = await roster(env);
    const member = user.memberId ? members.find(entry => entry.id === user.memberId) : null;
    const actor = { username: user.username, officer: canViewCms(user), president: canManageUsers(user), memberId: member?.id || '' };
    const viewer = { officer: actor.officer, memberId: actor.memberId };
    const officerOnly = () => json({ error: '只有幹部可以管理會議' }, 403);

    if (printMatch && method === 'GET') {
        const found = await meetingStore(env, '/get', { id: printMatch[1] });
        if (found.status !== 200 || !canSeeMeeting(found.body, viewer) || (!actor.officer && !found.body.minutes.finalizedAt)) return new Response('找不到會議紀錄', { status: 404 });
        return new Response(minutesPage(found.body), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    }

    if (path === '/api/meetings' && method === 'GET') {
        const list = (await meetingStore(env, '/list', {})).body.filter(meeting => canSeeMeeting(meeting, viewer));
        return json({
            meetings: list.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).map(meeting => meetingView(meeting, viewer)),
            me: { officer: actor.officer, president: actor.president, memberId: actor.memberId, voting: member ? membershipStatus(member).voting : false, name: member?.name || '' },
            options: { types: Object.fromEntries(Object.entries(MEETING_TYPES).map(([key, value]) => [key, value.label])), kinds: AGENDA_KINDS, thresholds: Object.fromEntries(Object.entries(THRESHOLDS).map(([key, value]) => [key, value.label])), statuses: MEETING_STATUSES },
            roster: actor.officer ? members.map(entry => ({ id: entry.id, name: entry.name, studentId: entry.studentId, voting: membershipStatus(entry).voting })) : [],
            ai: Boolean(aiProvider(env)),
            myIp: actor.officer ? (request.headers.get('CF-Connecting-IP') || '') : ''
        });
    }
    if (path === '/api/meetings' && method === 'POST') {
        if (!actor.officer) return officerOnly();
        const body = await deps.readJsonLimited(request, 128 * 1024);
        const created = await meetingStore(env, '/create', { fields: body, actor });
        return json(created.status === 201 ? meetingView(created.body, viewer) : created.body, created.status);
    }

    const match = /^\/api\/meetings\/([\w-]{1,80})(?:\/(status|attendance|minutes|ai-notice|ai-minutes)|\/agenda\/([\w-]{1,80})\/(notes|vote|ballot))?$/.exec(path);
    if (!match) return json({ error: 'Not Found' }, 404);
    const [, id, action, itemId, itemAction] = match;
    const reply = result => json(result.status === 200 ? meetingView(result.body, viewer) : result.body, result.status);
    const op = (name, payload) => meetingStore(env, '/op', { id, op: name, actor, ...payload });

    if (!action && !itemAction) {
        if (method === 'GET') {
            const found = await meetingStore(env, '/get', { id });
            if (found.status !== 200 || !canSeeMeeting(found.body, viewer)) return json({ error: '找不到會議' }, 404);
            return reply(found);
        }
        if (!actor.officer) return officerOnly();
        if (method === 'PATCH') return reply(await op('update', { fields: await deps.readJsonLimited(request, 128 * 1024) }));
        if (method === 'DELETE') { const result = await meetingStore(env, '/delete', { id, actor }); return json(result.body, result.status); }
        return json({ error: '方法不允許' }, 405);
    }
    if (method !== 'POST' && !(action === 'minutes' && method === 'PUT')) return json({ error: '方法不允許' }, 405);
    const body = await deps.readJsonLimited(request, 128 * 1024);

    if (itemAction === 'ballot') {
        // Members see only meetings that are not drafts; the store checks check-in and voting rights.
        return reply(await op('ballot', { itemId, choice: body?.choice }));
    }
    if (action === 'attendance') {
        if (body?.memberId && actor.officer) {
            if (body.remove) return reply(await op('attend', { remove: true, memberId: String(body.memberId) }));
            const target = members.find(entry => entry.id === body.memberId);
            if (!target) return json({ error: '找不到社員' }, 404);
            return reply(await op('attend', { attendee: attendeeFor(target), byOfficer: true }));
        }
        return reply(await op('attend', { attendee: member ? attendeeFor(member) : null, code: body?.code }));
    }

    if (!actor.officer) return officerOnly();
    if (action === 'status') {
        const found = await meetingStore(env, '/get', { id });
        if (found.status !== 200) return json(found.body, found.status);
        const total = body?.totalMembers !== undefined && body.totalMembers !== '' ? body.totalMembers : await defaultTotal(env, found.body.type);
        return reply(await op('status', { status: String(body?.status || ''), totalMembers: total }));
    }
    if (itemAction === 'notes') return reply(await op('notes', { itemId, notes: body?.notes, resolution: body?.resolution }));
    if (itemAction === 'vote') return reply(await op('vote', { itemId, action: body?.action, agree: body?.agree, oppose: body?.oppose, abstain: body?.abstain, attendance: body?.attendance }));
    if (action === 'minutes') return reply(await op('minutes', { content: body?.content, finalize: body?.finalize === true, unfinalize: body?.unfinalize === true, generated: body?.generated === true }));

    if (action === 'ai-notice' || action === 'ai-minutes') {
        if (!aiProvider(env)) return json({ error: '尚未設定 GROQ_API_KEY（或 GEMINI_API_KEY），無法使用 AI 功能' }, 503);
        const found = await meetingStore(env, '/get', { id });
        if (found.status !== 200) return json(found.body, found.status);
        const meeting = found.body;
        if (typeof body?.keywords === 'string') meeting.keywords = body.keywords.slice(0, 3000);
        if (action === 'ai-notice') return await deps.withAiQuota(env, user, () => draftMeetingNotice(env, noticeFacts(meeting)));
        if (meeting.status !== 'closed' && meeting.status !== 'open') return json({ error: '會議開始後才能產生會議紀錄' }, 400);
        return await deps.withAiQuota(env, user, () => draftMinutes(env, minutesFacts(meeting)));
    }
    return json({ error: 'Not Found' }, 404);
}
