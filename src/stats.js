// 社務統計報表: pure functions that turn the club's records into the numbers behind the charts on
// /admin/stats. Nothing here reads storage; stats-routes.js fetches the records (finance only for
// presidents and finance officers) and passes them in. `csvTables()` builds the per-section CSV.
import { MEMBER_LEVELS, membershipStatus, validSemester, semesterOf, previousSemester } from './membership.js';
import { FLIGHT_TYPES } from './flight-store.js';
import { compareAttendance, csvCell } from './classes.js';
import { confirmedOf, waitlistOf, taipeiParts } from './events.js';

export const STAT_SECTIONS = ['members', 'classes', 'events', 'finance', 'equipment', 'flights'];
export const FINANCE_ONLY = ['finance'];
export const EQUIPMENT_STATUSES = { storage: '庫存保管', in_use: '借出／使用中', repair: '維修', retired: '除列' };

// ROC term → inclusive date range. 115-1 = 2026-08-01 … 2027-01-31, 115-2 = 2027-02-01 … 2027-07-31.
export function semesterRange(semester) {
    if (!validSemester(semester)) return null;
    const [roc, term] = semester.split('-').map(Number);
    const year = roc + 1911;
    return term === 1 ? { from: `${year}-08-01`, to: `${year + 1}-01-31` } : { from: `${year + 1}-02-01`, to: `${year + 1}-07-31` };
}
export const inRange = (date, range) => Boolean(date) && String(date).slice(0, 10) >= range.from && String(date).slice(0, 10) <= range.to;
// The instant used to judge membership validity for a term: today if the term is running, otherwise its nearest edge.
export function semesterAsOf(semester, now = new Date()) {
    const range = semesterRange(semester);
    const day = now.toISOString().slice(0, 10);
    if (day < range.from) return new Date(`${range.from}T00:00:00Z`);
    if (day > range.to) return new Date(`${range.to}T00:00:00Z`);
    return now;
}
// Current term and the five before it, newest first.
export function semesterChoices(now = new Date(), count = 6) {
    const list = [];
    for (let term = semesterOf(now); list.length < count && term; term = previousSemester(term)) list.push(term);
    return list;
}

const slice = (key, label, value) => ({ key, label, value });
const pct = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : null);

// ---- members -----------------------------------------------------------------
export function memberStats(roster, semester, now = new Date()) {
    const asOf = semesterAsOf(semester, now);
    const level = Object.fromEntries(Object.keys(MEMBER_LEVELS).map(key => [key, 0]));
    const fee = { semester: 0, lifetime: 0, exempt: 0, unpaid: 0 };
    for (const member of roster) {
        const status = membershipStatus(member, asOf);
        level[status.level]++;
        if (status.paid) fee[status.feeStatus === 'lifetime' ? 'lifetime' : 'semester']++;
        else if (status.exempt) fee.exempt++;
        else fee.unpaid++;
    }
    return {
        total: roster.length,
        byLevel: Object.entries(MEMBER_LEVELS).map(([key, label]) => slice(key, label, level[key])),
        byFee: [slice('semester', '一年會籍', fee.semester), slice('lifetime', '在學會籍', fee.lifetime), slice('exempt', '幹部免繳', fee.exempt), slice('unpaid', '未繳費', fee.unpaid)],
        note: '級別為目前名冊的狀態；會籍與繳費狀態依所選學期判定。'
    };
}

