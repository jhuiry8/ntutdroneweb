// HTTP routes for 活動報名 and 社團行事曆: public calendar page, iCal feeds, event pages and
// registration API, officer management (名單、CSV、手動加入／移除) and the day-before reminder.
import { marked } from 'marked';
import { canViewCms, hasPermission } from './auth.js';
import { sanitizeContent } from './html.js';
import { parseCookies } from './request.js';
import { readSiteSettings, withAccess } from './session.js';
import { captchaStore, verifyTurnstile } from './session.js';
import { createCaptcha, verifyCaptcha } from './captcha.js';
import { listMeetings } from './meeting-routes.js';
import { MEETING_TYPES } from './meetings.js';
import { buildIcs } from './ical.js';
import { readPushSettings } from './message-routes.js';
import { pushNotice } from './messages.js';
import {
    EventError, EVENT_AUDIENCES, EVENT_CATEGORIES, canViewEvent, canRegisterEvent, registrationOpen, registrationDeadlineOf,
    confirmedOf, waitlistOf, taipeiParts, taipeiInput, sha256Hex
} from './events.js';
import { renderCalendarPage, renderEventPage, renderAdminEventsPage } from './templates/calendar.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const randomHex = bytes => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), value => value.toString(16).padStart(2, '0')).join('');
const TOKEN_KEY = token => `calendar:token:${token}`;
const USER_TOKEN_KEY = username => `calendar:user:${username}`;

// Guests: at most this many sign-ups per IP per hour, and per event per day.
const GUEST_PER_IP = 10;
const GUEST_PER_EVENT_PER_DAY = 300;

export const EVENT_REMINDER_CRON = '0 12 * * *'; // 20:00 Taipei, the evening before

async function store(env, op, payload) {
    if (!env.EVENT_STORE) throw new EventError('此網站尚未設定 EVENT_STORE，活動功能無法使用', 503);
    const stub = env.EVENT_STORE.get(env.EVENT_STORE.idFromName('club-events'));
    const response = await stub.fetch(`https://event-store/${op}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await response.json();
    if (response.status >= 500) throw new Error(body?.error || 'Event store failed');
    return { status: response.status, body };
}

// ---------- views ----------

export function eventView(event, counts, actor, now = new Date().toISOString()) {
    const view = {
        id: event.id, title: event.title, category: event.category, categoryLabel: EVENT_CATEGORIES[event.category],
        startsAt: event.startsAt, endsAt: event.endsAt, location: event.location, capacity: event.capacity,
        registrationDeadline: registrationDeadlineOf(event), audience: event.audience, audienceLabel: EVENT_AUDIENCES[event.audience],
        feeRequired: event.feeRequired, feeAmount: event.feeAmount,
        descriptionHtml: sanitizeContent(marked.parse(event.description || '')),
        confirmed: counts.confirmed, waitlist: counts.waitlist,
        full: Boolean(event.capacity) && counts.confirmed >= event.capacity,
        open: registrationOpen(event, now), me: counts.me || null,
        canRegister: canRegisterEvent(event, actor), guestAllowed: event.audience === 'public' && !actor.username
    };
    if (actor.officer) Object.assign(view, {
        description: event.description, startsLocal: taipeiInput(event.startsAt), endsLocal: taipeiInput(event.endsAt),
        deadlineLocal: taipeiInput(event.registrationDeadline), reminderSentAt: event.reminderSentAt
    });
    return view;
}

function countsFrom(regs, actor) {
    const mine = actor.username ? regs.find(reg => reg.username === actor.username) : null;
    return {
        confirmed: confirmedOf(regs).length, waitlist: waitlistOf(regs).length,
        me: mine ? { id: mine.id, status: mine.status, position: mine.status === 'waitlist' ? waitlistOf(regs).findIndex(reg => reg.id === mine.id) + 1 : 0, paid: mine.paid } : null
    };
}

const registrationView = (reg, index) => ({
    id: reg.id, status: reg.status, kind: reg.kind, name: reg.name, studentId: reg.studentId, email: reg.email,
    username: reg.username, paid: reg.paid, createdAt: reg.createdAt, order: index + 1
});

// CSV cells that start with = + - @ are formulas in Excel; prefix them so a hostile name is never executed.
export function csvCell(value) {
    let cell = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
    return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}
const KIND_LABELS = { member: '社員帳號', guest: '訪客', manual: '幹部加入' };
export function registrationsCsv(event, regs) {
    const rows = [['順位', '狀態', '姓名', '學號', 'Email', '報名方式', '帳號', event.feeRequired ? '已繳費' : '', '報名時間（台北）']];
    const ordered = [...confirmedOf(regs), ...waitlistOf(regs)];
    ordered.forEach((reg, index) => {
        const when = taipeiParts(reg.createdAt);
        rows.push([index + 1, reg.status === 'confirmed' ? '已報名' : '候補', reg.name, reg.studentId, reg.email, KIND_LABELS[reg.kind] || reg.kind, reg.username, event.feeRequired ? (reg.paid ? '是' : '否') : '', `${when.date} ${when.time}`]);
    });
    return '﻿' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// ---------- calendar entries ----------

async function actorFor(request, env, deps) {
    const user = await deps.sessionUser(request, env);
    if (!user) return { username: '', officer: false, staff: false, user: null };
    const members = await deps.readMembers(env);
    const member = user.memberId ? members.find(entry => entry.id === user.memberId) : null;
    return { username: user.username, officer: hasPermission(user, 'events.manage'), staff: canViewCms(user), memberId: member?.id || '', name: member?.name || user.username, studentId: member?.studentId || '', user };
}

async function visibleEvents(env, actor) {
    if (!env.EVENT_STORE) return [];
    const list = (await store(env, 'list', { actor })).body;
    return list.filter(entry => canViewEvent(entry.event, actor)).sort((a, b) => a.event.startsAt.localeCompare(b.event.startsAt));
}

// Meetings that are no longer drafts. Only the public facts (title, type, date, time, place) leave this
// function: never the agenda, attendance, check-in code, notice text or online link.
// Assemblies are open to every member; officer / committee meetings only to officers.
async function visibleMeetings(env, actor) {
    const meetings = await listMeetings(env);
    return meetings
        .filter(meeting => meeting.status !== 'draft' && (MEETING_TYPES[meeting.type]?.assembly || actor.officer || actor.staff))
        .map(meeting => ({ id: meeting.id, title: meeting.title, typeLabel: MEETING_TYPES[meeting.type]?.label || '', date: meeting.date, time: meeting.time || '', location: meeting.location || '' }));
}

function plainText(markdown, max = 400) {
    return String(markdown ?? '').replace(/[#*_`>\[\]]/g, '').replace(/\n{2,}/g, '\n').trim().slice(0, max);
}

