// Lending workflow that joins a loan slip (FormStore) to the equipment register (EquipmentStore),
// the overdue list, and the cron reminder.
//
// The two Durable Objects cannot share a transaction, so each step is ordered to be safe to retry:
//   lend:   EquipmentStore /lend (all-or-nothing, idempotent per slip)  ->  FormStore /loan-transition pending->lent
//           if the second step fails the equipment is released again (rollback), unless another request already finished it
//   return: EquipmentStore /return (idempotent)  ->  FormStore /loan-transition lent->returned; a failure is simply retried
import { hasPermission, hasAnyPermission } from './auth.js';
import { sessionUser } from './session.js';
import { equipmentStoreRequest, isLoanable } from './equipment-store.js';
import { formStore, formRecordView } from './form-routes.js';
import { listAssets, resolveAssetIds, loanStateOf, activeLoans, overdueLoans } from './loans.js';
import { taipeiToday } from './forms.js';

const REMINDER_KEY = 'loans:last-reminder-day';

async function equipmentCall(env, path, payload) {
    const response = await equipmentStoreRequest(env, path, payload);
    const body = await response.json().catch(() => ({}));
    if (response.status >= 500) throw new Error(body?.error || 'Equipment store failed');
    return { status: response.status, body };
}

async function currentRecord(env, id) {
    const found = await formStore(env, '/get', { id });
    return found.status === 200 && found.body.type === 'equipment-loan' ? found.body : null;
}

export async function lendLoan(env, record, username) {
    const state = loanStateOf(record);
    if (state !== 'pending') return { status: 409, body: { error: state === 'lent' ? '此借據已借出' : '此借據已結案，無法借出' } };
    const ids = resolveAssetIds(record.data.items, await listAssets(env));
    if (ids.length) {
        const lent = await equipmentCall(env, '/lend', {
            formId: record.id, formNumber: record.number, borrower: record.data.borrower,
            startDate: record.data.startDate, endDate: record.data.endDate, assetIds: ids, username
        });
        if (lent.status !== 200) return lent;
    }
    const loan = { status: 'lent', assetIds: ids, lentAt: new Date().toISOString(), lentBy: username, returnedAt: '', returnedBy: '' };
    try {
        const saved = await formStore(env, '/loan-transition', { id: record.id, from: ['pending'], loan });
        if (saved.status === 200) return saved;
        // Another request may have lent this slip first; then the equipment must stay lent.
        const latest = await currentRecord(env, record.id);
        if (latest && loanStateOf(latest) === 'lent') return { status: 200, body: latest };
        await rollbackLend(env, record.id, username);
        return saved;
    } catch (error) {
        await rollbackLend(env, record.id, username);
        throw error;
    }
}

async function rollbackLend(env, formId, username) {
    try { await equipmentCall(env, '/return', { formId, username, rollback: true }); }
    // /lend is idempotent for this slip, so approving it again repairs whatever is left behind.
    catch (error) { console.error('Loan rollback failed', formId, error?.message || String(error)); }
}

export async function returnLoan(env, record, username) {
    if (loanStateOf(record) !== 'lent') return { status: 409, body: { error: '此借據目前不是借出狀態' } };
    await equipmentCall(env, '/return', { formId: record.id, username });
    const loan = { ...record.loan, status: 'returned', returnedAt: new Date().toISOString(), returnedBy: username };
    const saved = await formStore(env, '/loan-transition', { id: record.id, from: ['lent'], loan });
    if (saved.status === 409) {
        const latest = await currentRecord(env, record.id);
        if (latest && loanStateOf(latest) === 'returned') return { status: 200, body: latest };
    }
    return saved;
}

export async function rejectLoan(env, record, username) {
    if (loanStateOf(record) !== 'pending') return { status: 409, body: { error: '只有尚未借出的借據可以退回' } };
    // A failed earlier approval may have left the equipment held for this slip.
    await equipmentCall(env, '/return', { formId: record.id, username, rollback: true });
    return formStore(env, '/loan-transition', { id: record.id, from: ['pending'], loan: { status: 'rejected', assetIds: [], rejectedAt: new Date().toISOString(), rejectedBy: username } });
}

const ACTIONS = { lend: lendLoan, return: returnLoan, reject: rejectLoan };
const noStore = { 'Cache-Control': 'no-store' };

