// HTTP routes for the AI features, the read-only tools the assistant may call,
// and the weekly club report (also run by the Cron trigger).
import { hasPermission, hasAnyPermission } from './auth.js';
import { membershipStatus, MEMBER_LEVELS, semesterOf } from './membership.js';
import { REGULATION_KINDS, AMENDMENT_ACTIONS, requirementsFor } from './regulation-rules.js';
import { aiProvider, taipeiToday, FORM_TYPES, formTitle, FormValidationError } from './forms.js';
import { listMeetings } from './meeting-routes.js';
import { MEETING_TYPES, MEETING_STATUSES } from './meetings.js';
import {
    assistContent, reviewFinance, financeChecks, cleanMemberImport, AI_MEMBER_IMPORT_MAX_ROWS,
    reviewAmendment, summarizeReport, runAssistant
} from './ai.js';
import { FINANCE_BUDGETS_KEY, FINANCE_TRANSACTIONS_KEY, MEMBERS_KEY, REGULATIONS_KEY, REGULATION_AMENDMENTS_KEY, NOTES_KEY, AI_REPORTS_KEY } from './kv-keys.js';

export const KEYS = {
    budgets: FINANCE_BUDGETS_KEY,
    transactions: FINANCE_TRANSACTIONS_KEY,
    members: MEMBERS_KEY,
    regulations: REGULATIONS_KEY,
    amendments: REGULATION_AMENDMENTS_KEY,
    notes: NOTES_KEY,
    reports: AI_REPORTS_KEY
};
const MAX_STORED_REPORTS = 12;

function list(json) {
    if (!json) return [];
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
}
const readList = async (env, key) => list(await env.DRONE_DB.get(key));
const dayOffset = (today, days) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
function recordTitle(record) {
    try { return record.title || formTitle(record.type, record.data); } catch { return ''; }
}
const text = (value, max = 100) => String(value ?? '').trim().slice(0, max);

export function aiPermissions(user) {
    return {
        editCms: hasPermission(user, 'cms.edit'), viewCms: hasPermission(user, 'cms.view'), finance: hasAnyPermission(user, ['finance.view', 'finance.edit']),
        financeEdit: hasPermission(user, 'finance.edit'), financeApprove: hasPermission(user, 'finance.approve'), members: hasPermission(user, 'members.view'), equipment: hasPermission(user, 'equipment.view'),
        reports: hasAnyPermission(user, ['reports.view', 'reports.finance']), president: hasPermission(user, 'users.manage')
    };
}

async function equipmentAssets(env, deps, query = '') {
    const response = await deps.equipmentStoreRequest(env, '/list', { query });
    return response.ok ? await response.json() : [];
}
async function formRecords(env, deps) {
    return (await deps.formStore(env, '/list')).body || [];
}

// Loan slips whose borrowing period covers today or ended in the last 30 days.
// The system has no "returned" flag, so ended loans are only "please check".
function loanStatus(records, today) {
    // Slips marked returned or rejected are finished; a slip still marked lent past its end date is overdue.
    return records.filter(record => record.type === 'equipment-loan' && !['returned', 'rejected'].includes(record.loan?.status) && (record.loan?.status === 'lent' || (record.data?.endDate >= dayOffset(today, -30))) && record.data?.startDate <= dayOffset(today, 7))
        .map(record => ({
            number: record.number || '', borrower: record.data.borrower, items: (record.data.items || []).map(item => `${item.name}×${item.quantity}`).join('、'),
            startDate: record.data.startDate, endDate: record.data.endDate,
            state: record.data.endDate < today ? 'ended' : record.data.startDate > today ? 'upcoming' : 'active'
        }))
        .sort((a, b) => a.endDate.localeCompare(b.endDate));
}

// ───────────────────────── Assistant tools ─────────────────────────

