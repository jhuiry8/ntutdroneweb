// Class sessions (社課場次) and their check-in. Mirrors meetings.js: every change to
// the sessions goes through ClassStore, a Durable Object, so concurrent check-ins are
// applied one at a time. The pure functions here do not touch storage so they can be
// tested directly.
//
// Trial members (非正式社員) may join FREE_TRIAL_CLASSES free classes per academic year
// (四級分級細則第二條). The attendance record is the source of truth; the member's
// `trialUses` counter in the roster is kept in step by class-routes.js.
import { FREE_TRIAL_CLASSES, MEMBER_LEVELS, membershipStatus, semesterOf } from './membership.js';
import { MeetingError } from './meetings.js';

// Same status mapping as meetings (worker.js turns a MeetingError into its HTTP status).
export class ClassError extends MeetingError {}

export const CLASS_STATUSES = { open: '開放簽到', closed: '已結束' };
export const MAX_CLASSES = 500;
export const MAX_ATTENDEES = 500;
export const DEFAULT_TOKEN_MINUTES = 30;
export const MAX_TOKEN_MINUTES = 12 * 60;

function text(value, field, max, required = false) {
    const result = String(value ?? '').replace(/\r\n?/g, '\n').trim();
    if (required && !result) throw new ClassError(`請填寫${field}`);
    if (result.length > max) throw new ClassError(`${field}不可超過 ${max} 字`);
    return result;
}
function isoDate(value) {
    const date = String(value ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new ClassError('社課日期格式錯誤');
    return date;
}
const normId = value => String(value ?? '').replace(/\s+/g, '').toUpperCase();
const normName = value => String(value ?? '').replace(/\s+/g, '').toLowerCase();

// ---- Academic year and the trial counter ---------------------------------

// ROC academic year (學年) of a date: August 2026 – July 2027 is "115".
export function academicYearOf(date = new Date()) { return semesterOf(date).split('-')[0]; }

// The academic year the member's `trialUses` counter belongs to. Records written before
// `trialYear` existed are assumed to be from the year the member was created; an officer who
// edits the counter in the roster stamps the current year (see the PATCH route).
export function trialYearOf(member, today = new Date()) {
    if (/^\d{2,3}$/.test(String(member?.trialYear ?? ''))) return String(member.trialYear);
    const stamp = new Date(member?.createdAt || member?.joinedAt || '');
    return academicYearOf(Number.isNaN(stamp.getTime()) ? today : stamp);
}
// Free trial classes already used in `year` (0 once the counter belongs to an older year).
export function trialUsesIn(member, year, today = new Date()) {
    return trialYearOf(member, today) === String(year) ? Math.max(0, Number(member?.trialUses) || 0) : 0;
}
// Moves the counter by `delta` for `year`. A year older than the counter's is left alone
// (a back-dated class must not roll the counter back). Returns true when the member changed.
export function applyTrialDelta(member, delta, year, today = new Date()) {
    const counterYear = Number(trialYearOf(member, today)), target = Number(year);
    if (target < counterYear) return false;
    const next = Math.min(99, Math.max(0, trialUsesIn(member, year, today) + delta));
    const changed = next !== (Number(member.trialUses) || 0) || member.trialYear !== String(year);
    member.trialUses = next;
    member.trialYear = String(year);
    return changed;
}
// Year-aware replacement for membershipStatus().trialUses / trialRemaining, which only see the raw counter.
export function trialSummary(member, today = new Date()) {
    const status = membershipStatus(member, today);
    if (status.level !== 'trial') return { trialUses: status.trialUses, trialRemaining: null, year: academicYearOf(today) };
    const year = academicYearOf(today);
    const uses = trialUsesIn(member, year, today);
    return { trialUses: uses, trialRemaining: Math.max(0, FREE_TRIAL_CLASSES - uses), year };
}

// ---- Sessions --------------------------------------------------------------

const newId = () => crypto.randomUUID();
const tokenValue = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');

export function newClass(input, username, now) {
    const session = { id: newId(), status: 'open', token: '', tokenExpiresAt: '', attendance: [], createdBy: username, createdAt: now, updatedAt: now };
    return applyClassFields(session, input);
}

export function applyClassFields(session, input) {
    session.date = isoDate(input?.date ?? session.date);
    session.topic = text(input?.topic ?? session.topic, '主題', 120, true);
    session.instructor = text(input?.instructor ?? session.instructor, '講師', 60);
    session.location = text(input?.location ?? session.location, '地點', 200);
    const time = String(input?.time ?? session.time ?? '');
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new ClassError('上課時間格式錯誤');
    session.time = time;
    return session;
}

function tokenState(session, nowMs) {
    if (!session.token) return 'none';
    return Date.parse(session.tokenExpiresAt) > nowMs ? 'valid' : 'expired';
}
function constantTimeEqual(left, right) {
    const a = String(left), b = String(right);
    if (a.length !== b.length) return false;
    let difference = 0;
    for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return difference === 0;
}
// The check-in link only works while the officer's latest token is unexpired.
export function requireToken(session, token, nowMs) {
    if (session.status !== 'open') throw new ClassError('這場社課已結束簽到', 403);
    const state = tokenState(session, nowMs);
    if (state === 'none' || !constantTimeEqual(session.token, String(token ?? ''))) throw new ClassError('簽到連結無效，請重新掃描現場最新的 QR code', 403);
    if (state === 'expired') throw new ClassError('簽到連結已過期，請向幹部索取新的 QR code', 403);
}

// Same person, whatever the way they were recorded: by 學號 first, then roster id, then name.
export function attendeeKey(attendee) {
    const id = normId(attendee.studentId);
    if (id) return `s:${id}`;
    if (attendee.memberId) return `m:${attendee.memberId}`;
    return `n:${normName(attendee.name)}`;
}

// Describes who is signing in, from the roster entry (or none for a visitor). Done by the
// caller because the roster lives in KV; membershipStatus() decides what the member is.
export function attendeeFromMember(member, year, today = new Date()) {
    const status = membershipStatus(member, today);
    return {
        kind: status.level === 'trial' ? 'trial' : 'member', memberId: member.id, studentId: member.studentId || '', name: member.name || member.studentId || '',
        level: status.level, paid: status.paid, priorUses: status.level === 'trial' ? trialUsesIn(member, year, today) : 0
    };
}

function record(session, attendee, now, by, extra = {}) {
    const name = text(attendee.name, '姓名', 50) || '（未填姓名）';
    const entry = {
        id: newId(), key: attendeeKey(attendee), kind: attendee.kind, memberId: attendee.memberId || '', studentId: text(attendee.studentId, '學號', 30).toUpperCase(),
        name, level: attendee.level || '', paid: attendee.paid ?? null, at: now, by,
        deducted: false, trialYear: '', overLimit: false, approved: false, joined: attendee.joined === true, ...extra
    };
    if (attendee.kind === 'trial') {
        if (Number(attendee.priorUses) >= FREE_TRIAL_CLASSES) {
            // Over the free quota: kept on the list, but the officer decides whether to let it through.
            entry.overLimit = true;
            if (by !== 'self') { entry.approved = true; entry.approvedBy = by; }
        } else {
            entry.deducted = true;
            entry.trialYear = academicYearOf(session.date);
        }
    }
    session.attendance.push(entry);
    return entry;
}

// One device, one person: a phone that already signed someone in cannot sign in another.
function checkDevice(session, deviceHash, key) {
    if (deviceHash && session.attendance.some(entry => entry.deviceHash === deviceHash && entry.key !== key)) throw new ClassError('這台裝置已經替另一位簽到過，一台裝置只能簽到一人', 409);
}

function checkRoom(session) {
    if (session.attendance.length >= MAX_ATTENDEES) throw new ClassError('簽到人數已達上限');
}

// Applies one change. `actor` = { username, officer }; `nowMs` is injectable for tests.
// Returns { entry?, created?, removed? } for the caller (class-routes.js) to settle the roster counter.
export function applyClassOp(session, op, payload, actor, now, nowMs = Date.parse(now)) {
    if (op === 'update') {
        applyClassFields(session, payload.fields || {});
        return {};
    }

    if (op === 'status') {
        if (!CLASS_STATUSES[payload.status]) throw new ClassError('狀態無效');
        session.status = payload.status;
        if (payload.status === 'closed') { session.token = ''; session.tokenExpiresAt = ''; }
        return {};
    }

    if (op === 'token') {
        if (session.status !== 'open') throw new ClassError('這場社課已結束，請先重新開放簽到', 409);
        const minutes = payload.ttlMinutes === undefined || payload.ttlMinutes === '' || payload.ttlMinutes === null ? DEFAULT_TOKEN_MINUTES : Number(payload.ttlMinutes);
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_TOKEN_MINUTES) throw new ClassError(`連結有效時間需為 1 至 ${MAX_TOKEN_MINUTES} 分鐘`);
        // Issuing a new token retires the previous one, so a leaked link stops working.
        session.token = tokenValue();
        session.tokenExpiresAt = new Date(nowMs + minutes * 60000).toISOString();
        return {};
    }

    // Read-only gate used before the roster is touched (joining as a trial member).
    if (op === 'precheck') {
        requireToken(session, payload.token, nowMs);
        const key = attendeeKey(payload.attendee);
        if (session.attendance.some(entry => entry.key === key)) throw new ClassError('已經簽到過了', 409);
        checkDevice(session, payload.deviceHash, key);
        return {};
    }

    if (op === 'checkin') {
        requireToken(session, payload.token, nowMs);
        const attendee = payload.attendee;
        const key = attendeeKey(attendee);
        const device = payload.deviceHash || '';
        const existing = session.attendance.find(entry => entry.key === key);
        checkDevice(session, device, key);
        if (existing) {
            if (device && existing.deviceHash === device) return { entry: existing, created: false }; // same person, same phone: just signing back in
            throw new ClassError('這個學號已經簽到過了（可能在其他裝置）。如需更換裝置，請洽幹部', 409);
        }
        checkRoom(session);
        const entry = record(session, attendee, now, 'self', { deviceHash: device });
        return { entry, created: true };
    }

    // The officer's own paths below.
    if (!actor.officer) throw new ClassError('只有幹部可以管理社課簽到', 403);

    if (op === 'add') {
        const attendee = payload.attendee;
        if (!attendee || (!attendee.memberId && !normName(attendee.name))) throw new ClassError('請選擇社員或填寫訪客姓名');
        if (session.attendance.some(entry => entry.key === attendeeKey(attendee))) throw new ClassError('已經簽到過了', 409);
        checkRoom(session);
        return { entry: record(session, attendee, now, actor.username), created: true };
    }

    const entry = session.attendance.find(item => item.id === payload.entryId);
    if (!entry) throw new ClassError('找不到簽到紀錄', 404);

    if (op === 'remove') {
        session.attendance = session.attendance.filter(item => item.id !== entry.id);
        return { entry, removed: true };
    }
    if (op === 'approve') {
        if (!entry.overLimit) throw new ClassError('這筆簽到沒有超過免費體驗次數');
        entry.approved = payload.approved !== false;
        if (entry.approved) entry.approvedBy = actor.username; else delete entry.approvedBy;
        return { entry };
    }
    if (op === 'sync-failed') {
        entry.syncError = payload.failed !== false;
        return { entry };
    }
    throw new ClassError('社課操作不存在', 404);
}

