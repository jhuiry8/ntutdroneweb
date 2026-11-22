// 活動報名：欄位驗證、名額／候補規則、檢視權限，以及 EventStore Durable Object。
//
// 活動存成 `event:<id>`，每筆報名各自存成 `reg:<eventId>:<seq>`（Durable Object 單一值上限 128 KiB，
// 全部放進活動物件會爆）。所有報名、取消、遞補都在同一個 DO 的 transaction 內完成，所以名額不會超賣。
// 候補順序 = seq 大小（先報先補）。
import { isExportRequest, exportStorage } from './do-export.js';
export class EventError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
}

export const EVENT_AUDIENCES = { public: '公開', members: '社員', officers: '幹部' };
export const EVENT_CATEGORIES = { flight: '飛行日', competition: '比賽', talk: '講座', trip: '出遊', other: '其他' };
export const MAX_EVENTS = 500;
export const MAX_REGISTRATIONS = 600;
export const TAIPEI_OFFSET_MS = 8 * 3600 * 1000;

const text = (value, max) => String(value ?? '').trim().slice(0, max);
const newId = () => crypto.randomUUID();
const pad = (n, width = 2) => String(n).padStart(width, '0');

// 'YYYY-MM-DDTHH:mm' (datetime-local) is Taipei local time; strings with Z/offset are taken as-is.
export function parseEventTime(value, label) {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    const local = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(raw);
    const ms = local ? Date.parse(`${local[1]}-${local[2]}-${local[3]}T${local[4]}:${local[5]}:00+08:00`) : (/(Z|[+-]\d{2}:?\d{2})$/.test(raw) ? Date.parse(raw) : NaN);
    if (!Number.isFinite(ms)) throw new EventError(`${label}格式錯誤`);
    return new Date(ms).toISOString();
}