// ---- classes -------------------------------------------------------------------
// sessions: class sessions (with attendance); regs: every registration ({ classId, status, key, memberId }).
export function classStats(sessions, regs, roster, semester) {
    const range = semesterRange(semester);
    const inTerm = sessions.filter(session => inRange(session.date, range)).sort((a, b) => `${a.date} ${a.time || ''}`.localeCompare(`${b.date} ${b.time || ''}`));
    const rows = inTerm.map(session => {
        const mine = regs.filter(reg => reg.classId === session.id);
        const registered = confirmedOf(mine).length;
        const attended = session.attendance.length;
        const matched = compareAttendance(session, mine).counts.attended;
        return { id: session.id, date: session.date, topic: session.topic, label: `${session.date.slice(5)} ${session.topic}`, registered, waitlist: waitlistOf(mine).length, attended, registeredAttended: matched, rate: pct(matched, registered), registration: session.registrationEnabled === true };
    });
    // Trial members who came in this term and are no longer trial members now.
    const trialIds = new Set();
    for (const session of inTerm) for (const entry of session.attendance) if (entry.kind === 'trial' && entry.memberId) trialIds.add(entry.memberId);
    const converted = [...trialIds].filter(id => { const member = roster.find(item => item.id === id); return member && membershipStatus(member).level !== 'trial'; }).length;
    const registered = rows.reduce((sum, row) => sum + row.registered, 0);
    const matchedTotal = rows.reduce((sum, row) => sum + row.registeredAttended, 0);
    return {
        sessions: rows,
        totals: { sessions: rows.length, registered, attended: rows.reduce((sum, row) => sum + row.attended, 0), attendanceRate: pct(matchedTotal, registered) },
        conversion: { trialAttendees: trialIds.size, converted, rate: pct(converted, trialIds.size) }
    };
}

// ---- events --------------------------------------------------------------------
// list: [{ event, confirmed, waitlist }] from EventStore.
export function eventStats(list, semester) {
    const range = semesterRange(semester);
    const events = list.filter(entry => inRange(taipeiParts(entry.event.startsAt).date, range))
        .sort((a, b) => a.event.startsAt.localeCompare(b.event.startsAt))
        .map(({ event, confirmed, waitlist }) => ({ id: event.id, date: taipeiParts(event.startsAt).date, title: event.title, label: `${taipeiParts(event.startsAt).date.slice(5)} ${event.title}`, confirmed, waitlist }));
    return { events, totals: { events: events.length, confirmed: events.reduce((sum, item) => sum + item.confirmed, 0), waitlist: events.reduce((sum, item) => sum + item.waitlist, 0) } };
}

// ---- finance (president / finance only: the route never calls this for anyone else) --------
export function financeStats(transactions, budgets, semester) {
    const range = semesterRange(semester);
    const approved = transactions.filter(item => item.status === 'approved' && item.kind !== 'transfer');
    const names = new Map(budgets.map(item => [item.id, item.name]));
    const nameOf = id => names.get(id) || '未分類';
    const inTerm = approved.filter(item => inRange(item.date, range));
    const group = kind => {
        const totals = new Map();
        for (const item of inTerm) if (item.kind === kind) totals.set(nameOf(item.budgetId), (totals.get(nameOf(item.budgetId)) || 0) + (item[kind] || 0));
        return [...totals].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    };
    const months = [];
    for (let [y, m] = range.from.slice(0, 7).split('-').map(Number), i = 0; i < 6; i++, m++) { if (m > 12) { m = 1; y++; } months.push(`${y}-${String(m).padStart(2, '0')}`); }
    const monthly = months.map(month => ({
        month, label: month.slice(2),
        income: inTerm.filter(item => item.date.startsWith(month)).reduce((sum, item) => sum + (item.income || 0), 0),
        expense: inTerm.filter(item => item.date.startsWith(month)).reduce((sum, item) => sum + (item.expense || 0), 0)
    }));
    // Same definition as the finance page: approved expenses against each planned amount. Budgets have no term, so the
    // all-time spend is the execution rate; the term's own spend is shown beside it.
    const spent = new Map(), spentTerm = new Map();
    for (const item of approved) if (item.kind === 'expense' && item.budgetId) {
        spent.set(item.budgetId, (spent.get(item.budgetId) || 0) + item.expense);
        if (inRange(item.date, range)) spentTerm.set(item.budgetId, (spentTerm.get(item.budgetId) || 0) + item.expense);
    }
    return {
        totals: { income: inTerm.reduce((sum, item) => sum + (item.income || 0), 0), expense: inTerm.reduce((sum, item) => sum + (item.expense || 0), 0) },
        incomeByBudget: group('income'), expenseByBudget: group('expense'), monthly,
        budgets: budgets.map(item => ({ name: item.name, planned: item.planned, spent: spent.get(item.id) || 0, spentInSemester: spentTerm.get(item.id) || 0, rate: pct(spent.get(item.id) || 0, item.planned) })),
        note: '預算執行率沿用財務管理頁的算法（已核准支出累計 ÷ 預算金額）；收支圓餅圖與每月長條圖只計所選學期的已核准帳目。'
    };
}