export function assistantTools(env, user, deps) {
    const can = aiPermissions(user);
    const today = taipeiToday();
    const tools = {};
    tools.search_regulations = {
        description: '搜尋本社組織章程、施行細則與學校社團辦法的條文', args: '{"keyword": "關鍵字"}',
        async run({ keyword }) {
            const word = text(keyword, 50);
            if (!word) throw new FormValidationError('請提供關鍵字');
            const regulations = await deps.readRegulations(env);
            const hits = [];
            for (const regulation of regulations.filter(item => !item.repealed)) {
                const sections = String(regulation.content || '').split(/\n(?=第[一二三四五六七八九十百]+條|[壹貳參肆伍陸柒捌玖拾]+、)/);
                for (const section of sections) if (section.includes(word)) hits.push({ regulation: regulation.title, text: section.slice(0, 800) });
            }
            return { keyword: word, matches: hits.slice(0, 12), total: hits.length };
        }
    };
    tools.open_amendments = {
        description: '列出進行中的法規修正案',
        async run() {
            const amendments = await readList(env, KEYS.amendments);
            return amendments.filter(item => item.status === 'proposed' || item.status === 'awaiting_school')
                .map(item => ({ title: item.title, action: AMENDMENT_ACTIONS[item.action], status: item.status, proposedAt: String(item.proposedAt).slice(0, 10), reason: text(item.reason, 300) }));
        }
    };
    tools.meetings = {
        description: '列出社員大會、幹部會議與委員會議（時間、地點、議程、表決結果、紀錄是否定稿）',
        async run() {
            return (await listMeetings(env)).filter(meeting => can.viewCms || meeting.status !== 'draft')
                .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10)
                .map(meeting => ({
                    title: meeting.title, type: MEETING_TYPES[meeting.type]?.label, status: MEETING_STATUSES[meeting.status], date: meeting.date, time: meeting.time, location: meeting.location,
                    agenda: meeting.agenda.map(item => ({ title: item.title, result: item.vote.state === 'closed' && item.vote.result ? item.vote.result.reason : (item.vote.state === 'open' ? '投票中' : '未表決') })),
                    minutesFinalized: Boolean(meeting.minutes?.finalizedAt)
                }));
        }
    };
    tools.my_forms = {
        description: '列出目前使用者自己填寫的表單（經費申請、借據、活動申請等）',
        async run() {
            return (await formRecords(env, deps)).filter(record => record.createdBy === user.username)
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20)
                .map(record => ({ number: record.number, type: FORM_TYPES[record.type]?.label, title: recordTitle(record), createdAt: record.createdAt.slice(0, 10) }));
        }
    };
    if (can.viewCms) {
        tools.club_overview = {
            description: '社團整體概況：文章數、待審帳目數、社員人數、設備數、進行中修正案數、近期借用',
            async run() { return await clubStats(env, deps, user); }
        };
        tools.recent_forms = {
            description: '列出全社最近的表單紀錄，可用 type 篩選（expense-request、expense-report、equipment-loan、activity-application、activity-report、official-letter）', args: '{"type": "可省略", "days": 30}',
            async run({ type, days }) {
                const since = dayOffset(today, -Math.min(365, Math.max(1, Number(days) || 30)));
                return (await formRecords(env, deps)).filter(record => (!type || record.type === type) && record.createdAt.slice(0, 10) >= since)
                    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 40)
                    .map(record => ({ number: record.number, type: FORM_TYPES[record.type]?.label, title: recordTitle(record), createdBy: record.createdBy || '公開借據', createdAt: record.createdAt.slice(0, 10) }));
            }
        };
        tools.list_posts = {
            description: '列出官網文章（標題、語言、日期、網址代稱）',
            async run() { return (await readList(env, 'posts_list')).slice(0, 40).map(post => ({ title: post.title, lang: post.lang || 'zh', slug: post.slug, date: String(post.date || '').slice(0, 10) })); }
        };
        tools.class_notes = {
            description: '列出社課備忘錄（社課名稱、日期、重點）', args: '{"keyword": "可省略"}',
            async run({ keyword }) {
                const word = text(keyword, 50);
                return (await readList(env, KEYS.notes)).filter(note => !word || `${note.title}${note.content}`.includes(word))
                    .sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 20)
                    .map(note => ({ title: note.title, date: note.date, content: text(note.content, 400), links: (note.links || []).map(link => link.label).slice(0, 5) }));
            }
        };
    }
    if (can.finance) {
        tools.finance_summary = {
            description: '財務總覽：現金與郵局餘額、待審核帳目、各預算分類的預算與已支出',
            async run() {
                const transactions = await readList(env, KEYS.transactions);
                const budgets = await readList(env, KEYS.budgets);
                const approved = transactions.filter(item => item.status === 'approved');
                const sum = (items, key) => items.reduce((total, item) => total + (item[key] || 0), 0);
                return {
                    cashBalance: sum(approved, 'cashDelta'), postalBalance: sum(approved, 'postalDelta'),
                    pending: transactions.filter(item => item.status === 'pending').slice(0, 30).map(({ date, item, kind, amount }) => ({ date, item, kind, amount })),
                    budgets: budgets.map(budget => ({ name: budget.name, planned: budget.planned, spent: sum(approved.filter(item => item.kind === 'expense' && item.budgetId === budget.id), 'expense') }))
                };
            }
        };
        tools.search_transactions = {
            description: '搜尋帳目（依事由關鍵字、狀態 pending/approved/rejected、日期區間）', args: '{"keyword": "", "status": "", "from": "YYYY-MM-DD", "to": "YYYY-MM-DD"}',
            async run({ keyword, status, from, to }) {
                const word = text(keyword, 50);
                const rows = (await readList(env, KEYS.transactions)).filter(item => (!word || String(item.item).includes(word)) && (!status || item.status === status) && (!from || item.date >= from) && (!to || item.date <= to))
                    .sort((a, b) => b.date.localeCompare(a.date));
                return { total: rows.length, income: rows.reduce((t, i) => t + (i.income || 0), 0), expense: rows.reduce((t, i) => t + (i.expense || 0), 0), rows: rows.slice(0, 40).map(({ date, item, kind, amount, status: state }) => ({ date, item, kind, amount, status: state })) };
            }
        };
    }
    if (can.members) {
        tools.query_members = {
            description: '查詢社員名冊（不含電話與 Email）。filter 可為 all、unpaid（未繳社費）、voting（有表決權）、officers（幹部）、trial（非正式社員）', args: '{"filter": "all", "keyword": ""}',
            async run({ filter, keyword }) {
                const word = text(keyword, 50).toLowerCase();
                const rows = (await readList(env, KEYS.members)).map(member => ({ member, status: membershipStatus(member) })).filter(({ member, status }) => {
                    if (word && !`${member.name} ${member.studentId} ${member.position}`.toLowerCase().includes(word)) return false;
                    if (filter === 'unpaid') return status.unpaid;
                    if (filter === 'voting') return status.voting;
                    if (filter === 'officers') return status.level === 'prep' || status.level === 'officer';
                    if (filter === 'trial') return status.level === 'trial';
                    return true;
                });
                return { total: rows.length, members: rows.slice(0, 60).map(({ member, status }) => ({ name: member.name, studentId: member.studentId, level: status.levelLabel, fee: status.feeLabel, voting: status.voting, position: member.position })) };
            }
        };
    }
    if (can.equipment) {
        tools.query_equipment = {
            description: '查詢設備清冊。status 可為 storage（庫存）、in_use（使用中）、repair（維修）、retired（報廢）', args: '{"keyword": "", "status": ""}',
            async run({ keyword, status }) {
                const assets = (await equipmentAssets(env, deps, text(keyword, 50).toLowerCase())).filter(asset => !status || asset.status === status);
                return { total: assets.length, assets: assets.slice(0, 50).map(asset => ({ assetNo: asset.assetNo, name: asset.assetName, category: asset.category, status: asset.status, condition: asset.condition, location: asset.location, custodian: asset.custodian })) };
            }
        };
        tools.equipment_loans = {
            description: '近期設備借據：借用中、即將借出、已過歸還日（系統沒有歸還紀錄，需人工確認）',
            async run() { return loanStatus(await formRecords(env, deps), today).slice(0, 40); }
        };
    }
    return tools;
}