// ---- Views ---------------------------------------------------------------

const KIND_LABELS = { member: '社員', trial: '非正式社員', guest: '訪客' };

export function entryStatusLabel(entry) {
    if (entry.overLimit) return entry.approved ? '已放行（超過免費次數）' : '需繳費（待幹部決定）';
    if (entry.kind === 'trial' && entry.joined) return '新加入・免費體驗';
    if (entry.kind === 'trial') return '免費體驗';
    return '出席';
}

function entryView(entry) {
    const { deviceHash, ...rest } = entry;
    return { ...rest, kindLabel: KIND_LABELS[entry.kind] || entry.kind, levelLabel: MEMBER_LEVELS[entry.level] || '', statusLabel: entryStatusLabel(entry) };
}

// Officers see the attendance list and the live token; nobody else gets either.
export function classView(session, nowMs = Date.now()) {
    const { attendance, token, tokenExpiresAt, ...rest } = session;
    return {
        ...rest,
        statusLabel: CLASS_STATUSES[session.status],
        year: academicYearOf(session.date),
        token, tokenExpiresAt, tokenState: tokenState(session, nowMs),
        attendanceCount: attendance.length,
        pendingCount: attendance.filter(entry => entry.overLimit && !entry.approved).length,
        attendance: attendance.map(entryView)
    };
}
export function classListView(session, nowMs) {
    const { attendance, token, ...view } = classView(session, nowMs);
    return view;
}

