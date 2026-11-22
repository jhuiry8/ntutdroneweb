// 學期財務報告 (預算書、決算書): built from the ledger, frozen into a snapshot when the 總務 submits it
// for review, and voted on by the 法規監察委員會 in a meeting (章程第十一條第二款、第十二條).
// This module holds the pure calculations and the KV storage; the HTTP routes are in finance-report-routes.js.
import { FINANCE_REPORTS_KEY, FINANCE_REPORT_PREFIX, FINANCE_TRANSACTIONS_KEY, FINANCE_BUDGETS_KEY } from './kv-keys.js';
import { parseStoredList } from './validation.js';
import { semesterOf, validSemester, previousSemester } from './membership.js';

export class ReportError extends Error {
    constructor(message, status = 400) { super(message); this.name = 'ReportError'; this.status = status; }
}

export const REPORT_KINDS = { budget: '預算書', settlement: '決算書' };
export const REPORT_STATUSES = { draft: '草稿', submitted: '送審中', approved: '委員會審核通過', returned: '退回', superseded: '已由新版取代' };
export const MAX_REPORT_TRANSACTIONS = 3000;
export const MAX_COMMENTS = 200;

// 115-1 → 2026-08-01 ~ 2027-01-31; 115-2 → 2027-02-01 ~ 2027-07-31.
export function semesterRange(semester) {
    if (!validSemester(semester)) throw new ReportError('學期格式必須為 115-1 或 115-2');
    const [year, term] = semester.split('-').map(Number);
    const west = year + 1911;
    return term === 1 ? { start: `${west}-08-01`, end: `${west + 1}-01-31` } : { start: `${west + 1}-02-01`, end: `${west + 1}-07-31` };
}
export const reportTitle = (semester, kind) => `${semester} 學期${REPORT_KINDS[kind]}`;

const sum = (items, key) => items.reduce((total, item) => total + (item[key] || 0), 0);

// The numbers of one semester, from approved ledger entries only (pending ones are only counted).
export function buildSnapshot({ semester, kind, transactions, budgets, now }) {
    if (!REPORT_KINDS[kind]) throw new ReportError('報告類型必須是預算書或決算書');
    const { start, end } = semesterRange(semester);
    const approved = transactions.filter(item => item.status === 'approved');
    const before = approved.filter(item => item.date < start);
    const period = approved.filter(item => item.date >= start && item.date <= end);
    const pending = transactions.filter(item => item.status === 'pending' && item.date >= start && item.date <= end);
    const names = new Map(budgets.map(item => [item.id, item.name]));
    const categories = budgets.map(budget => {
        const spent = sum(period.filter(item => item.budgetId === budget.id), 'expense');
        const earned = sum(period.filter(item => item.budgetId === budget.id), 'income');
        return { id: budget.id, name: budget.name, planned: budget.planned, expense: spent, income: earned, rate: budget.planned > 0 ? Math.round(spent / budget.planned * 1000) / 10 : null };
    });
    const known = new Set(budgets.map(item => item.id));
    const loose = period.filter(item => !known.has(item.budgetId));
    const detail = [...period, ...pending].sort((a, b) => a.date.localeCompare(b.date) || String(a.createdAt).localeCompare(String(b.createdAt)));
    if (detail.length > MAX_REPORT_TRANSACTIONS) throw new ReportError(`這個學期的帳目超過 ${MAX_REPORT_TRANSACTIONS} 筆，無法產生報告`, 413);
    const opening = { cash: sum(before, 'cashDelta'), postal: sum(before, 'postalDelta') };
    const delta = { cash: sum(period, 'cashDelta'), postal: sum(period, 'postalDelta') };
    return {
        semester, kind, title: reportTitle(semester, kind), period: { start, end }, generatedAt: now,
        opening, closing: { cash: opening.cash + delta.cash, postal: opening.postal + delta.postal },
        totals: { income: sum(period, 'income'), expense: sum(period, 'expense'), planned: sum(budgets, 'planned'), pendingCount: pending.length },
        categories, uncategorized: { income: sum(loose, 'income'), expense: sum(loose, 'expense') },
        transactions: detail.map(item => ({
            id: item.id, date: item.date, item: item.item, kind: item.kind, income: item.income || 0, expense: item.expense || 0,
            cashDelta: item.cashDelta || 0, postalDelta: item.postalDelta || 0, budgetId: item.budgetId || '', budgetName: names.get(item.budgetId) || '',
            status: item.status, createdBy: item.createdBy || '', reviewedBy: item.reviewedBy || '', budgetSetBy: item.budgetSetBy || '',
            receiptUrl: /^[0-9a-f-]{36}$/.test(item.receiptFileId || '') ? `/files/${item.receiptFileId}` : ''
        }))
    };
}

// Everyone who handled an entry of the report: they may not vote on it (章程第十二條第三款、第四款).
export function handlersOf(snapshot) {
    const names = new Set();
    for (const item of snapshot.transactions) for (const name of [item.createdBy, item.reviewedBy, item.budgetSetBy]) if (name) names.add(name);
    return [...names].sort();
}

