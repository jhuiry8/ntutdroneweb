// HTTP routes for 社務統計報表: the page /admin/stats, the JSON report /api/stats and per-section CSV.
// Officers (president, finance, cadre) may open it; the finance section is only ever read and returned for
// the president and finance officers, so the API itself withholds it, not just the page.
import { canViewCms, canManageFinance } from './auth.js';
import { validSemester, semesterOf } from './membership.js';
import { FINANCE_BUDGETS_KEY, FINANCE_TRANSACTIONS_KEY } from './kv-keys.js';
import { parseStoredList } from './validation.js';
import { equipmentStoreRequest } from './equipment-store.js';
import { flightStore } from './flight-routes.js';
import { classStore } from './class-routes.js';
import { renderStatsPage } from './stats-page.js';
import { STAT_SECTIONS, FINANCE_ONLY, semesterRange, semesterChoices, memberStats, classStats, eventStats, financeStats, equipmentStats, flightStats, statsCsv } from './stats.js';

const noStore = { 'Cache-Control': 'no-store' };
const json = (body, status = 200) => Response.json(body, { status, headers: noStore });
const HISTORY_ASSET_CAP = 500;

async function eventList(env) {
    const stub = env.EVENT_STORE.get(env.EVENT_STORE.idFromName('club-events'));
    const response = await stub.fetch('https://event-store/list', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actor: { officer: true } }) });
    if (!response.ok) throw new Error('event store');
    return response.json();
}

// One loader per section. Each is only called when the viewer may see that section.
const LOADERS = {
    members: async (env, deps, semester) => memberStats(await deps.readMembers(env), semester),
    classes: async (env, deps, semester) => {
        if (!env.CLASS_STORE) throw new Error('class store');
        const [list, regs] = await Promise.all([classStore(env, '/list', {}), classStore(env, '/reg/all', {})]);
        return classStats(list.body, regs.body, await deps.readMembers(env), semester);
    },
    events: async (env, deps, semester) => {
        if (!env.EVENT_STORE) throw new Error('event store');
        return eventStats(await eventList(env), semester);
    },
    finance: async (env, deps, semester) => {
        const [transactions, budgets] = await Promise.all([env.DRONE_DB.get(FINANCE_TRANSACTIONS_KEY), env.DRONE_DB.get(FINANCE_BUDGETS_KEY)]);
        return financeStats(parseStoredList(transactions), parseStoredList(budgets), semester);
    },
    equipment: async (env, deps, semester) => {
        const response = await equipmentStoreRequest(env, '/list', { query: '' });
        if (!response.ok) throw new Error('equipment store');
        const assets = await response.json();
        const histories = new Map();
        for (let i = 0; i < Math.min(assets.length, HISTORY_ASSET_CAP); i += 25) {
            await Promise.all(assets.slice(i, i + 25).map(async asset => {
                const history = await equipmentStoreRequest(env, `/history/${asset.id}`, {});
                if (history.ok) histories.set(asset.id, (await history.json()).history || []);
            }));
        }
        return equipmentStats(assets, histories, semester);
    },
    flights: async (env, deps, semester) => {
        const range = semesterRange(semester);
        const actor = { username: 'stats', memberId: '', officer: true };
        const result = await flightStore(env, 'log-list', { actor, scope: 'all', filters: { from: range.from, to: range.to } });
        return flightStats(Array.isArray(result.body) ? result.body : [], semester);
    }
};

export const allowedSections = user => STAT_SECTIONS.filter(name => !FINANCE_ONLY.includes(name) || canManageFinance(user));

// Builds the report for the sections this user may see; a failing source reports its own error and nothing else.
export async function buildReport(env, deps, user, semester) {
    const report = { semester, range: semesterRange(semester), semesters: semesterChoices(), sections: {} };
    for (const name of allowedSections(user)) {
        try { report.sections[name] = await LOADERS[name](env, deps, semester); }
        catch (error) { console.error('Stats section failed', name, error?.message || String(error)); report.sections[name] = { error: '這個區塊暫時無法讀取' }; }
    }
    return report;
}

export async function handleStatsRequest(request, env, deps) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (!['/admin/stats', '/api/stats', '/api/stats/export.csv'].includes(path)) return null;
    if (request.method !== 'GET') return json({ error: '方法不允許' }, 405);

    const user = await deps.sessionUser(request, env);
    if (path === '/admin/stats') {
        if (!user) return Response.redirect(`${url.origin}/admin`, 302);
        if (!canViewCms(user)) return new Response('只有幹部可以查看統計報表', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        return new Response(renderStatsPage(), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    if (!user) return json({ error: '未授權' }, 401);
    if (!canViewCms(user)) return json({ error: '只有幹部可以查看統計報表' }, 403);
    const semester = url.searchParams.get('semester') || semesterOf();
    if (!validSemester(semester)) return json({ error: '學期格式錯誤，例如 115-1' }, 400);

    if (path === '/api/stats') return json({ ...(await buildReport(env, deps, user, semester)), canFinance: canManageFinance(user) });

    const section = url.searchParams.get('section') || '';
    if (!STAT_SECTIONS.includes(section)) return json({ error: '統計區塊不存在' }, 404);
    if (FINANCE_ONLY.includes(section) && !canManageFinance(user)) return json({ error: '權限不足' }, 403);
    let data;
    try { data = await LOADERS[section](env, deps, semester); }
    catch (error) { console.error('Stats export failed', section, error?.message || String(error)); return json({ error: '資料暫時無法讀取' }, 503); }
    return new Response(statsCsv(section, data), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="stats-${section}-${semester}.csv"`, ...noStore } });
}