// ───────────────────────── Weekly report ─────────────────────────

export async function clubStats(env, deps, viewer = null) {
    const can = viewer ? aiPermissions(viewer) : { finance: true, members: true, equipment: true, viewCms: true };
    const today = taipeiToday();
    const weekAgo = dayOffset(today, -7);
    const stats = { date: today };
    const [posts, amendments, records] = await Promise.all([readList(env, 'posts_list'), readList(env, KEYS.amendments), formRecords(env, deps)]);
    stats.website = { posts: posts.length, postsThisWeek: posts.filter(post => String(post.date || '').slice(0, 10) >= weekAgo).length, latestPost: posts[0] ? { title: posts[0].title, date: String(posts[0].date).slice(0, 10) } : null };
    stats.amendments = amendments.filter(item => item.status === 'proposed' || item.status === 'awaiting_school').map(item => ({ title: item.title, status: item.status === 'proposed' ? '提案中' : '待學校核備' }));
    const meetings = await listMeetings(env);
    stats.meetings = {
        upcoming: meetings.filter(meeting => ['announced', 'open'].includes(meeting.status) && meeting.date >= today && meeting.date <= dayOffset(today, 14)).map(meeting => `${meeting.date} ${meeting.title}`),
        minutesPending: meetings.filter(meeting => meeting.status === 'closed' && !meeting.minutes?.finalizedAt).map(meeting => `${meeting.date} ${meeting.title}`),
        // The club holds a regular assembly at the start and the end of every term.
        assembliesThisTerm: meetings.filter(meeting => meeting.type === 'assembly' && semesterOf(meeting.date) === semesterOf(today)).length,
        term: semesterOf(today)
    };
    const newForms = records.filter(record => record.createdAt.slice(0, 10) >= weekAgo);
    stats.forms = { thisWeek: newForms.length, byType: Object.fromEntries(Object.entries(FORM_TYPES).map(([type, config]) => [config.label, newForms.filter(record => record.type === type).length]).filter(([, count]) => count)) };
    if (can.finance) {
        const transactions = await readList(env, KEYS.transactions);
        const budgets = await readList(env, KEYS.budgets);
        const approved = transactions.filter(item => item.status === 'approved');
        const sum = (items, key) => items.reduce((total, item) => total + (item[key] || 0), 0);
        const pending = transactions.filter(item => item.status === 'pending');
        stats.finance = {
            cashBalance: sum(approved, 'cashDelta'), postalBalance: sum(approved, 'postalDelta'),
            pendingCount: pending.length, pendingExpense: sum(pending, 'expense'),
            stalePending: pending.filter(item => String(item.createdAt || '') < `${dayOffset(today, -14)}`).length,
            budgetsOver80: budgets.map(budget => ({ name: budget.name, planned: budget.planned, spent: sum(approved.filter(item => item.kind === 'expense' && item.budgetId === budget.id), 'expense') }))
                .filter(budget => budget.planned > 0 && budget.spent >= budget.planned * 0.8),
            duplicates: financeChecks(transactions, today).filter(finding => finding.issue.startsWith('可能重複')).length
        };
    }
    if (can.members) {
        const statuses = (await readList(env, KEYS.members)).map(member => membershipStatus(member));
        stats.members = {
            total: statuses.length, unpaid: statuses.filter(status => status.unpaid).length, voting: statuses.filter(status => status.voting).length,
            byLevel: Object.fromEntries(Object.entries(MEMBER_LEVELS).map(([key, label]) => [label, statuses.filter(status => status.level === key).length]))
        };
    }
    if (can.equipment) {
        const assets = await equipmentAssets(env, deps);
        const loans = loanStatus(records, today);
        stats.equipment = {
            total: assets.length, inRepair: assets.filter(asset => asset.status === 'repair').map(asset => asset.assetName).slice(0, 10), poorCondition: assets.filter(asset => asset.condition === 'poor' && asset.status !== 'retired').length,
            activeLoans: loans.filter(loan => loan.state === 'active').length, upcomingLoans: loans.filter(loan => loan.state === 'upcoming').length,
            endedLoansToCheck: loans.filter(loan => loan.state === 'ended' && loan.endDate >= weekAgo).map(loan => `${loan.number} ${loan.borrower}（${loan.items}，應於 ${loan.endDate} 歸還）`).slice(0, 10)
        };
    }
    return stats;
}