export async function sha256Hex(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
// Hash of the figures only (not the time they were generated), so the same ledger always gives the same hash.
export async function contentHash(snapshot) {
    const { generatedAt, ...figures } = snapshot;
    return sha256Hex(JSON.stringify(figures));
}

export async function readLedger(env) {
    return {
        transactions: parseStoredList(await env.DRONE_DB.get(FINANCE_TRANSACTIONS_KEY)),
        budgets: parseStoredList(await env.DRONE_DB.get(FINANCE_BUDGETS_KEY))
    };
}
export async function liveSnapshot(env, semester, kind, now = new Date().toISOString()) {
    return buildSnapshot({ semester, kind, ...(await readLedger(env)), now });
}

// ---------- storage ----------

const metaOf = report => ({
    id: report.id, semester: report.semester, kind: report.kind, version: report.version, status: report.status, title: reportTitle(report.semester, report.kind),
    createdAt: report.createdAt, createdBy: report.createdBy, submittedAt: report.submittedAt || '', supersededBy: report.supersededBy || '',
    contentHash: report.contentHash || '', review: report.review ? { meetingId: report.review.meetingId, result: report.review.result, decidedAt: report.review.decidedAt } : null
});
export async function listReports(env) {
    try { const list = JSON.parse((await env.DRONE_DB.get(FINANCE_REPORTS_KEY)) || '[]'); return Array.isArray(list) ? list : []; } catch { return []; }
}
export async function readReport(env, id) {
    if (!/^[0-9a-f-]{36}$/.test(String(id))) return null;
    const raw = await env.DRONE_DB.get(`${FINANCE_REPORT_PREFIX}${id}`);
    return raw ? JSON.parse(raw) : null;
}
export async function saveReport(env, report) {
    await env.DRONE_DB.put(`${FINANCE_REPORT_PREFIX}${report.id}`, JSON.stringify(report));
    const index = (await listReports(env)).filter(item => item.id !== report.id);
    index.push(metaOf(report));
    await env.DRONE_DB.put(FINANCE_REPORTS_KEY, JSON.stringify(index));
    return report;
}
export async function deleteReport(env, id) {
    await env.DRONE_DB.delete(`${FINANCE_REPORT_PREFIX}${id}`);
    await env.DRONE_DB.put(FINANCE_REPORTS_KEY, JSON.stringify((await listReports(env)).filter(item => item.id !== id)));
}

export function newReport({ semester, kind, username, now, version = 1, previousId = '' }) {
    semesterRange(semester);
    if (!REPORT_KINDS[kind]) throw new ReportError('報告類型必須是預算書或決算書');
    return { id: crypto.randomUUID(), semester, kind, version, status: 'draft', createdBy: username, createdAt: now, previousId, snapshot: null, contentHash: '', handlers: [], comments: [], history: [{ at: now, by: username, action: 'create', note: '' }] };
}

// Freezes the current ledger into the report. After this the numbers never change.
export async function freezeReport(env, report, username, now) {
    const snapshot = await liveSnapshot(env, report.semester, report.kind, now);
    report.snapshot = snapshot;
    report.contentHash = await contentHash(snapshot);
    report.handlers = handlersOf(snapshot);
    report.status = 'submitted';
    report.submittedAt = now; report.submittedBy = username;
    report.history.push({ at: now, by: username, action: 'submit', note: `版本 ${report.version}` });
    return report;
}

// True when the ledger of that semester no longer gives the frozen numbers.
export async function ledgerChanged(env, report) {
    if (!report.snapshot) return false;
    return (await contentHash(await liveSnapshot(env, report.semester, report.kind))) !== report.contentHash;
}

export function currentSemesters(now = new Date()) {
    const current = semesterOf(now);
    return [current, previousSemester(current)].filter(Boolean);
}

// ---------- committee decision ----------

// The meeting's vote on an attached report decides it: passed → 委員會審核通過, otherwise (including a vote
// that could not be held for lack of attendance) → 退回. Safe to repeat: one decision is recorded once.
export async function applyReportDecision(env, reportId, decision) {
    const report = await readReport(env, reportId);
    if (!report) return null;
    if (report.history.some(entry => entry.action === 'review' && entry.meetingId === decision.meetingId && entry.itemId === decision.itemId && entry.round === decision.round)) return report;
    const result = decision.passed ? 'approved' : 'returned';
    const note = [decision.reason, decision.notes].filter(Boolean).join('\n').slice(0, 3000);
    // Only a version still under review (or one returned earlier that a later round passes) takes the decision.
    const applies = report.status === 'submitted' || report.status === 'returned';
    report.history.push({ at: decision.decidedAt, by: `meeting:${decision.meetingId}`, action: 'review', meetingId: decision.meetingId, itemId: decision.itemId, round: decision.round, result, note, applied: applies });
    if (applies) {
        report.status = result;
        report.review = { meetingId: decision.meetingId, meetingTitle: decision.meetingTitle, itemId: decision.itemId, round: decision.round, result, decidedAt: decision.decidedAt, established: decision.established !== false, note };
    }
    await saveReport(env, report);
    return report;
}

export async function syncReportDecisions(env, meeting) {
    for (const item of meeting.agenda || []) {
        if (!item.financeReport || item.vote?.state !== 'closed' || !item.vote.result) continue;
        await applyReportDecision(env, item.financeReport.id, {
            meetingId: meeting.id, meetingTitle: meeting.title, itemId: item.id, round: item.vote.round || 1, passed: item.vote.result.passed === true,
            established: item.vote.result.established !== false, reason: item.vote.result.reason, notes: item.notes || '', decidedAt: item.vote.closedAt || new Date().toISOString()
        });
    }
}

export function reportView(report, { full, changed = false, snapshot = null }) {
    const base = { ...metaOf(report), statusLabel: REPORT_STATUSES[report.status], kindLabel: REPORT_KINDS[report.kind], changed, previousId: report.previousId || '', review: report.review || null };
    if (!full) return base;
    return { ...base, snapshot: report.snapshot || snapshot, comments: report.comments, history: report.history, submittedBy: report.submittedBy || '' };
}