// ---- equipment -------------------------------------------------------------------
// assets: register entries; histories: Map assetId → [{ since, ... }] loan history.
export function equipmentStats(assets, histories, semester) {
    const range = semesterRange(semester);
    const byStatus = Object.entries(EQUIPMENT_STATUSES).map(([key, label]) => slice(key, label, assets.filter(asset => asset.status === key).length));
    const ranking = assets.map(asset => ({ assetNo: asset.assetNo, assetName: asset.assetName, loans: (histories.get(asset.id) || []).filter(entry => inRange(entry.since || entry.startDate, range)).length }))
        .filter(item => item.loans > 0).sort((a, b) => b.loans - a.loans || String(a.assetNo).localeCompare(String(b.assetNo))).slice(0, 10);
    return { total: assets.length, byStatus, ranking };
}

// ---- flights ---------------------------------------------------------------------
export function flightStats(flights, semester) {
    const range = semesterRange(semester);
    const inTerm = flights.filter(flight => inRange(flight.date, range));
    const minutes = Object.fromEntries(Object.keys(FLIGHT_TYPES).map(type => [type, 0]));
    for (const flight of inTerm) minutes[flight.type] = (minutes[flight.type] || 0) + flight.minutes;
    const hours = value => Math.round(value / 6) / 10;
    return {
        flights: inTerm.length, hours: hours(inTerm.reduce((sum, flight) => sum + flight.minutes, 0)), incidents: inTerm.filter(flight => flight.incident).length,
        byType: Object.entries(FLIGHT_TYPES).map(([key, label]) => slice(key, label, hours(minutes[key] || 0)))
    };
}

// ---- CSV ---------------------------------------------------------------------------
// Each section becomes one or more tables; a table is an array of rows, the first being the header.
export function csvTables(section, data) {
    if (section === 'members') return [
        [['級別', '人數'], ...data.byLevel.map(item => [item.label, item.value])],
        [['會籍與繳費狀態', '人數'], ...data.byFee.map(item => [item.label, item.value])]
    ];
    if (section === 'classes') return [
        [['日期', '主題', '報名（已確認）', '候補', '出席', '已報名已到', '出席率（%）'], ...data.sessions.map(row => [row.date, row.topic, row.registered, row.waitlist, row.attended, row.registeredAttended, row.rate ?? ''])],
        [['本學期體驗出席人數', '已轉正式', '轉正式比例（%）'], [data.conversion.trialAttendees, data.conversion.converted, data.conversion.rate ?? '']]
    ];
    if (section === 'events') return [[['日期', '活動', '報名（已確認）', '候補'], ...data.events.map(row => [row.date, row.title, row.confirmed, row.waitlist])]];
    if (section === 'finance') return [
        [['收入分類', '金額'], ...data.incomeByBudget.map(item => [item.label, item.value])],
        [['支出分類', '金額'], ...data.expenseByBudget.map(item => [item.label, item.value])],
        [['月份', '收入', '支出'], ...data.monthly.map(row => [row.month, row.income, row.expense])],
        [['預算分類', '預算', '累計支出', '本學期支出', '執行率（%）'], ...data.budgets.map(row => [row.name, row.planned, row.spent, row.spentInSemester, row.rate ?? ''])]
    ];
    if (section === 'equipment') return [
        [['設備狀態', '件數'], ...data.byStatus.map(item => [item.label, item.value])],
        [['財產編號', '設備', '借用次數'], ...data.ranking.map(item => [item.assetNo, item.assetName, item.loans])]
    ];
    if (section === 'flights') return [[['飛行類型', '時數'], ...data.byType.map(item => [item.label, item.value])]];
    return [];
}
// BOM so Excel reads UTF-8; csvCell neutralizes = + - @ formulas and quotes commas, quotes and newlines.
export function statsCsv(section, data) {
    return `﻿${csvTables(section, data).map(table => table.map(row => row.map(csvCell).join(',')).join('\r\n')).join('\r\n\r\n')}\r\n`;
}
