// HTTP routes for 學期財務報告 (預算書、決算書): create, preview, submit for review, new versions, the
// committee's comments and the 總務's replies, and adding an approved 決算 to the next assembly's agenda.
import { hasPermission, hasAnyPermission } from './auth.js';
import { readJsonObject } from './request.js';
import { sessionUser } from './session.js';
import { isCommitteeMember } from './org-access.js';
import { listMeetings, meetingStore } from './meeting-routes.js';
import { MEETING_TYPES } from './meetings.js';
import {
    ReportError, REPORT_KINDS, REPORT_STATUSES, MAX_COMMENTS, listReports, readReport, saveReport, deleteReport, newReport, freezeReport, ledgerChanged,
    liveSnapshot, reportView, currentSemesters, reportTitle
} from './finance-reports.js';
import { taipeiDate } from './org.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export const FINANCE_VIEW = ['finance.view', 'finance.edit', 'finance.approve', 'finance.audit'];

// A committee member may read a report that is attached to a committee meeting that has been announced: this is how
// the 本屆委員 see it even without finance.view. After the meeting they keep reading it as part of that meeting.
export async function committeeMeetingFor(env, user, reportId) {
    if (!env.MEETING_STORE) return null;
    for (const meeting of await listMeetings(env)) {
        if (meeting.type !== 'committee' || meeting.status === 'draft') continue;
        if (!(meeting.agenda || []).some(item => item.financeReport?.id === reportId)) continue;
        const member = Array.isArray(meeting.committeeRoster) ? meeting.committeeRoster.some(entry => entry.username === user.username) : isCommitteeMember(user);
        if (member) return meeting;
    }
    return null;
}
export async function canReadReport(env, user, report) {
    return hasAnyPermission(user, FINANCE_VIEW) || Boolean(await committeeMeetingFor(env, user, report.id));
}

const text = (value, max, label) => {
    const result = String(value ?? '').replace(/\r\n?/g, '\n').trim();
    if (!result || result.length > max) throw new ReportError(`${label}為必填，且不可超過 ${max} 字`);
    return result;
};

async function view(env, report, full) {
    const changed = report.status === 'draft' ? false : await ledgerChanged(env, report);
    const snapshot = report.status === 'draft' && full ? await liveSnapshot(env, report.semester, report.kind) : null;
    return reportView(report, { full, changed, snapshot });
}