const money = value => `${Number(value || 0).toLocaleString('en-US')} 元`;

export function reportText(stats, summary) {
    const lines = [`📋 北科無人機社 每週社務報告（${stats.date}）`];
    if (summary?.headline) lines.push('', summary.headline);
    if (summary?.highlights?.length) lines.push('', '本週重點：', ...summary.highlights.map(item => `• ${item}`));
    if (summary?.todos?.length) lines.push('', '待辦事項：', ...summary.todos.map(item => `• ${item}`));
    lines.push('', '— 系統統計 —');
    if (stats.finance) lines.push(`財務：現金 ${money(stats.finance.cashBalance)}、郵局 ${money(stats.finance.postalBalance)}；待審核 ${stats.finance.pendingCount} 筆${stats.finance.stalePending ? `（其中 ${stats.finance.stalePending} 筆超過 14 天）` : ''}${stats.finance.budgetsOver80.length ? `；預算用量逾 80%：${stats.finance.budgetsOver80.map(b => b.name).join('、')}` : ''}`);
    if (stats.members) lines.push(`社員：共 ${stats.members.total} 人，未繳社費 ${stats.members.unpaid} 人，具表決權 ${stats.members.voting} 人`);
    if (stats.equipment) lines.push(`設備：共 ${stats.equipment.total} 件，維修中 ${stats.equipment.inRepair.length} 件；借用中 ${stats.equipment.activeLoans} 筆${stats.equipment.endedLoansToCheck.length ? `；請確認是否已歸還：${stats.equipment.endedLoansToCheck.join('；')}` : ''}`);
    lines.push(`表單：本週新增 ${stats.forms.thisWeek} 份；文章：本週發佈 ${stats.website.postsThisWeek} 篇`);
    if (stats.meetings?.upcoming.length) lines.push(`即將召開的會議：${stats.meetings.upcoming.join('、')}`);
    if (stats.meetings && stats.meetings.assembliesThisTerm < 2) lines.push(`${stats.meetings.term} 學期定期社員大會已建立 ${stats.meetings.assembliesThisTerm} 場（期初、期末各一場），請記得安排。`);
    if (stats.meetings?.minutesPending.length) lines.push(`會議紀錄尚未定稿：${stats.meetings.minutesPending.join('、')}`);
    if (stats.amendments.length) lines.push(`法規修正案進行中：${stats.amendments.map(item => `「${item.title}」${item.status}`).join('、')}`);
    return lines.join('\n');
}

