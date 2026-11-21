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
import { parseEventTime, taipeiInput, promoteWaitlist, confirmedOf, waitlistOf, regSort } from './events.js';

// Same status mapping as meetings (worker.js turns a MeetingError into its HTTP status).
export class ClassError extends MeetingError {}

export const CLASS_STATUSES = { open: '開放簽到', closed: '已結束' };
export const MAX_CLASSES = 500;
export const MAX_ATTENDEES = 500;
export const DEFAULT_TOKEN_MINUTES = 30;
export const MAX_TOKEN_MINUTES = 12 * 60;
// Pre-registration (事先報名), optional per session. Audience: everyone (visitors with 學號＋姓名 too),
// roster members including trial members, or formal members only.
export const CLASS_AUDIENCES = { all: '全部（含訪客）', with_trial: '社員（含非正式社員）', members: '正式社員' };
export const MAX_CLASS_REGISTRATIONS = 500;

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
    applyRegistrationFields(session, input);
    return session;
}

// When the class starts (a class without a time counts until the end of its day), Taipei time.
export function classStartsAt(session) {
    return new Date(Date.parse(`${session.date}T${session.time || '23:59'}:00+08:00`)).toISOString();
}
export function classRegistrationDeadline(session) { return session.registrationDeadline || classStartsAt(session); }
export function classRegistrationOpen(session, now) {
    return session.registrationEnabled === true && session.status === 'open'
        && Date.parse(now) <= Date.parse(classRegistrationDeadline(session)) && Date.parse(now) < Date.parse(classStartsAt(session));
}