// Returns a Response for /api/finance/reports*, or null for any other path.
export async function handleFinanceReportRequest(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (path !== '/api/finance/reports' && !path.startsWith('/api/finance/reports/')) return null;
    const user = await sessionUser(request, env);
    if (!user) return json({ error: '未授權' }, 401);
    const canEdit = hasPermission(user, 'finance.edit');
    const now = new Date().toISOString();
    const denied = () => json({ error: '權限不足' }, 403);

    if (path === '/api/finance/reports' && method === 'GET') {
        if (!hasAnyPermission(user, FINANCE_VIEW)) return denied();
        const reports = (await listReports(env)).sort((a, b) => b.semester.localeCompare(a.semester) || a.kind.localeCompare(b.kind) || b.version - a.version);
        // One ledger comparison per semester and kind: only the newest version of each can be "changed".
        const newest = new Map();
        for (const item of reports) { const key = `${item.semester}/${item.kind}`; if (!newest.has(key)) newest.set(key, item.id); }
        const out = [];
        for (const item of reports) {
            const record = item.status !== 'draft' && newest.get(`${item.semester}/${item.kind}`) === item.id ? await readReport(env, item.id) : null;
            out.push({ ...item, statusLabel: REPORT_STATUSES[item.status], kindLabel: REPORT_KINDS[item.kind], latest: newest.get(`${item.semester}/${item.kind}`) === item.id, changed: record ? await ledgerChanged(env, record) : false });
        }
        return json({ reports: out, semesters: currentSemesters(), kinds: REPORT_KINDS, statuses: REPORT_STATUSES, canEdit });
    }

    if (path === '/api/finance/reports' && method === 'POST') {
        if (!canEdit) return denied();
        const body = await readJsonObject(request);
        const existing = (await listReports(env)).find(item => item.semester === body.semester && item.kind === body.kind && item.status === 'draft');
        if (existing) return json({ error: '這個學期已有同類型的草稿', id: existing.id }, 409);
        const report = newReport({ semester: String(body.semester || ''), kind: String(body.kind || ''), username: user.username, now });
        await saveReport(env, report);
        return json(await view(env, report, true), 201);
    }

    const match = /^\/api\/finance\/reports\/([0-9a-f-]{36})(?:\/(submit|resubmit|comments|add-to-assembly)|\/comments\/([0-9a-f-]{36})\/reply)?$/.exec(path);
    if (!match) return json({ error: 'Not Found' }, 404);
    const [, id, action, commentId] = match;
    const report = await readReport(env, id);
    if (!report) return json({ error: '找不到報告' }, 404);

    if (!action && !commentId && method === 'GET') {
        // Drafts are the 總務's working copy; the committee only sees submitted versions, through a meeting.
        if (!hasAnyPermission(user, FINANCE_VIEW) && (report.status === 'draft' || !(await committeeMeetingFor(env, user, report.id)))) return json({ error: '找不到報告' }, 404);
        return json(await view(env, report, true));
    }
    if (!action && !commentId && method === 'DELETE') {
        if (!canEdit) return denied();
        if (report.status !== 'draft') return json({ error: '只有草稿可以刪除；送審過的版本要保留紀錄' }, 409);
        await deleteReport(env, id);
        return json({ success: true });
    }
    if (method !== 'POST') return json({ error: '方法不允許' }, 405);

    if (action === 'submit') {
        if (!canEdit) return denied();
        if (report.status !== 'draft') return json({ error: '只有草稿可以送審' }, 409);
        const active = (await listReports(env)).find(item => item.semester === report.semester && item.kind === report.kind && item.status === 'submitted');
        if (active) return json({ error: '這個學期已有送審中的版本，請等待委員會審核，或用「送審新版本」取代它' }, 409);
        await freezeReport(env, report, user.username, now);
        await saveReport(env, report);
        return json(await view(env, report, true));
    }

    if (action === 'resubmit') {
        if (!canEdit) return denied();
        const changed = report.status !== 'draft' && report.status !== 'superseded' && await ledgerChanged(env, report);
        if (!(report.status === 'returned' || (['submitted', 'approved'].includes(report.status) && changed))) return json({ error: '只有被退回的版本，或帳目已變動的版本，才能送審新版本' }, 409);
        if (report.supersededBy) return json({ error: '這個版本已經有新版，請從最新版本送審' }, 409);
        const next = newReport({ semester: report.semester, kind: report.kind, username: user.username, now, version: report.version + 1, previousId: report.id });
        await freezeReport(env, next, user.username, now);
        report.supersededBy = next.id;
        if (report.status === 'submitted') report.status = 'superseded';
        report.history.push({ at: now, by: user.username, action: 'superseded', note: `由版本 ${next.version} 取代` });
        await saveReport(env, next);
        await saveReport(env, report);
        return json(await view(env, next, true), 201);
    }

    if (action === 'comments' || commentId) {
        if (report.status === 'draft') return json({ error: '報告送審後才能留言' }, 409);
        const body = await readJsonObject(request);
        if (action === 'comments') {
            if (!(hasPermission(user, 'finance.audit') || await committeeMeetingFor(env, user, report.id))) return denied();
            if (report.comments.length >= MAX_COMMENTS) return json({ error: `每份報告最多 ${MAX_COMMENTS} 則質詢` }, 409);
            const transactionId = String(body.transactionId || '');
            if (transactionId && !report.snapshot.transactions.some(item => item.id === transactionId)) return json({ error: '報告中沒有這筆交易' }, 404);
            report.comments.push({ id: crypto.randomUUID(), by: user.username, at: now, transactionId, text: text(body.text, 500, '質詢內容'), replies: [] });
        } else {
            if (!canEdit) return denied();
            const comment = report.comments.find(item => item.id === commentId);
            if (!comment) return json({ error: '找不到這則質詢' }, 404);
            if (comment.replies.length >= 20) return json({ error: '每則質詢最多 20 則回覆' }, 409);
            comment.replies.push({ by: user.username, at: now, text: text(body.text, 500, '回覆內容') });
        }
        await saveReport(env, report);
        return json(await view(env, report, true), 201);
    }

    if (action === 'add-to-assembly') {
        if (!hasAnyPermission(user, ['finance.edit', 'meetings.manage'])) return denied();
        if (report.kind !== 'settlement' || report.status !== 'approved') return json({ error: '只有委員會審核通過的決算書可以加入社員大會議程' }, 409);
        const today = taipeiDate();
        const next = (await listMeetings(env)).filter(meeting => MEETING_TYPES[meeting.type].assembly && ['draft', 'announced'].includes(meeting.status) && meeting.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
        if (!next) return json({ error: '沒有尚未舉行的社員大會，請先建立會議' }, 404);
        const title = `${reportTitle(report.semester, report.kind)}報告（章程第十一條第二款）`;
        if (next.agenda.some(item => item.title === title)) return json({ error: '這份決算已經在該次社員大會的議程中' }, 409);
        const s = report.snapshot;
        const money = value => `NT$ ${new Intl.NumberFormat('zh-TW').format(value)}`;
        const description = `${report.review?.decidedAt ? `${report.review.decidedAt.slice(0, 10)} ` : ''}經法規監察委員會審核通過（${report.review?.meetingTitle || ''}），版本 ${report.version}。\n期間 ${s.period.start} ~ ${s.period.end}：收入 ${money(s.totals.income)}、支出 ${money(s.totals.expense)}；期末現金 ${money(s.closing.cash)}、郵局 ${money(s.closing.postal)}。\n完整決算書請洽總務。`;
        const agenda = [...next.agenda.map(item => ({ id: item.id, kind: item.kind, title: item.title, description: item.description, threshold: item.threshold, amendmentId: item.amendmentId, financeReport: item.financeReport })), { kind: 'report', title, description, threshold: 'none' }];
        const updated = await meetingStore(env, '/op', { id: next.id, op: 'update', actor: { username: user.username, officer: true }, fields: { agenda } });
        if (updated.status !== 200) return json(updated.body, updated.status);
        report.history.push({ at: now, by: user.username, action: 'assembly', note: `${next.title}（${next.date}）` });
        await saveReport(env, report);
        return json({ meetingId: next.id, meetingTitle: next.title, date: next.date });
    }
    return json({ error: 'Not Found' }, 404);
}

