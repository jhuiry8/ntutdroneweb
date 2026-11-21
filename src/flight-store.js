// 飛行紀錄簿 and 證照追蹤: validation, pure helpers and the FlightStore Durable Object.
// Everything lives in one FlightStore so records, confirmations and reminder markers stay consistent.
//
// Keys
//   log:<id>          flight record (see normalizeFlight); owner = { username, memberId, name }
//   cert:<id>         CAA operator certificate (see normalizeCertificate)
//   settings          { certCategories: [..] }
//   remind:<id>:<d>   reminder marker for certificate <id> at threshold <d> (90 or 30) days
import { ValidationError, financeDate } from './validation.js';

export class FlightError extends Error {
    constructor(message, status = 400) { super(message); this.name = 'FlightError'; this.status = status; }
}

export const FLIGHT_TYPES = { aerial: '空拍', fpv: 'FPV', teaching: '教學', exam_practice: '考照練習', simulator: '模擬器' };
export const DEFAULT_CERT_CATEGORIES = ['普通操作證', '專業操作證（基本級）', '專業操作證（高級）', '其他'];
export const REMINDER_DAYS = [90, 30];
export const MAX_FLIGHTS = 50000;
export const MAX_CERTIFICATES = 5000;
const DAY_MS = 86400000;

// Today in Taipei (UTC+8), as YYYY-MM-DD.
export function taipeiToday(now = Date.now()) {
    return new Date(now + 8 * 3600000).toISOString().slice(0, 10);
}
export function daysBetween(from, to) {
    return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

const text = (value, max, label, required = false) => {
    const result = String(value ?? '').trim();
    if (required && !result) throw new FlightError(`${label} 為必填`);
    if (result.length > max) throw new FlightError(`${label} 不可超過 ${max} 字`);
    return result;
};
const validDate = (value, label) => {
    try { return financeDate(value); } catch (error) {
        if (error instanceof ValidationError) throw new FlightError(`${label}：${error.message}`);
        throw error;
    }
};
const integer = (value, min, max, label) => {
    const number = Number(value);
    if (!Number.isInteger(number) || number < min || number > max) throw new FlightError(`${label} 需為 ${min} 至 ${max} 的整數`);
    return number;
};

// asset: { id, assetNo, assetName } already looked up by the route (or null).
export function normalizeFlight(fields, asset, today = taipeiToday()) {
    const date = validDate(fields?.date, '飛行日期');
    if (daysBetween(today, date) > 1) throw new FlightError('飛行日期不可是未來的日期');
    const type = String(fields?.type ?? '');
    if (!FLIGHT_TYPES[type]) throw new FlightError('飛行類型無效');
    const aircraft = text(fields?.aircraft, 100, '機型');
    if (!aircraft && !asset) throw new FlightError('請填寫機型或選擇社團設備');
    const incident = fields?.incident === true;
    return {
        date, location: text(fields?.location, 100, '地點', true), type,
        aircraft: aircraft || asset.assetName,
        assetId: asset?.id || '', assetNo: asset?.assetNo || '', assetName: asset?.assetName || '',
        minutes: integer(fields?.minutes, 1, 1440, '時長（分鐘）'),
        sorties: fields?.sorties === undefined || fields?.sorties === '' ? 1 : integer(fields.sorties, 1, 999, '架次'),
        weather: text(fields?.weather, 100, '天氣'), note: text(fields?.note, 1000, '備註'),
        incident, incidentNote: incident ? text(fields?.incidentNote, 1000, '異常或事故說明', true) : ''
    };
}

export function normalizeCertificate(fields, categories, today = taipeiToday()) {
    const category = String(fields?.category ?? '').trim();
    if (!categories.includes(category)) throw new FlightError('證照類別無效');
    const issueDate = validDate(fields?.issueDate, '核發日');
    const expiryDate = validDate(fields?.expiryDate, '到期日');
    if (expiryDate < issueDate) throw new FlightError('到期日不可早於核發日');
    const photoUrl = text(fields?.photoUrl, 500, '照片網址');
    if (photoUrl && !/^https:\/\/[^\s<>"']+$/i.test(photoUrl)) throw new FlightError('照片網址需為 https:// 開頭的網址');
    return { category, certNo: text(fields?.certNo, 60, '證號', true), issueDate, expiryDate, photoUrl, note: text(fields?.note, 500, '備註') };
}

export function normalizeCategories(input) {
    const list = [...new Set((Array.isArray(input) ? input : []).map(item => String(item ?? '').trim()).filter(Boolean))];
    if (!list.length) throw new FlightError('至少需要一個證照類別');
    if (list.length > 30 || list.some(item => item.length > 40)) throw new FlightError('證照類別最多 30 個，每個不可超過 40 字');
    return list;
}

export function certStatus(cert, today = taipeiToday()) {
    const daysLeft = daysBetween(today, cert.expiryDate);
    const status = daysLeft < 0 ? 'expired' : daysLeft <= 30 ? 'expiring30' : daysLeft <= 90 ? 'expiring90' : 'valid';
    return { daysLeft, status };
}

export const ownedBy = (item, actor) => item.owner?.username === actor.username || Boolean(actor.memberId && item.owner?.memberId === actor.memberId);
const sameOwner = (a, b) => a.username === b.username && (a.memberId || '') === (b.memberId || '');

// Aggregates a list of flight records.
export function summarizeFlights(flights, { detailed = false } = {}) {
    const empty = () => ({ flights: 0, minutes: 0, sorties: 0 });
    const add = (bucket, flight) => { bucket.flights++; bucket.minutes += flight.minutes; bucket.sorties += flight.sorties; };
    const total = { ...empty(), confirmedMinutes: 0, incidents: 0 };
    const byType = Object.fromEntries(Object.keys(FLIGHT_TYPES).map(type => [type, empty()]));
    const members = new Map(), assets = new Map();
    for (const flight of flights) {
        add(total, flight);
        if (flight.status === 'confirmed') total.confirmedMinutes += flight.minutes;
        if (flight.incident) total.incidents++;
        add(byType[flight.type] ||= empty(), flight);
        if (!detailed) continue;
        const memberKey = flight.owner.memberId || `u:${flight.owner.username}`;
        add(members.get(memberKey) || members.set(memberKey, { ...empty(), name: flight.owner.name, username: flight.owner.username, memberId: flight.owner.memberId, incidents: 0 }).get(memberKey), flight);
        if (flight.incident) members.get(memberKey).incidents++;
        if (flight.assetId) add(assets.get(flight.assetId) || assets.set(flight.assetId, { ...empty(), assetId: flight.assetId, assetNo: flight.assetNo, assetName: flight.assetName }).get(flight.assetId), flight);
    }
    const byMinutes = (a, b) => b.minutes - a.minutes;
    return { ...total, hours: Math.round(total.minutes / 6) / 10, byType, ...(detailed ? { byMember: [...members.values()].sort(byMinutes), byAsset: [...assets.values()].sort(byMinutes) } : {}) };
}

export function summarizeCertificates(certs, today = taipeiToday()) {
    const counts = { total: certs.length, valid: 0, expiring90: 0, expiring30: 0, expired: 0 };
    const byCategory = {};
    const holders = new Set();
    for (const cert of certs) {
        const { status } = certStatus(cert, today);
        counts[status]++;
        byCategory[cert.category] ||= { total: 0, valid: 0, expiring90: 0, expiring30: 0, expired: 0 };
        byCategory[cert.category].total++; byCategory[cert.category][status]++;
        if (status !== 'expired') holders.add(cert.owner.memberId || `u:${cert.owner.username}`);
    }
    return { ...counts, validHolders: holders.size, byCategory };
}

export async function flightOp(storage, op, payload, now = Date.now()) {
    const actor = payload.actor;
    if (!actor?.username) throw new FlightError('未授權', 401);
    const today = taipeiToday(now);
    const stamp = new Date(now).toISOString();
    const list = async prefix => [...(await storage.list({ prefix })).values()];
    const requireOfficer = () => { if (!actor.officer) throw new FlightError('權限不足', 403); };
    const settings = async () => ({ certCategories: DEFAULT_CERT_CATEGORIES, ...(await storage.get('settings')) });
    const checkOwner = owner => {
        if (!owner?.username && !owner?.memberId) throw new FlightError('找不到對象社員');
        if (!actor.officer && !sameOwner(owner, { username: actor.username, memberId: actor.memberId })) throw new FlightError('只能登錄自己的資料', 403);
        return { username: String(owner.username || ''), memberId: String(owner.memberId || ''), name: String(owner.name || owner.username || '') };
    };
    const visible = items => items.filter(item => actor.officer && payload.scope === 'all' ? true : ownedBy(item, actor));
    const wantAll = payload.scope === 'all';
    if (wantAll) requireOfficer();
    // An officer asking for a record by id may see anyone's; a member only their own.
    const load = async (key, id, label) => {
        const item = /^[\w-]{1,80}$/.test(String(id)) ? await storage.get(`${key}:${id}`) : null;
        if (!item || (!actor.officer && !ownedBy(item, actor))) throw new FlightError(`${label}不存在`, 404);
        return item;
    };

    // ───── flight log ─────
    if (op === 'log-create') {
        const owner = checkOwner(payload.owner);
        if ((await list('log:')).length >= MAX_FLIGHTS) throw new FlightError('飛行紀錄已達上限', 409);
        const confirmed = actor.officer && !ownedBy({ owner }, actor);
        const flight = {
            id: crypto.randomUUID(), owner, ...normalizeFlight(payload.fields, payload.asset, today),
            status: confirmed ? 'confirmed' : 'pending', createdBy: actor.username, createdAt: stamp,
            ...(confirmed ? { confirmedBy: actor.username, confirmedAt: stamp } : {})
        };
        await storage.put(`log:${flight.id}`, flight);
        return flight;
    }
    if (op === 'log-list') {
        const f = payload.filters || {};
        let flights = visible(await list('log:'));
        if (f.type) flights = flights.filter(item => item.type === f.type);
        if (f.incident) flights = flights.filter(item => item.incident);
        if (f.status) flights = flights.filter(item => item.status === f.status);
        if (f.assetId) flights = flights.filter(item => item.assetId === f.assetId);
        if (f.from) flights = flights.filter(item => item.date >= f.from);
        if (f.to) flights = flights.filter(item => item.date <= f.to);
        if (f.owner && actor.officer) flights = flights.filter(item => item.owner.username === f.owner || item.owner.memberId === f.owner);
        return flights.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 2000);
    }
    if (op === 'log-summary') {
        return summarizeFlights(visible(await list('log:')), { detailed: wantAll });
    }
    if (op === 'log-update' || op === 'log-delete' || op === 'log-confirm') {
        const flight = await load('log', payload.id, '飛行紀錄');
        if (op === 'log-confirm') {
            requireOfficer();
            if (ownedBy(flight, actor)) throw new FlightError('不可確認自己的紀錄', 403);
            Object.assign(flight, { status: 'confirmed', confirmedBy: actor.username, confirmedAt: stamp });
        } else {
            if (!actor.officer && flight.status === 'confirmed') throw new FlightError('已確認的紀錄只有幹部可以修改', 403);
            if (op === 'log-delete') { await storage.delete(`log:${flight.id}`); return { success: true }; }
            const asset = payload.asset === undefined ? (flight.assetId ? { id: flight.assetId, assetNo: flight.assetNo, assetName: flight.assetName } : null) : payload.asset;
            Object.assign(flight, normalizeFlight({ ...flight, ...payload.fields }, asset, today), { updatedBy: actor.username, updatedAt: stamp });
            // A member's edit never leaves a confirmation the officer did not see.
            if (!actor.officer) flight.status = 'pending';
        }
        await storage.put(`log:${flight.id}`, flight);
        return flight;
    }

    // ───── certificates ─────
    const decorate = cert => ({ ...cert, ...certStatus(cert, today) });
    if (op === 'cert-categories') return (await settings()).certCategories;
    if (op === 'cert-set-categories') {
        if (!actor.editor) throw new FlightError('只有社長或幹部可以設定證照類別', 403);
        const certCategories = normalizeCategories(payload.categories);
        await storage.put('settings', { ...(await settings()), certCategories });
        return certCategories;
    }
    if (op === 'cert-create') {
        const owner = checkOwner(payload.owner);
        if ((await list('cert:')).length >= MAX_CERTIFICATES) throw new FlightError('證照資料已達上限', 409);
        const cert = { id: crypto.randomUUID(), owner, ...normalizeCertificate(payload.fields, (await settings()).certCategories, today), createdBy: actor.username, createdAt: stamp };
        await storage.put(`cert:${cert.id}`, cert);
        return decorate(cert);
    }
    if (op === 'cert-list') {
        return visible(await list('cert:')).map(decorate).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
    }
    if (op === 'cert-expiring') {
        requireOfficer();
        const withDays = (await list('cert:')).map(decorate);
        const order = (a, b) => a.expiryDate.localeCompare(b.expiryDate);
        return {
            today,
            expired: withDays.filter(c => c.status === 'expired').sort(order),
            expiring: withDays.filter(c => c.status === 'expiring30' || c.status === 'expiring90').sort(order)
        };
    }
    if (op === 'cert-summary') {
        requireOfficer();
        return summarizeCertificates(await list('cert:'), today);
    }
    if (op === 'cert-update' || op === 'cert-delete') {
        const cert = await load('cert', payload.id, '證照');
        if (op === 'cert-delete') {
            await storage.delete(`cert:${cert.id}`);
            for (const days of REMINDER_DAYS) await storage.delete(`remind:${cert.id}:${days}`);
            return { success: true };
        }
        const before = cert.expiryDate;
        Object.assign(cert, normalizeCertificate({ ...cert, ...payload.fields }, (await settings()).certCategories, today), { updatedBy: actor.username, updatedAt: stamp });
        // A renewed expiry date starts the reminder cycle again.
        if (cert.expiryDate !== before) for (const days of REMINDER_DAYS) await storage.delete(`remind:${cert.id}:${days}`);
        await storage.put(`cert:${cert.id}`, cert);
        return decorate(cert);
    }

    // Cron: certificates that crossed a reminder threshold and were not reminded yet.
    // The caller sends the notices and then calls cert-mark-reminded.
    if (op === 'cert-due-reminders') {
        if (!actor.system) throw new FlightError('權限不足', 403);
        const due = [];
        for (const cert of await list('cert:')) {
            const { daysLeft } = certStatus(cert, today);
            if (daysLeft < 0) continue;
            const threshold = REMINDER_DAYS.filter(days => daysLeft <= days).sort((a, b) => a - b)[0];
            if (!threshold) continue;
            if (await storage.get(`remind:${cert.id}:${threshold}`)) continue;
            due.push({ ...decorate(cert), threshold });
        }
        return due;
    }
    if (op === 'cert-mark-reminded') {
        if (!actor.system) throw new FlightError('權限不足', 403);
        for (const item of Array.isArray(payload.items) ? payload.items : []) {
            if (!/^[\w-]{1,80}$/.test(String(item.id)) || !REMINDER_DAYS.includes(item.threshold)) continue;
            // Reaching 30 days also settles the 90-day notice so it is never sent late.
            for (const days of REMINDER_DAYS.filter(days => days >= item.threshold)) await storage.put(`remind:${item.id}:${days}`, stamp);
        }
        return { success: true };
    }
    throw new FlightError('操作不存在', 404);
}

export class FlightStore {
    constructor(ctx) { this.storage = ctx.storage; }

    async fetch(request) {
        try {
            const payload = await request.json();
            const op = new URL(request.url).pathname.slice(1);
            const body = await this.storage.transaction(storage => flightOp(storage, op, payload));
            return Response.json(body);
        } catch (error) {
            if (error instanceof FlightError) return Response.json({ error: error.message }, { status: error.status });
            console.error('Flight store failed', error?.message || String(error));
            return Response.json({ error: '飛行資料操作失敗' }, { status: 500 });
        }
    }
}