// Taipei wall-clock parts of an instant: { date: 'YYYY-MM-DD', time: 'HH:mm' }.
export function taipeiParts(iso) {
    const d = new Date(Date.parse(iso) + TAIPEI_OFFSET_MS);
    return { date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` };
}
export const taipeiInput = iso => { if (!iso) return ''; const p = taipeiParts(iso); return `${p.date}T${p.time}`; };

export function normalizeEventFields(input, existing = null) {
    const pick = key => (input && input[key] !== undefined ? input[key] : existing?.[key]);
    const title = text(pick('title'), 120);
    if (!title) throw new EventError('請輸入活動標題');
    const startsAt = input?.startsAt !== undefined ? parseEventTime(input.startsAt, '活動時間') : existing?.startsAt;
    if (!startsAt) throw new EventError('請輸入活動時間');
    const endsAt = input?.endsAt !== undefined ? parseEventTime(input.endsAt, '結束時間') : (existing?.endsAt || null);
    if (endsAt && Date.parse(endsAt) < Date.parse(startsAt)) throw new EventError('結束時間不可早於開始時間');
    const registrationDeadline = input?.registrationDeadline !== undefined ? parseEventTime(input.registrationDeadline, '報名截止時間') : (existing?.registrationDeadline || null);
    if (registrationDeadline && Date.parse(registrationDeadline) > Date.parse(startsAt)) throw new EventError('報名截止時間不可晚於活動開始時間');
    const capacityRaw = pick('capacity');
    const capacity = capacityRaw === '' || capacityRaw === null || capacityRaw === undefined ? 0 : Number(capacityRaw);
    if (!Number.isInteger(capacity) || capacity < 0 || capacity > 5000) throw new EventError('名額必須是 0 至 5000 的整數（0 = 不限）');
    const audience = pick('audience') ?? 'public';
    if (!EVENT_AUDIENCES[audience]) throw new EventError('限制對象必須是公開、社員或幹部');
    const category = pick('category') ?? 'other';
    if (!EVENT_CATEGORIES[category]) throw new EventError('活動類別不存在');
    const feeRequired = pick('feeRequired') === true;
    const feeRaw = pick('feeAmount');
    const feeAmount = feeRaw === '' || feeRaw === null || feeRaw === undefined ? 0 : Number(feeRaw);
    if (!Number.isInteger(feeAmount) || feeAmount < 0 || feeAmount > 100000) throw new EventError('費用必須是 0 至 100000 的整數');
    return {
        title, category, description: text(pick('description'), 10000), startsAt, endsAt,
        location: text(pick('location'), 200), capacity, registrationDeadline, audience,
        feeRequired, feeAmount: feeRequired ? feeAmount : 0
    };
}

export function newEvent(input, username, now) {
    return { id: newId(), ...normalizeEventFields(input), nextSeq: 1, reminderSentAt: '', createdBy: username, createdAt: now, updatedAt: now };
}

// Who may see / sign up for an event. actor = { username, officer (may manage events), staff (may see officer-only content) } (username '' = visitor).
export function canViewEvent(event, actor) {
    if (event.audience === 'public') return true;
    if (event.audience === 'members') return Boolean(actor?.username);
    return Boolean(actor?.officer || actor?.staff);
}
export const canRegisterEvent = canViewEvent;

export const regSort = (a, b) => a.seq - b.seq;
export const confirmedOf = regs => regs.filter(reg => reg.status === 'confirmed');
export const waitlistOf = regs => regs.filter(reg => reg.status === 'waitlist').sort(regSort);

export function registrationDeadlineOf(event) { return event.registrationDeadline || event.startsAt; }
export function registrationOpen(event, now) {
    return Date.parse(now) <= Date.parse(registrationDeadlineOf(event)) && Date.parse(now) < Date.parse(event.startsAt);
}

// Promotes waitlisted people while seats are free. Returns the promoted registrations.
export function promoteWaitlist(event, regs, now) {
    const promoted = [];
    if (!event.capacity) {
        for (const reg of waitlistOf(regs)) { reg.status = 'confirmed'; reg.promotedAt = now; promoted.push(reg); }
        return promoted;
    }
    let free = event.capacity - confirmedOf(regs).length;
    for (const reg of waitlistOf(regs)) {
        if (free <= 0) break;
        reg.status = 'confirmed'; reg.promotedAt = now; free--; promoted.push(reg);
    }
    return promoted;
}

const STUDENT_ID = /^[A-Za-z0-9]{6,12}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
export function normalizeIdentity(fields, { requireContact }) {
    const name = text(fields?.name, 40);
    if (!name) throw new EventError('請輸入姓名');
    const studentId = text(fields?.studentId, 12).toUpperCase();
    const email = text(fields?.email, 254).toLowerCase();
    if (requireContact) {
        if (!STUDENT_ID.test(studentId)) throw new EventError('學號格式錯誤（6 至 12 位英數字）');
        if (!EMAIL.test(email)) throw new EventError('Email 格式錯誤');
    } else {
        if (studentId && !STUDENT_ID.test(studentId)) throw new EventError('學號格式錯誤（6 至 12 位英數字）');
        if (email && !EMAIL.test(email)) throw new EventError('Email 格式錯誤');
    }
    return { name, studentId, email };
}

export async function sha256Hex(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

const regKey = (eventId, seq) => `reg:${eventId}:${String(seq).padStart(8, '0')}`;
async function loadRegs(storage, eventId) {
    return [...(await storage.list({ prefix: `reg:${eventId}:` })).values()].sort(regSort);
}
async function loadEvent(storage, id) {
    const event = /^[\w-]{1,80}$/.test(String(id || '')) ? await storage.get(`event:${id}`) : null;
    if (!event) throw new EventError('找不到活動', 404);
    return event;
}
async function saveRegs(storage, event, regs) {
    for (const reg of regs) await storage.put(regKey(event.id, reg.seq), reg);
}

function duplicate(regs, who) {
    return regs.some(reg => (who.username && reg.username === who.username)
        || (!who.username && ((who.studentId && reg.studentId === who.studentId) || (who.email && reg.email === who.email))));
}

// Adds a registration; confirmed when a seat is free, otherwise on the waitlist.
async function addRegistration(storage, event, regs, who, now, { force = false } = {}) {
    if (regs.length >= MAX_REGISTRATIONS) throw new EventError('此活動報名人數已達系統上限', 409);
    if (duplicate(regs, who)) throw new EventError('您已報名此活動（學號或 Email 重複）', 409);
    const seats = event.capacity ? event.capacity - confirmedOf(regs).length : Infinity;
    // Anyone already waiting goes first, so a late arrival cannot jump the queue into a freed seat.
    const status = force || (seats > 0 && waitlistOf(regs).length === 0) ? 'confirmed' : 'waitlist';
    const reg = { id: newId(), eventId: event.id, seq: event.nextSeq, status, paid: false, createdAt: now, ...who };
    event.nextSeq += 1;
    await storage.put(regKey(event.id, reg.seq), reg);
    regs.push(reg);
    return reg;
}

export async function eventOp(storage, op, payload, now = new Date().toISOString()) {
    const actor = payload.actor || {};
    if (op === 'list') {
        const events = [...(await storage.list({ prefix: 'event:' })).values()];
        const counts = new Map();
        for (const reg of (await storage.list({ prefix: 'reg:' })).values()) {
            const entry = counts.get(reg.eventId) || { confirmed: 0, waitlist: 0, me: null };
            entry[reg.status === 'confirmed' ? 'confirmed' : 'waitlist']++;
            if (actor.username && reg.username === actor.username) entry.me = { id: reg.id, status: reg.status };
            counts.set(reg.eventId, entry);
        }
        return events.map(event => ({ event, ...(counts.get(event.id) || { confirmed: 0, waitlist: 0, me: null }) }));
    }
    if (op === 'create') {
        if (!actor.officer) throw new EventError('只有幹部可以建立活動', 403);
        if ((await storage.list({ prefix: 'event:' })).size >= MAX_EVENTS) throw new EventError(`活動已達 ${MAX_EVENTS} 筆上限`, 409);
        const event = newEvent(payload.fields, actor.username, now);
        await storage.put(`event:${event.id}`, event);
        return { event, regs: [] };
    }
    const event = await loadEvent(storage, payload.id);
    if (op === 'get') return { event, regs: await loadRegs(storage, event.id) };

    const officerOnly = () => { if (!actor.officer) throw new EventError('只有幹部可以管理活動', 403); };
    const regs = await loadRegs(storage, event.id);
    const save = async promoted => { event.updatedAt = now; await storage.put(`event:${event.id}`, event); if (promoted?.length) await saveRegs(storage, event, promoted); return { event, regs, promoted: promoted || [] }; };

    if (op === 'update') {
        officerOnly();
        const previousStart = event.startsAt;
        Object.assign(event, normalizeEventFields(payload.fields, event));
        // Rescheduled after the day-before reminder went out: remind again before the new date.
        if (event.startsAt !== previousStart) event.reminderSentAt = '';
        // A bigger capacity (or no limit) frees seats for the waitlist; a smaller one never bumps anyone.
        return save(promoteWaitlist(event, regs, now));
    }
    if (op === 'delete') {
        officerOnly();
        for (const reg of regs) await storage.delete(regKey(event.id, reg.seq));
        await storage.delete(`event:${event.id}`);
        return { success: true };
    }
    if (op === 'mark-reminded') { event.reminderSentAt = now; return save(); }

    if (op === 'register') {
        if (!canRegisterEvent(event, actor)) throw new EventError('您沒有報名此活動的資格', 403);
        if (!registrationOpen(event, now)) throw new EventError('報名已截止', 409);
        let who;
        if (actor.username) who = { kind: 'member', username: actor.username, memberId: actor.memberId || '', name: text(actor.name || actor.username, 40), studentId: text(actor.studentId, 12).toUpperCase(), email: text(actor.email, 254).toLowerCase() };
        else {
            if (event.audience !== 'public') throw new EventError('此活動僅開放登入的社員報名', 403);
            who = { kind: 'guest', username: '', memberId: '', ...normalizeIdentity(payload.guest, { requireContact: true }) };
            who.cancelHash = String(payload.cancelHash || '');
        }
        const reg = await addRegistration(storage, event, regs, who, now);
        await save();
        return { event, regs, reg };
    }
    if (op === 'add') {
        officerOnly();
        const who = { kind: 'manual', username: '', memberId: '', addedBy: actor.username, ...normalizeIdentity(payload.person, { requireContact: false }) };
        if (!who.studentId && !who.email) throw new EventError('請至少填寫學號或 Email，以避免重複報名');
        const reg = await addRegistration(storage, event, regs, who, now, { force: payload.person?.force === true });
        await save();
        return { event, regs, reg };
    }
    if (op === 'cancel' || op === 'remove' || op === 'set-paid') {
        const reg = regs.find(entry => entry.id === String(payload.regId || '') || (actor.username && !payload.regId && entry.username === actor.username));
        if (!reg) throw new EventError('找不到報名紀錄', 404);
        if (op === 'set-paid') { officerOnly(); reg.paid = payload.paid === true; await storage.put(regKey(event.id, reg.seq), reg); return { event, regs, reg }; }
        if (op === 'remove') officerOnly();
        if (op === 'cancel' && !actor.officer) {
            const mine = actor.username && reg.username === actor.username;
            const guestOk = !reg.username && reg.cancelHash && payload.cancelHash && reg.cancelHash === payload.cancelHash;
            if (!mine && !guestOk) throw new EventError('找不到報名紀錄', 404);
            if (Date.parse(now) >= Date.parse(event.startsAt)) throw new EventError('活動已開始，無法自行取消，請洽幹部', 409);
        }
        await storage.delete(regKey(event.id, reg.seq));
        regs.splice(regs.indexOf(reg), 1);
        const wasConfirmed = reg.status === 'confirmed';
        const promoted = wasConfirmed ? promoteWaitlist(event, regs, now) : [];
        if (promoted.length) await saveRegs(storage, event, promoted);
        return { event, regs, removed: reg, promoted };
    }
    throw new EventError('操作不存在', 404);
}

export class EventStore {
    constructor(ctx) { this.storage = ctx.storage; }

    async fetch(request) {
        try {
            if (isExportRequest(request)) return await exportStorage(this.storage);
            const payload = await request.json();
            const op = new URL(request.url).pathname.slice(1);
            const body = await this.storage.transaction(storage => eventOp(storage, op, payload));
            return Response.json(body);
        } catch (error) {
            if (error instanceof EventError) return Response.json({ error: error.message }, { status: error.status });
            console.error('Event store failed', error?.message || String(error));
            return Response.json({ error: '活動資料操作失敗' }, { status: 500 });
        }
    }
}