function eventIcs(event, origin) {
    return { uid: `event-${event.id}@ntut-drone`, title: event.title, description: `${plainText(event.description)}${event.description ? '\n' : ''}${origin}/events/${event.id}`, location: event.location, url: `${origin}/events/${event.id}`, startsAt: event.startsAt, endsAt: event.endsAt, updatedAt: event.updatedAt };
}
function meetingIcs(meeting) {
    const base = { uid: `meeting-${meeting.id}@ntut-drone`, title: `${meeting.title}（${meeting.typeLabel}）`, location: meeting.location };
    return meeting.time ? { ...base, startsAt: new Date(Date.parse(`${meeting.date}T${meeting.time}:00+08:00`)).toISOString() } : { ...base, date: meeting.date };
}

const icsResponse = (body, cache) => new Response(body, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="ntut-drone.ics"', 'Cache-Control': cache, 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' } });

// ---------- reminder ----------

// Day-before reminder, run by the daily cron (see wrangler.toml). It is posted as one announcement:
// announcements can only target everyone or officers, so the text asks registered people to come and
// shows the headcount rather than naming anyone. Each event is reminded once (reminderSentAt).
export async function runEventReminders(env, { now = new Date() } = {}) {
    if (!env.EVENT_STORE || !env.MESSAGE_STORE) return { reminded: 0 };
    const tomorrow = taipeiParts(new Date(now.getTime() + 24 * 3600 * 1000).toISOString()).date;
    const list = (await store(env, 'list', { actor: { officer: true } })).body;
    const settings = await readPushSettings(env);
    let reminded = 0;
    for (const { event, confirmed, waitlist } of list) {
        if (event.reminderSentAt || taipeiParts(event.startsAt).date !== tomorrow || !confirmed) continue;
        const when = taipeiParts(event.startsAt);
        const content = `明天 ${when.date} ${when.time} 有「${event.title}」${event.location ? `，地點：${event.location}` : ''}。已報名 ${confirmed} 人${waitlist ? `、候補 ${waitlist} 人` : ''}，已報名的同學請準時出席；無法參加請盡早在活動頁取消，讓候補的人遞補。`;
        const stub = env.MESSAGE_STORE.get(env.MESSAGE_STORE.idFromName('club-messages'));
        const audience = event.audience === 'officers' ? 'officers' : 'all';
        const response = await stub.fetch('https://message-store/create-announcement', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actor: { username: 'system', name: '活動提醒', officer: true, president: false }, fields: { title: `明日活動提醒：${event.title}`, content, audience } })
        });
        if (!response.ok) { console.error('Event reminder failed', response.status); continue; }
        await store(env, 'mark-reminded', { id: event.id });
        reminded++;
        if (audience === 'all' && settings.enabled && settings.announcements) {
            try { await pushNotice(settings, { title: `明日活動提醒：${event.title}`, body: content, link: '' }); } catch { /* push is best effort */ }
        }
    }
    return { reminded };
}