// Returns a Response for the loan, history and availability routes, or null for any other path.
export async function handleLoanRequest(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Assets that can be lent right now. The public page gets only what it needs to pick one.
    if (path === '/api/public/equipment-available' && method === 'GET') {
        let assets = [];
        try { assets = (await listAssets(env)).filter(isLoanable); } catch { /* register not ready: nothing to offer */ }
        return Response.json(assets.map(asset => ({ id: asset.id, assetName: asset.assetName, category: asset.category })).sort((a, b) => a.assetName.localeCompare(b.assetName, 'zh-Hant')), { headers: noStore });
    }

    if (!path.startsWith('/api/loans') && path !== '/api/equipment/available' && !/^\/api\/equipment\/[\w-]{1,80}\/history$/.test(path)) return null;
    const user = await sessionUser(request, env);
    if (!user) return Response.json({ error: '未授權' }, { status: 401 });

    // Any signed-in account filling in a slip may pick from the lendable assets.
    if (path === '/api/equipment/available' && method === 'GET') {
        let assets = [];
        try { assets = (await listAssets(env)).filter(isLoanable); } catch { /* register not ready */ }
        return Response.json(assets.map(({ id, assetNo, assetName, category, condition, status }) => ({ id, assetNo, assetName, category, condition, status })), { headers: noStore });
    }

    // Reading the loans and an asset's history: 借用草稿 (interns) and up; lending, returning and rejecting: loans.approve.
    if (!hasAnyPermission(user, ['loans.draft', 'loans.approve', 'equipment.view'])) return Response.json({ error: '權限不足' }, { status: 403 });

    const history = /^\/api\/equipment\/([\w-]{1,80})\/history$/.exec(path);
    if (history && method === 'GET') {
        const found = await equipmentCall(env, `/history/${history[1]}`, {});
        return Response.json(found.body, { status: found.status, headers: noStore });
    }

    if (path === '/api/loans' && method === 'GET') {
        const records = (await formStore(env, '/list')).body || [];
        const loans = url.searchParams.get('state') === 'overdue' ? overdueLoans(records) : activeLoans(records);
        return Response.json(loans, { headers: noStore });
    }

    const action = /^\/api\/loans\/([\w-]{1,80})\/(lend|return|reject)$/.exec(path);
    if (action && method === 'POST') {
        if (!hasPermission(user, 'loans.approve')) return Response.json({ error: '沒有審核借用的權限' }, { status: 403 });
        const record = await currentRecord(env, action[1]);
        if (!record) return Response.json({ error: '借據不存在' }, { status: 404 });
        const result = await ACTIONS[action[2]](env, record, user.username);
        return Response.json(result.status === 200 ? formRecordView(result.body) : result.body, { status: result.status });
    }

    return null;
}

// ───────────────────────── Cron: overdue reminder ─────────────────────────

// Posts one officers-only announcement listing every overdue slip (at most once a day).
// Returns { count, sent }; never throws, so it cannot break the weekly report that runs beside it.
export async function remindOverdueLoans(env, now = new Date()) {
    try {
        const overdue = overdueLoans((await formStore(env, '/list')).body || [], now);
        const today = taipeiToday(now);
        if (!overdue.length || !env.MESSAGE_STORE || await env.DRONE_DB.get(REMINDER_KEY) === today) return { count: overdue.length, sent: false };
        const lines = overdue.slice(0, 40).map(loan => `${loan.number}　${loan.borrower}${loan.phone ? `（${loan.phone}）` : ''}　${loan.items.join('、')}　應還 ${loan.endDate}，已逾期 ${loan.daysOverdue} 天`);
        const content = `以下 ${overdue.length} 張設備借據已過歸還時間仍未歸還，請聯絡借用人並在後台「設備借據」辦理歸還：\n\n${lines.join('\n')}${overdue.length > 40 ? `\n…另有 ${overdue.length - 40} 張` : ''}`;
        const stub = env.MESSAGE_STORE.get(env.MESSAGE_STORE.idFromName('club-messages'));
        const response = await stub.fetch('https://message-store/create-announcement', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actor: { username: 'system', name: '設備借用提醒', officer: true, president: false }, fields: { title: `設備逾期未還提醒（${overdue.length} 張）`, content, audience: 'officers', pinned: false } })
        });
        if (!response.ok) throw new Error(`announcement failed: ${response.status}`);
        await env.DRONE_DB.put(REMINDER_KEY, today);
        return { count: overdue.length, sent: true };
    } catch (error) {
        console.error('Overdue loan reminder failed', error?.message || String(error));
        return { count: 0, sent: false };
    }
}