async function postWebhook(env, message) {
    const url = String(env.REPORT_WEBHOOK_URL || '');
    if (!/^https:\/\//.test(url)) return 'skipped';
    try {
        // Discord reads `content`, Slack reads `text`; Discord limits a message to 2,000 characters.
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: message.slice(0, 1990), text: message }), signal: AbortSignal.timeout(15000) });
        return response.ok ? 'sent' : `failed (${response.status})`;
    } catch {
        return 'failed';
    }
}

export async function generateClubReport(env, deps, { trigger = 'cron', username = '' } = {}) {
    const stats = await clubStats(env, deps);
    let summary = null, aiError = '';
    if (aiProvider(env)) {
        try { summary = await summarizeReport(env, stats); }
        catch (error) { aiError = error?.message || 'AI 摘要失敗'; }
    }
    const message = reportText(stats, summary);
    const report = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), trigger, createdBy: username, stats, summary, aiError, text: message };
    report.webhook = await postWebhook(env, message);
    const reports = await readList(env, KEYS.reports);
    reports.unshift(report);
    await env.DRONE_DB.put(KEYS.reports, JSON.stringify(reports.slice(0, MAX_STORED_REPORTS)));
    return report;
}

// ───────────────────────── Routes ─────────────────────────

const json = (body, status = 200) => Response.json(body, { status });
const LIMIT = 32 * 1024;