// ---------- member calendar token ----------

async function tokenUser(env, token) {
    if (!/^[a-f0-9]{32}$/.test(token)) return null;
    const username = await env.DRONE_DB.get(TOKEN_KEY(token));
    if (!username) return null;
    const raw = await env.DRONE_DB.get(`user:${username}`);
    // The bootstrap account has no user record (see sessionUser).
    const user = raw ? JSON.parse(raw) : (username === 'admin' ? { username: 'admin', role: 'president', active: true } : null);
    if (!user || user.active === false) return null;
    const resolved = await withAccess(env, user);
    if (resolved.role === 'member' && !(await readSiteSettings(env)).memberLogin) return null;
    return resolved;
}

// ---------- routes ----------

function languageOf(request, url) {
    const query = url.searchParams.get('lang');
    if (query === 'en' || query === 'zh') return query;
    const cookie = parseCookies(request).lang;
    return cookie === 'en' ? 'en' : 'zh';
}

const html = body => new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' } });

export async function handleEventRequest(request, env, deps) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const eventPage = /^\/events\/([\w-]{1,80})$/.exec(path);
    const memberFeed = /^\/calendar\/member\/([a-f0-9]{32})\.ics$/.exec(path);
    if (!['/calendar', '/calendar.ics', '/admin/events', '/api/calendar/token', '/api/public/events/captcha'].includes(path) && !memberFeed && !eventPage && !path.startsWith('/api/events')) return null;

    if (path === '/calendar.ics' && method === 'GET') {
        const events = (await visibleEvents(env, { username: '', officer: false })).filter(entry => entry.event.audience === 'public');
        return icsResponse(buildIcs(events.map(entry => eventIcs(entry.event, url.origin)), { name: '北科無人機社 活動行事曆' }), 'public, max-age=900');
    }
    if (memberFeed && method === 'GET') {
        const user = await tokenUser(env, memberFeed[1]);
        if (!user) return new Response('找不到行事曆', { status: 404, headers: { 'Cache-Control': 'no-store' } });
        const actor = { username: user.username, officer: hasPermission(user, 'events.manage'), staff: canViewCms(user) };
        const [events, meetings] = await Promise.all([visibleEvents(env, actor), visibleMeetings(env, actor)]);
        const entries = [...events.map(entry => eventIcs(entry.event, url.origin)), ...meetings.map(meetingIcs)];
        return icsResponse(buildIcs(entries, { name: '北科無人機社 社員行事曆' }), 'private, max-age=300');
    }

    if (path === '/calendar' && method === 'GET') {
        const lang = languageOf(request, url);
        const actor = await actorFor(request, env, deps);
        const [events, meetings] = await Promise.all([visibleEvents(env, actor), visibleMeetings(env, actor)]);
        const now = new Date().toISOString();
        const response = html(renderCalendarPage({
            lang, month: url.searchParams.get('m') || '', view: url.searchParams.get('view') === 'list' ? 'list' : 'month', today: taipeiParts(now).date,
            entries: [
                ...events.map(({ event, confirmed }) => ({ kind: 'event', id: event.id, title: event.title, ...taipeiParts(event.startsAt), location: event.location, href: `/events/${event.id}?lang=${lang}`, tag: EVENT_CATEGORIES[event.category], audience: event.audience, full: Boolean(event.capacity) && confirmed >= event.capacity })),
                ...meetings.map(meeting => ({ kind: 'meeting', id: meeting.id, title: meeting.title, date: meeting.date, time: meeting.time, location: meeting.location, href: '', tag: meeting.typeLabel }))
            ].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)),
            signedIn: Boolean(actor.username)
        }));
        if (url.searchParams.get('lang') === 'en' || url.searchParams.get('lang') === 'zh') response.headers.append('Set-Cookie', `lang=${lang}; Path=/; Max-Age=31536000; Secure; SameSite=Lax`);
        return response;
    }

    if (eventPage && method === 'GET') {
        const lang = languageOf(request, url);
        const actor = await actorFor(request, env, deps);
        const found = env.EVENT_STORE ? await store(env, 'get', { id: eventPage[1] }) : { status: 404 };
        if (found.status !== 200 || !canViewEvent(found.body.event, actor)) return new Response('找不到活動 Event not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        return html(renderEventPage({ lang, event: found.body.event, turnstileSiteKey: env.TURNSTILE_SECRET_KEY ? env.TURNSTILE_SITE_KEY || '' : '' }));
    }

    if (path === '/api/public/events/captcha' && method === 'GET') {
        if (env.TURNSTILE_SECRET_KEY) return json({ turnstile: env.TURNSTILE_SITE_KEY || '' });
        const captcha = await createCaptcha(captchaStore(env));
        return json({ captchaId: captcha.id, svg: captcha.svg });
    }

    if (path === '/admin/events' && method === 'GET') {
        const actor = await actorFor(request, env, deps);
        if (!actor.username) return Response.redirect(`${url.origin}/admin`, 302);
        if (!actor.officer) return new Response('只有幹部可以管理活動', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        return html(renderAdminEventsPage());
    }

    if (path === '/api/calendar/token') {
        const actor = await actorFor(request, env, deps);
        if (!actor.username) return json({ error: '未授權' }, 401);
        if (!['GET', 'POST'].includes(method)) return json({ error: '方法不允許' }, 405);
        let token = await env.DRONE_DB.get(USER_TOKEN_KEY(actor.username));
        if (method === 'POST' || !token) {
            if (token) await env.DRONE_DB.delete(TOKEN_KEY(token));
            token = randomHex(16);
            await env.DRONE_DB.put(TOKEN_KEY(token), actor.username);
            await env.DRONE_DB.put(USER_TOKEN_KEY(actor.username), token);
        }
        return json({ url: `${url.origin}/calendar/member/${token}.ics`, public: `${url.origin}/calendar.ics` });
    }

    // ---- /api/events ----
    const actor = await actorFor(request, env, deps);
    const now = new Date().toISOString();
    const officerOnly = () => json({ error: '只有幹部可以管理活動' }, 403);
    const body = () => deps.readJsonLimited(request, 32 * 1024);
    const { user: _user, ...storeActor } = actor;

    if (path === '/api/events' && method === 'GET') {
        const list = await visibleEvents(env, storeActor);
        return json({ events: list.map(entry => eventView(entry.event, entry, actor, now)), me: { username: actor.username, officer: actor.officer }, audiences: EVENT_AUDIENCES, categories: EVENT_CATEGORIES });
    }
    if (path === '/api/events' && method === 'POST') {
        if (!actor.officer) return actor.username ? officerOnly() : json({ error: '未授權' }, 401);
        const created = await store(env, 'create', { actor: storeActor, fields: await body() });
        return json(created.status === 200 ? eventView(created.body.event, { confirmed: 0, waitlist: 0 }, actor, now) : created.body, created.status === 200 ? 201 : created.status);
    }

    const match = /^\/api\/events\/([\w-]{1,80})(?:\/(register|cancel|registrations|registrations\.csv)(?:\/([\w-]{1,80}))?)?$/.exec(path);
    if (!match) return json({ error: 'Not Found' }, 404);
    const [, id, action, regId] = match;
    const call = (op, extra = {}) => store(env, op, { id, actor: storeActor, ...extra });
    const reply = result => json(result.status === 200 ? eventView(result.body.event, countsFrom(result.body.regs, actor), actor, now) : result.body, result.status);
    const roster = regs => regs.sort((a, b) => (a.status === b.status ? a.seq - b.seq : a.status === 'confirmed' ? -1 : 1)).map(registrationView);
    const withRoster = result => json(result.status === 200 ? { event: eventView(result.body.event, countsFrom(result.body.regs, actor), actor, now), registrations: roster(result.body.regs) } : result.body, result.status);
    const loadVisible = async () => {
        const found = await call('get');
        if (found.status !== 200 || !canViewEvent(found.body.event, actor)) return null;
        return found;
    };

    if (!action) {
        if (method === 'GET') {
            const found = await loadVisible();
            return found ? json(eventView(found.body.event, countsFrom(found.body.regs, actor), actor, now)) : json({ error: '找不到活動' }, 404);
        }
        if (!actor.officer) return actor.username ? officerOnly() : json({ error: '未授權' }, 401);
        if (method === 'PATCH') return reply(await call('update', { fields: await body() }));
        if (method === 'DELETE') { const result = await call('delete'); return json(result.body, result.status); }
        return json({ error: '方法不允許' }, 405);
    }

    if (action === 'register') {
        if (method !== 'POST') return json({ error: '方法不允許' }, 405);
        const input = await body();
        if (!(await loadVisible())) return json({ error: '找不到活動' }, 404);
        if (actor.username) return reply(await call('register'));
        // Visitors: rate limit first, then Turnstile or the image CAPTCHA.
        const ip = request.headers.get('CF-Connecting-IP') || '';
        const allowed = await deps.takeAttempt(env, [
            { key: `event-guest:${id}:all`, max: GUEST_PER_EVENT_PER_DAY, windowSeconds: 86400 },
            ...(ip ? [{ key: `event-guest:ip:${ip}`, max: GUEST_PER_IP, windowSeconds: 3600 }] : [])
        ]);
        if (!allowed) return json({ error: '報名次數過多，請稍後再試' }, 429);
        const human = env.TURNSTILE_SECRET_KEY
            ? await verifyTurnstile(env, String(input?.turnstileToken || ''), ip)
            : await verifyCaptcha(captchaStore(env), String(input?.captchaId || ''), input?.captcha);
        if (!human) return json({ error: '驗證碼錯誤或已過期，請重新輸入' }, 400);
        const cancelToken = randomHex(16);
        const result = await call('register', { guest: input?.guest, cancelHash: await sha256Hex(cancelToken) });
        if (result.status !== 200) return json(result.body, result.status);
        const counts = countsFrom(result.body.regs, actor);
        return json({ event: eventView(result.body.event, counts, actor, now), registration: { id: result.body.reg.id, status: result.body.reg.status }, cancelToken }, 201);
    }

    if (action === 'cancel') {
        if (method !== 'POST') return json({ error: '方法不允許' }, 405);
        const input = await body();
        if (!(await loadVisible())) return json({ error: '找不到活動' }, 404);
        const result = await call('cancel', actor.username ? {} : { regId: String(input?.registrationId || ''), cancelHash: await sha256Hex(String(input?.token || '')) });
        return result.status === 200 ? json({ event: eventView(result.body.event, countsFrom(result.body.regs, actor), actor, now), promoted: result.body.promoted.length }) : json(result.body, result.status);
    }

    // registrations: officers only
    if (!actor.officer) return actor.username ? officerOnly() : json({ error: '未授權' }, 401);
    if (action === 'registrations.csv' && method === 'GET') {
        const found = await call('get');
        if (found.status !== 200) return json(found.body, found.status);
        const name = found.body.event.title.replace(/[^\w一-鿿-]+/g, '_').slice(0, 40) || 'event';
        return new Response(registrationsCsv(found.body.event, found.body.regs), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="registrations-${encodeURIComponent(name)}.csv"`, 'Cache-Control': 'no-store' } });
    }
    if (action === 'registrations' && !regId) {
        if (method === 'GET') return withRoster(await call('get'));
        if (method === 'POST') return withRoster(await call('add', { person: await body() }));
    }
    if (action === 'registrations' && regId) {
        if (method === 'DELETE') return withRoster(await call('remove', { regId }));
        if (method === 'PATCH') return withRoster(await call('set-paid', { regId, paid: (await body())?.paid === true }));
    }
    return json({ error: '方法不允許' }, 405);
}