// What the public page may see once it holds a valid token.
export function publicClassView(session) {
    return { id: session.id, topic: session.topic, date: session.date, time: session.time, instructor: session.instructor, location: session.location, status: session.status, statusLabel: CLASS_STATUSES[session.status] };
}

// How many times each person came, from the attendance records: { [key]: { total, year } }.
export function attendanceCounts(sessions, year) {
    const counts = {};
    for (const session of sessions) {
        const inYear = academicYearOf(session.date) === String(year);
        for (const entry of session.attendance) {
            const bucket = counts[entry.memberId || entry.key] ||= { total: 0, year: 0 };
            bucket.total++;
            if (inYear) bucket.year++;
        }
    }
    return counts;
}

// ---- CSV -----------------------------------------------------------------

// Spreadsheet programs run cells that start with = + - @ as formulas, and visitors type their own names.
function csvCell(value) {
    let cell = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
    return /[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}
export function classCsv(session) {
    const header = ['日期', '主題', '講師', '地點', '學號', '姓名', '身分', '類別', '簽到時間', '簽到方式', '狀態'];
    const rows = session.attendance.map(entry => [
        session.date, session.topic, session.instructor, session.location, entry.studentId, entry.name,
        MEMBER_LEVELS[entry.level] || '', KIND_LABELS[entry.kind] || entry.kind, entry.at, entry.by === 'self' ? '自行簽到' : `幹部補簽（${entry.by}）`, entryStatusLabel(entry)
    ]);
    // BOM so Excel reads the UTF-8 Chinese text correctly.
    return `﻿${[header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

// ---- Durable Object ---------------------------------------------------------

export class ClassStore {
    constructor(ctx) { this.storage = ctx.storage; }

    async fetch(request) {
        try {
            const url = new URL(request.url);
            const payload = await request.json();
            const now = new Date().toISOString();
            const result = await this.storage.transaction(async storage => {
                if (url.pathname === '/list') return { status: 200, body: [...(await storage.list({ prefix: 'class:' })).values()] };
                if (url.pathname === '/summary') return { status: 200, body: attendanceCounts((await storage.list({ prefix: 'class:' })).values(), payload.year) };
                if (url.pathname === '/create') {
                    if ((await storage.list({ prefix: 'class:' })).size >= MAX_CLASSES) return { status: 409, body: { error: `社課場次已達 ${MAX_CLASSES} 場上限` } };
                    const session = newClass(payload.fields, payload.actor.username, now);
                    await storage.put(`class:${session.id}`, session);
                    return { status: 201, body: session };
                }
                const id = String(payload.id || '');
                const session = /^[\w-]{1,80}$/.test(id) ? await storage.get(`class:${id}`) : null;
                if (!session) return { status: 404, body: { error: '找不到社課場次' } };
                if (url.pathname === '/get') return { status: 200, body: session };
                if (url.pathname === '/delete') {
                    await storage.delete(`class:${id}`);
                    return { status: 200, body: { success: true, session } };
                }
                if (url.pathname === '/op') {
                    const outcome = applyClassOp(session, payload.op, payload, payload.actor || {}, now);
                    session.updatedAt = now;
                    await storage.put(`class:${id}`, session);
                    return { status: 200, body: { session, ...outcome } };
                }
                return { status: 404, body: { error: '社課操作不存在' } };
            });
            return Response.json(result.body, { status: result.status });
        } catch (error) {
            if (error instanceof ClassError) return Response.json({ error: error.message }, { status: error.status });
            console.error('Class store failed', error?.message || String(error));
            return Response.json({ error: '社課資料操作失敗' }, { status: 500 });
        }
    }
}
