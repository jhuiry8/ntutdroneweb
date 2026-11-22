// Pure helpers for positions, terms (學年任期) and the officer roster: dates, profile validation,
// the public roster view and the CSV export. The OrgStore Durable Object (org-store.js) keeps the data.

export class OrgError extends Error {
    constructor(message, status = 400) { super(message); this.name = 'OrgError'; this.status = status; }
}

// Today in Taipei (UTC+8) as YYYY-MM-DD.
export function taipeiDate(now = Date.now()) { return new Date(now + 8 * 3600000).toISOString().slice(0, 10); }

export function validDate(value, label = '日期') {
    const text = String(value ?? '');
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    const parsed = match && new Date(`${text}T00:00:00Z`);
    if (!match || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) throw new OrgError(`${label}格式必須為 YYYY-MM-DD`);
    return text;
}
export function addDays(date, days) { return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10); }

// 民國學年：8 月 1 日起算（115 學年 = 2026-08-01 ~ 2027-07-31）。
export function academicYearOf(date = taipeiDate()) {
    const [year, month] = date.split('-').map(Number);
    return String((month >= 8 ? year : year - 1) - 1911);
}
export function validYear(value) {
    const year = String(value ?? '').trim();
    if (!/^\d{3}$/.test(year) || Number(year) < 100 || Number(year) > 199) throw new OrgError('學年格式必須為三位數，例如 115');
    return year;
}
export function termDefaults(year) {
    const west = Number(year) + 1911;
    return { start: `${west}-08-01`, end: `${west + 1}-07-31` };
}
export function yearLabel(year) { return `${year} 學年`; }

// An assignment counts on `today` when it started, was not ended earlier, and has not passed its end date.
export function assignmentActive(assignment, today) {
    if (assignment.start > today || today > assignment.end) return false;
    return !assignment.endedOn || today < assignment.endedOn;
}
export function assignmentStatus(assignment, today) {
    if (assignment.endedOn && today >= assignment.endedOn) return assignment.endedReason === 'replaced' ? 'replaced' : 'ended';
    if (assignment.start > today) return 'upcoming';
    if (today > assignment.end) return 'completed';
    return 'active';
}

// ---------- officer profile ----------

export const PROFILE_FIELDS = {
    name: { label: '姓名', max: 40 },
    studentId: { label: '學號', max: 20, pattern: /^[A-Za-z0-9-]{0,20}$/ },
    department: { label: '系級', max: 40 },
    email: { label: 'Email', max: 100, pattern: /^$|^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/ },
    phone: { label: '電話', max: 30, pattern: /^[0-9+\-#() ]{0,30}$/ },
    lineId: { label: 'LINE ID', max: 40, pattern: /^[A-Za-z0-9._@-]{0,40}$/ },
    bio: { label: '自我介紹', max: 600 },
    duties: { label: '負責業務', max: 600 },
    handover: { label: '交接事項', max: 1500 }
};
// The only fields the public /officers page can ever show (plus the assigned position and, for the photo, a public image).
export const PUBLIC_PROFILE_FIELDS = ['name', 'photo', 'bio'];

const stripControls = value => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g, '').trim();

export function normalizeProfile(input = {}, current = {}) {
    const fields = { ...(current.fields || {}) };
    for (const [key, spec] of Object.entries(PROFILE_FIELDS)) {
        if (input.fields?.[key] === undefined) continue;
        const text = stripControls(input.fields[key]);
        if (text.length > spec.max) throw new OrgError(`${spec.label}不可超過 ${spec.max} 字`);
        if (spec.pattern && !spec.pattern.test(text)) throw new OrgError(`${spec.label}格式不正確`);
        fields[key] = text;
    }
    let photoFileId = current.photoFileId || '';
    if (input.photoFileId !== undefined) {
        photoFileId = String(input.photoFileId || '');
        if (photoFileId && !/^[0-9a-f-]{36}$/.test(photoFileId)) throw new OrgError('大頭照檔案編號無效');
    }
    const visibility = { ...(current.visibility || {}) };
    for (const key of PUBLIC_PROFILE_FIELDS) if (input.visibility?.[key] !== undefined) visibility[key] = input.visibility[key] === true;
    return { fields, photoFileId, visibility };
}

// What the public page may show for one officer. Anything not on the allow-list is dropped here, so a new
// profile field can never leak by accident. `photoUrl` is filled by the route only for public image files.
export function publicOfficerView(entry) {
    const { profile = {}, position } = entry;
    const visible = key => profile.visibility?.[key] === true;
    const view = { position };
    if (visible('name') && profile.fields?.name) view.name = profile.fields.name;
    if (visible('bio') && profile.fields?.bio) view.bio = profile.fields.bio;
    if (visible('photo') && profile.photoFileId) view.photoFileId = profile.photoFileId;
    return view;
}

// ---------- CSV ----------

// Cells starting with = + - @ (also after spaces) are formulas in spreadsheets, so prefix them.
export function csvCell(value) {
    let cell = String(value ?? '');
    if (/^[\s]*[=+\-@]|^[\t\r]/.test(cell)) cell = `'${cell}`;
    return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}
export const STATUS_LABELS = { active: '在任', upcoming: '尚未到任', ended: '已解任', replaced: '已由他人遞補', completed: '任期屆滿' };
export function officersCsv(rows) {
    const header = ['學年', '職位', '姓名', '學號', '系級', 'Email', '電話', 'LINE ID', '任期起', '任期迄', '狀態', '負責業務'];
    const lines = [header, ...rows.map(row => [
        row.yearLabel, row.positionName, row.profile.fields?.name || row.displayName || '', row.profile.fields?.studentId || '', row.profile.fields?.department || '',
        row.profile.fields?.email || '', row.profile.fields?.phone || '', row.profile.fields?.lineId || '',
        row.start, row.endedOn ? addDays(row.endedOn, -1) : row.end, STATUS_LABELS[row.status] || row.status, row.profile.fields?.duties || ''
    ])];
    return '﻿' + lines.map(line => line.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