// Returns a Response for AI routes, or null when the path is not one of them.
export async function handleAiRequest(request, env, deps) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const budgetMatch = /^\/api\/finance\/transactions\/([\w-]{1,80})\/budget$/.exec(path);
    if (!path.startsWith('/api/ai/') && !budgetMatch) return null;

    const user = await deps.sessionUser(request, env);
    if (!user) return json({ error: '未授權' }, 401);
    const can = aiPermissions(user);
    const provider = aiProvider(env);
    const noAi = () => json({ error: '尚未設定 GROQ_API_KEY（或 GEMINI_API_KEY），無法使用 AI 功能' }, 503);

    // Applies an AI-suggested (or manually chosen) budget category to one transaction.
    if (budgetMatch && method === 'PATCH') {
        if (!can.financeEdit) return json({ error: '權限不足' }, 403);
        const body = await deps.readJsonLimited(request, LIMIT);
        const budgetId = String(body?.budgetId ?? '');
        const budgets = await readList(env, KEYS.budgets);
        if (budgetId && !budgets.some(item => item.id === budgetId)) return json({ error: '預算分類不存在' }, 400);
        const transactions = await readList(env, KEYS.transactions);
        const transaction = transactions.find(item => item.id === budgetMatch[1]);
        if (!transaction) return json({ error: '帳目不存在' }, 404);
        if (transaction.kind !== 'expense') return json({ error: '只有支出可以歸入預算分類' }, 400);
        if (transaction.status === 'rejected') return json({ error: '已退回的帳目不能修改' }, 409);
        // Approved items keep their category unless it was empty (or the 審核者 re-files it), so reviewed totals do not shift silently.
        if (transaction.status === 'approved' && transaction.budgetId && !can.financeApprove) return json({ error: '已核准且已有分類的帳目不能改分類' }, 409);
        transaction.budgetId = budgetId;
        transaction.budgetSetBy = user.username;
        transaction.budgetSetAt = new Date().toISOString();
        await env.DRONE_DB.put(KEYS.transactions, JSON.stringify(transactions));
        return json(transaction);
    }

    if (path === '/api/ai/status' && method === 'GET') {
        return json({
            enabled: Boolean(provider), provider: provider?.name || '', model: provider?.model || '', dailyLimit: deps.aiDailyLimit(env),
            webhook: /^https:\/\//.test(String(env.REPORT_WEBHOOK_URL || '')),
            features: { assistant: true, content: can.editCms, finance: can.finance, members: can.members, regulations: can.viewCms, reports: can.viewCms }
        });
    }

    if (path === '/api/ai/assistant' && method === 'POST') {
        const body = await deps.readJsonLimited(request, 128 * 1024);
        if (!provider) return noAi();
        const tools = assistantTools(env, user, deps);
        return await deps.withAiQuota(env, user, () => runAssistant(env, user, body?.messages, tools, can));
    }

    if (path === '/api/ai/content' && method === 'POST') {
        if (!can.editCms) return json({ error: '權限不足' }, 403);
        const body = await deps.readJsonLimited(request, 256 * 1024);
        if (!provider) return noAi();
        return await deps.withAiQuota(env, user, () => assistContent(env, body));
    }

    if (path === '/api/ai/finance-review' && method === 'POST') {
        if (!can.finance) return json({ error: '權限不足' }, 403);
        const transactions = await readList(env, KEYS.transactions);
        const budgets = await readList(env, KEYS.budgets);
        const checks = financeChecks(transactions, taipeiToday());
        if (!transactions.length) return json({ suggestions: [], anomalies: checks, summary: '目前沒有帳目。' });
        if (!provider) return json({ suggestions: [], anomalies: checks, summary: '未設定 AI，僅執行規則檢查。' });
        return await deps.withAiQuota(env, user, async () => {
            const review = await reviewFinance(env, transactions, budgets);
            // AI may only suggest categories for expenses that can still take one.
            const eligible = new Set(transactions.filter(item => item.kind === 'expense' && item.status !== 'rejected' && (item.status === 'pending' || !item.budgetId)).map(item => item.id));
            return { ...review, suggestions: review.suggestions.filter(item => eligible.has(item.id)), anomalies: [...checks, ...review.anomalies] };
        });
    }

    if (path === '/api/ai/member-import' && method === 'POST') {
        if (!can.members) return json({ error: '權限不足' }, 403);
        const body = await deps.readJsonLimited(request, 128 * 1024);
        const raw = String(body?.text ?? '').trim();
        if (!raw || raw.length > 30000) return json({ error: `請貼上 1 至 30,000 字的名單（約 ${AI_MEMBER_IMPORT_MAX_ROWS} 人以內）` }, 400);
        if (!provider) return noAi();
        return await deps.withAiQuota(env, user, () => cleanMemberImport(env, raw));
    }

    if (path === '/api/ai/regulation-review' && method === 'POST') {
        if (!can.viewCms) return json({ error: '權限不足' }, 403);
        const body = await deps.readJsonLimited(request, 256 * 1024);
        const regulations = await deps.readRegulations(env);
        let proposal;
        if (body?.amendmentId) {
            const amendment = (await readList(env, KEYS.amendments)).find(item => item.id === body.amendmentId);
            if (!amendment) return json({ error: '找不到修正案' }, 404);
            proposal = { ...amendment, baseContent: amendment.baseContent || regulations.find(item => item.id === amendment.regulationId)?.content || '' };
        } else {
            const action = AMENDMENT_ACTIONS[body?.action] ? body.action : 'amend';
            const regulation = regulations.find(item => item.id === body?.regulationId);
            if (action !== 'create' && !regulation) return json({ error: '找不到要修正的法規' }, 400);
            const content = String(body?.content ?? '').trim();
            if (action !== 'repeal' && !content) return json({ error: '請先輸入修正後條文' }, 400);
            proposal = { action, kind: regulation?.kind || (body?.kind === 'school' ? 'school' : 'bylaw'), title: String(body?.title || regulation?.title || '新法規').slice(0, 120), reason: String(body?.reason ?? ''), content, baseContent: regulation?.content || '', needsAssembly: body?.needsAssembly === true };
        }
        if (!provider) return noAi();
        const kind = REGULATION_KINDS[proposal.kind] ? proposal.kind : 'bylaw';
        // The charter and the school's rules are the higher norms every amendment is checked against.
        const references = regulations.filter(item => !item.repealed && (item.kind === 'charter' || item.kind === 'school') && item.id !== proposal.regulationId);
        return await deps.withAiQuota(env, user, async () => ({
            ...(await reviewAmendment(env, { ...proposal, actionLabel: AMENDMENT_ACTIONS[proposal.action], kindLabel: REGULATION_KINDS[kind] }, references)),
            requirements: requirementsFor(kind, proposal.needsAssembly)
        }));
    }

    if (path === '/api/ai/reports' && ['GET', 'POST'].includes(method)) {
        if (!can.viewCms && !can.reports) return json({ error: '權限不足' }, 403);
        if (method === 'GET') {
            const reports = await readList(env, KEYS.reports);
            // Finance, roster and equipment figures stay with the officers allowed to see them.
            const full = can.finance && can.members && can.equipment;
            return json(reports.map(report => {
                if (full) return report;
                const stats = redactStats(report.stats, can);
                return { ...report, stats, summary: null, text: reportText(stats, null) };
            }));
        }
        if (!can.president && !can.financeEdit) return json({ error: '沒有手動產生週報的權限' }, 403);
        if (!provider) return json(await generateClubReport(env, deps, { trigger: 'manual', username: user.username }), 201);
        return await deps.withAiQuota(env, user, () => generateClubReport(env, deps, { trigger: 'manual', username: user.username }));
    }

    return json({ error: 'Not Found' }, 404);
}

function redactStats(stats, can) {
    const copy = { ...stats };
    if (!can.finance) delete copy.finance;
    if (!can.members) delete copy.members;
    if (!can.equipment) delete copy.equipment;
    return copy;
}