function applyRegistrationFields(session, input) {
    const has = name => input && input[name] !== undefined;
    session.registrationEnabled = has('registrationEnabled') ? input.registrationEnabled === true : session.registrationEnabled === true;
    const capacityRaw = has('capacity') ? input.capacity : session.capacity;
    const capacity = capacityRaw === '' || capacityRaw === null || capacityRaw === undefined ? 0 : Number(capacityRaw);
    if (!Number.isInteger(capacity) || capacity < 0 || capacity > MAX_CLASS_REGISTRATIONS) throw new ClassError(`名額必須是 0 至 ${MAX_CLASS_REGISTRATIONS} 的整數（0 = 不限）`);
    const audience = (has('audience') ? input.audience : session.audience) ?? 'all';
    if (!CLASS_AUDIENCES[audience]) throw new ClassError('報名對象無效');
    let deadline = has('registrationDeadline') ? parseEventTime(input.registrationDeadline, '報名截止時間') : (session.registrationDeadline || null);
    if (deadline && Date.parse(deadline) > Date.parse(classStartsAt(session))) throw new ClassError('報名截止時間不可晚於開課時間');
    Object.assign(session, { capacity, audience, registrationDeadline: deadline });
    session.nextRegSeq ??= 1;
    session.reminderSentAt ??= '';
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
    const { attendance, token, tokenExpiresAt, nextRegSeq, ...rest } = session;
    return {
        ...rest,
        registration: registrationConfig(session),
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

export function registrationConfig(session) {
    const audience = CLASS_AUDIENCES[session.audience] ? session.audience : 'all';
    return {
        enabled: session.registrationEnabled === true, capacity: session.capacity || 0, audience, audienceLabel: CLASS_AUDIENCES[audience],
        deadline: classRegistrationDeadline(session), deadlineLocal: taipeiInput(session.registrationDeadline), startsAt: classStartsAt(session)
    };
}

// Public /classes listing: schedule, seats left, nothing about who signed up or the check-in token.
export function publicListView(session, counts, now) {
    const confirmed = counts?.confirmed || 0, waitlist = counts?.waitlist || 0;
    const config = registrationConfig(session);
    const full = config.capacity > 0 && confirmed >= config.capacity;
    return {
        id: session.id, topic: session.topic, date: session.date, time: session.time, instructor: session.instructor, location: session.location,
        registration: {
            enabled: config.enabled, capacity: config.capacity, audience: config.audience, audienceLabel: config.audienceLabel, deadline: config.deadline,
            confirmed, waitlist, full, seatsLeft: config.capacity ? Math.max(0, config.capacity - confirmed) : null,
            open: classRegistrationOpen(session, now)
        }
    };
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


// ---- Registration (事先報名) -----------------------------------------------------
// Each registration is its own record, `creg:<classId>:<seq>`, in the same Durable Object, so the
// seat count, the waitlist and the promotion on a cancellation all happen in one transaction.
// The waitlist logic is the one used for event registration (events.js).

const regKey = (classId, seq) => `creg:${classId}:${String(seq).padStart(8, '0')}`;
export async function loadRegs(storage, classId) {
    return [...(await storage.list({ prefix: `creg:${classId}:` })).values()].sort(regSort);
}
async function saveRegs(storage, session, regs) { for (const reg of regs) await storage.put(regKey(session.id, reg.seq), reg); }

// Who may register: who = { kind: 'member' | 'trial' | 'guest', ... }.
export function canRegisterClass(session, who) {
    const audience = session.audience || 'all';
    if (audience === 'all') return true;
    if (audience === 'with_trial') return who.kind === 'member' || who.kind === 'trial';
    return who.kind === 'member';
}

function sameRegistrant(reg, who) {
    return reg.key === who.key || Boolean(who.memberId && reg.memberId === who.memberId) || Boolean(who.username && reg.username === who.username);
}

async function loadSession(storage, id) {
    const session = /^[\w-]{1,80}$/.test(String(id || '')) ? await storage.get(`class:${id}`) : null;
    if (!session) throw new ClassError('找不到社課場次', 404);
    return session;
}

// Every registration operation of ClassStore (path /reg/<op>). Returns plain data.
export async function classRegOp(storage, op, payload, now = new Date().toISOString()) {
    if (op === 'counts') {
        const counts = {};
        for (const reg of (await storage.list({ prefix: 'creg:' })).values()) {
            const bucket = counts[reg.classId] ||= { confirmed: 0, waitlist: 0 };
            bucket[reg.status === 'confirmed' ? 'confirmed' : 'waitlist']++;
        }
        return counts;
    }
    if (op === 'all') {
        // Every registration, for the statistics report.
        return [...(await storage.list({ prefix: 'creg:' })).values()].map(({ classId, status, key, memberId, seq }) => ({ classId, status, key, memberId, seq }));
    }
    if (op === 'mine') {
        // This signed-in account's registration in every class: { [classId]: { id, status, position } }.
        const byClass = {};
        for (const reg of (await storage.list({ prefix: 'creg:' })).values()) (byClass[reg.classId] ||= []).push(reg);
        const mine = {};
        for (const [classId, list] of Object.entries(byClass)) {
            const reg = list.find(item => payload.username && item.username === payload.username);
            if (reg) mine[classId] = { id: reg.id, status: reg.status, position: reg.status === 'waitlist' ? waitlistOf(list).findIndex(item => item.id === reg.id) + 1 : 0 };
        }
        return mine;
    }
    const session = await loadSession(storage, payload.id);
    const regs = await loadRegs(storage, session.id);
    if (op === 'list') return { session, regs };
    const actor = payload.actor || {};

    if (op === 'mark-reminded') { session.reminderSentAt = now; await storage.put(`class:${session.id}`, session); return { session, regs }; }

    if (op === 'register' || op === 'add') {
        if (op === 'add' && !actor.officer) throw new ClassError('只有幹部可以管理報名', 403);
        const who = { ...payload.who };
        who.key = attendeeKey(who);
        if (!who.key || who.key === 'n:') throw new ClassError('請填寫學號與姓名');
        if (op === 'register') {
            if (session.registrationEnabled !== true) throw new ClassError('這場社課不開放事先報名', 409);
            if (session.status !== 'open') throw new ClassError('這場社課已結束', 409);
            if (!classRegistrationOpen(session, now)) throw new ClassError('報名已截止', 409);
            if (!canRegisterClass(session, who)) throw new ClassError(`這場社課報名對象為「${CLASS_AUDIENCES[session.audience || 'all']}」，您不符合資格`, 403);
        }
        if (regs.length >= MAX_CLASS_REGISTRATIONS) throw new ClassError('此場次報名人數已達系統上限', 409);
        if (regs.some(reg => sameRegistrant(reg, who))) throw new ClassError('已經報名過了', 409);
        const free = session.capacity ? session.capacity - confirmedOf(regs).length : Infinity;
        // Anyone already waiting goes first; a late arrival cannot jump the queue into a freed seat.
        const status = (op === 'add' && payload.force === true) || (free > 0 && waitlistOf(regs).length === 0) ? 'confirmed' : 'waitlist';
        const seq = session.nextRegSeq || 1;
        session.nextRegSeq = seq + 1;
        const reg = {
            id: crypto.randomUUID(), classId: session.id, seq, status, key: who.key, kind: who.kind, memberId: who.memberId || '', username: who.username || '',
            studentId: String(who.studentId || '').toUpperCase().slice(0, 30), name: String(who.name || '').trim().slice(0, 50), level: who.level || '',
            cancelHash: who.cancelHash || '', by: op === 'add' ? actor.username : 'self', createdAt: now
        };
        await storage.put(`class:${session.id}`, session);
        await storage.put(regKey(session.id, seq), reg);
        regs.push(reg);
        return { session, regs, reg };
    }

    if (op === 'cancel') {
        const reg = regs.find(item => item.id === String(payload.regId || '')
            || (!payload.regId && actor.username && item.username === actor.username));
        if (!reg) throw new ClassError('找不到報名紀錄', 404);
        if (!actor.officer) {
            const mine = reg.username && reg.username === actor.username;
            const guestOk = !reg.username && reg.cancelHash && payload.cancelHash && reg.cancelHash === payload.cancelHash;
            if (!mine && !guestOk) throw new ClassError('找不到報名紀錄', 404);
            if (Date.parse(now) >= Date.parse(classStartsAt(session))) throw new ClassError('社課已開始，無法自行取消，請洽幹部', 409);
        }
        await storage.delete(regKey(session.id, reg.seq));
        regs.splice(regs.indexOf(reg), 1);
        const promoted = reg.status === 'confirmed' ? promoteWaitlist(session, regs, now) : [];
        await saveRegs(storage, session, promoted);
        return { session, regs, removed: reg, promoted };
    }
    throw new ClassError('報名操作不存在', 404);
}

// Registrations against the attendance list: 已報名已到 / 已報名未到 / 未報名現場來.
// Waitlisted people who never came are not listed here (they were never in the class).
export const ATTENDANCE_STATES = { attended: '已報名已到', absent: '已報名未到', walkin: '未報名現場來' };
export function compareAttendance(session, regs) {
    const entryOf = reg => session.attendance.find(entry => entry.key === reg.key || Boolean(reg.memberId && entry.memberId === reg.memberId));
    const matched = new Set();
    const rows = [];
    for (const reg of [...confirmedOf(regs)].sort(regSort)) {
        const entry = entryOf(reg);
        if (entry) matched.add(entry.id);
        rows.push({ state: entry ? 'attended' : 'absent', stateLabel: ATTENDANCE_STATES[entry ? 'attended' : 'absent'], name: reg.name, studentId: reg.studentId, kind: reg.kind, kindLabel: KIND_LABELS[reg.kind] || reg.kind, regStatus: 'confirmed', at: entry?.at || '' });
    }
    for (const entry of session.attendance) {
        if (matched.has(entry.id)) continue;
        const waiting = waitlistOf(regs).some(reg => reg.key === entry.key || Boolean(reg.memberId && entry.memberId === reg.memberId));
        rows.push({ state: 'walkin', stateLabel: ATTENDANCE_STATES.walkin, name: entry.name, studentId: entry.studentId, kind: entry.kind, kindLabel: KIND_LABELS[entry.kind] || entry.kind, regStatus: waiting ? 'waitlist' : '', at: entry.at });
    }
    const count = state => rows.filter(row => row.state === state).length;
    return { rows, counts: { attended: count('attended'), absent: count('absent'), walkin: count('walkin') } };
}

// ---- CSV -----------------------------------------------------------------

// Spreadsheet programs run cells that start with = + - @ as formulas, and visitors type their own names.
export function csvCell(value) {
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

// Registration list with the three attendance states (rows from compareAttendance), plus the waitlist.
export function rosterCsv(session, regs) {
    const { rows } = compareAttendance(session, regs);
    const header = ['日期', '主題', '出席對照', '姓名', '學號', '類別', '報名狀態', '簽到時間'];
    const lines = rows.map(row => [session.date, session.topic, row.stateLabel, row.name, row.studentId, row.kindLabel, row.regStatus === 'confirmed' ? '已報名' : row.regStatus === 'waitlist' ? '候補' : '未報名', row.at]);
    for (const reg of waitlistOf(regs)) {
        if (!rows.some(row => row.state === 'walkin' && row.regStatus === 'waitlist' && row.name === reg.name && row.studentId === reg.studentId)) lines.push([session.date, session.topic, '候補（未到）', reg.name, reg.studentId, KIND_LABELS[reg.kind] || reg.kind, '候補', '']);
    }
    return `﻿${[header, ...lines].map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
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
                if (url.pathname.startsWith('/reg/')) return { status: 200, body: await classRegOp(storage, url.pathname.slice(5), payload, now) };
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
                    for (const reg of await loadRegs(storage, id)) await storage.delete(regKey(id, reg.seq));
                    return { status: 200, body: { success: true, session } };
                }
                if (url.pathname === '/op') {
                    const outcome = applyClassOp(session, payload.op, payload, payload.actor || {}, now);
                    session.updatedAt = now;
                    await storage.put(`class:${id}`, session);
                    // A bigger capacity frees seats for the waitlist; a smaller one never bumps anyone.
                    if (payload.op === 'update') await saveRegs(storage, session, promoteWaitlist(session, await loadRegs(storage, id), now));
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
