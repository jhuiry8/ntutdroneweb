// HTTP routes for 飛行紀錄簿 (/api/flights*) and 證照追蹤 (/api/certificates*); the UI is the
// 飛行紀錄與證照 panel of the dashboard (/admin/flights redirects there). The daily
// certificate-expiry reminders run from the cron trigger.
import { canViewCms, canEditCms } from './auth.js';
import { FlightError, FLIGHT_TYPES, REMINDER_DAYS } from './flight-store.js';
import { dmConversation } from './messages.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const SYSTEM_ACTOR = { username: 'system', name: '系統通知', officer: true, president: false };

export async function flightStore(env, op, payload) {
    if (!env.FLIGHT_STORE) throw new FlightError('此網站尚未設定 FLIGHT_STORE，飛行紀錄功能無法使用', 503);
    const stub = env.FLIGHT_STORE.get(env.FLIGHT_STORE.idFromName('club-flights'));
    const response = await stub.fetch(`https://flight-store/${op}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await response.json();
    if (response.status >= 500) throw new Error(body?.error || 'Flight store failed');
    return { status: response.status, body };
}

// Spreadsheet programs run text that starts with = + - @ as a formula.
const csvCell = value => {
    let cell = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
    return /[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
};
export function flightsCsv(flights) {
    const header = ['日期', '社員', '地點', '機型', '設備財產編號', '飛行類型', '時長(分鐘)', '架次', '天氣', '異常或事故', '事故說明', '備註', '確認狀態', '確認者'];
    const rows = flights.map(f => [f.date, f.owner.name || f.owner.username, f.location, f.aircraft, f.assetNo, FLIGHT_TYPES[f.type] || f.type, f.minutes, f.sorties, f.weather, f.incident ? '是' : '', f.incidentNote, f.note, f.status === 'confirmed' ? '已確認' : '待確認', f.confirmedBy || '']);
    return '﻿' + [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// Returns a Response for the flight/certificate routes and page, or null for any other path.
export async function handleFlightRequest(request, env, deps) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (!path.startsWith('/api/flights') && !path.startsWith('/api/certificates') && path !== '/admin/flights') return null;

    const user = await deps.sessionUser(request, env);
    if (path === '/admin/flights') {
        if (method !== 'GET') return null;
        if (!user) return Response.redirect(`${url.origin}/admin`, 302);
        return Response.redirect(`${url.origin}/admin/dashboard#flights`, 302);
    }
    if (!user) return json({ error: '未授權' }, 401);

    const officer = canViewCms(user);
    const actor = { username: user.username, memberId: user.memberId || '', officer, editor: canEditCms(user) };
    const run = async (op, payload = {}, status = 200) => {
        const result = await flightStore(env, op, { actor, ...payload });
        return json(result.body, result.status === 200 ? status : result.status);
    };
    const body = () => deps.readJsonLimited(request, 32 * 1024);
    const scope = url.searchParams.get('scope') === 'all' ? 'all' : 'mine';
    const filters = Object.fromEntries(['type', 'status', 'assetId', 'from', 'to', 'owner'].map(name => [name, String(url.searchParams.get(name) || '')]));
    filters.incident = url.searchParams.get('incident') === '1';

    // Who a record is for: yourself, or (officers only) another member picked by account or roster id.
    const resolveOwner = async fields => {
        const members = await deps.readMembers(env);
        const nameOf = memberId => members.find(member => member.id === memberId)?.name || '';
        if (officer && (fields?.username || fields?.memberId)) {
            const username = String(fields.username || '').trim().toLowerCase();
            const account = username ? (await deps.listUsers(env)).find(item => item.username === username && item.active !== false) : null;
            if (username && !account) throw new FlightError('找不到該社員帳號', 404);
            const memberId = account ? account.memberId || '' : String(fields.memberId || '');
            if (!account && !members.some(member => member.id === memberId)) throw new FlightError('找不到該社員', 404);
            return { username: account?.username || '', memberId, name: nameOf(memberId) || account?.username || '' };
        }
        return { username: user.username, memberId: user.memberId || '', name: nameOf(user.memberId) || user.username };
    };
    const listAssets = async () => {
        const response = await deps.equipmentStoreRequest(env, '/list', { query: '' });
        const assets = response.ok ? await response.json() : [];
        return assets.map(({ id, assetNo, assetName, category }) => ({ id, assetNo, assetName, category }));
    };

    // ==================== Flight log ====================
    if (path === '/api/flights/config' && method === 'GET') {
        let people = [];
        if (officer) {
            const [users, members] = await Promise.all([deps.listUsers(env), deps.readMembers(env)]);
            const bound = new Set(users.filter(item => item.active !== false && item.memberId).map(item => item.memberId));
            people = [
                ...users.filter(item => item.active !== false).map(item => ({ username: item.username, memberId: item.memberId || '', name: members.find(member => member.id === item.memberId)?.name || '' })),
                ...members.filter(member => !bound.has(member.id)).map(member => ({ username: '', memberId: member.id, name: member.name }))
            ];
        }
        return json({ types: FLIGHT_TYPES, assets: await listAssets(), people, officer, editor: actor.editor, certCategories: (await flightStore(env, 'cert-categories', { actor })).body, reminderDays: REMINDER_DAYS });
    }
    if (path === '/api/flights/summary' && method === 'GET') return run('log-summary', { scope });
    if (path === '/api/flights/export.csv' && method === 'GET') {
        const result = await flightStore(env, 'log-list', { actor, scope, filters });
        if (result.status !== 200) return json(result.body, result.status);
        return new Response(flightsCsv(result.body), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="flight-log.csv"', 'Cache-Control': 'no-store' } });
    }
    if (path === '/api/flights' && method === 'GET') return run('log-list', { scope, filters });
    if (path === '/api/flights' && method === 'POST') {
        const fields = await body();
        const asset = await findAsset(fields?.assetId, listAssets);
        return run('log-create', { owner: await resolveOwner(fields), fields, asset }, 201);
    }
    const flightMatch = /^\/api\/flights\/([\w-]{1,80})(?:\/(confirm))?$/.exec(path);
    if (flightMatch) {
        const [, id, action] = flightMatch;
        if (action === 'confirm' && method === 'POST') return run('log-confirm', { id });
        if (!action && method === 'PATCH') {
            const fields = await body();
            return run('log-update', { id, fields, ...(fields && 'assetId' in fields ? { asset: await findAsset(fields.assetId, listAssets) } : {}) });
        }
        if (!action && method === 'DELETE') return run('log-delete', { id });
        return json({ error: '方法不允許' }, 405);
    }

    // ==================== Certificates ====================
    if (path === '/api/certificates' && method === 'GET') return run('cert-list', { scope });
    if (path === '/api/certificates' && method === 'POST') {
        const fields = await body();
        return run('cert-create', { owner: await resolveOwner(fields), fields }, 201);
    }
    if (path === '/api/certificates/categories') {
        if (method === 'GET') return run('cert-categories');
        if (method === 'PUT') return run('cert-set-categories', { categories: (await body())?.categories });
    }
    if (path === '/api/certificates/summary' && method === 'GET') return run('cert-summary');
    if (path === '/api/certificates/expiring' && method === 'GET') return run('cert-expiring');
    const certMatch = /^\/api\/certificates\/([\w-]{1,80})$/.exec(path);
    if (certMatch) {
        if (method === 'PATCH') return run('cert-update', { id: certMatch[1], fields: await body() });
        if (method === 'DELETE') return run('cert-delete', { id: certMatch[1] });
        return json({ error: '方法不允許' }, 405);
    }
    return json({ error: 'Not Found' }, 404);
}

async function findAsset(assetId, listAssets) {
    const id = String(assetId ?? '').trim();
    if (!id) return null;
    const asset = (await listAssets()).find(item => item.id === id);
    if (!asset) throw new FlightError('找不到所選的社團設備', 404);
    return asset;
}

async function messageStore(env, op, payload) {
    const stub = env.MESSAGE_STORE.get(env.MESSAGE_STORE.idFromName('club-messages'));
    const response = await stub.fetch(`https://message-store/${op}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(`Message store ${op} failed (${response.status})`);
    return response.json();
}

// Daily cron: remind owners (private message) and officers (one announcement) of certificates
// that just came within 90 or 30 days of expiry. Each threshold is sent once per certificate.
export async function runCertReminders(env, deps) {
    if (!env.FLIGHT_STORE || !env.MESSAGE_STORE) return { sent: 0 };
    const system = { actor: { system: true, username: 'system' } };
    const due = (await flightStore(env, 'cert-due-reminders', system)).body;
    if (!due.length) return { sent: 0 };
    const active = new Set((await deps.listUsers(env)).filter(user => user.active !== false).map(user => user.username));
    const mark = items => flightStore(env, 'cert-mark-reminded', { ...system, items: items.map(({ id, threshold }) => ({ id, threshold })) });
    // A certificate is marked as soon as its owner's message went out (or it has nobody to message),
    // so a later failure never makes the next run repeat messages that were already delivered.
    const handled = [];
    for (const cert of due) {
        const username = cert.owner.username;
        if (!username || username === 'system' || !active.has(username)) { handled.push(cert); continue; }
        try {
            await messageStore(env, 'send', {
                actor: SYSTEM_ACTOR, conv: dmConversation('system', username), people: [username],
                text: `【證照到期提醒】你的「${cert.category}」（證號 ${cert.certNo}）將於 ${cert.expiryDate} 到期，剩 ${cert.daysLeft} 天（${cert.threshold} 天內提醒）。請及早辦理換發。`
            });
            await mark([cert]);
            handled.push(cert);
        } catch (error) { console.error('Certificate DM failed', error?.message || String(error)); }
    }
    if (!handled.length) return { sent: 0 };
    // The officer digest is best effort: its failure is logged and never undoes or repeats anything.
    const line = cert => `${cert.owner.name || cert.owner.username}｜${cert.category}｜${cert.certNo}｜${cert.expiryDate}（剩 ${cert.daysLeft} 天）`;
    try {
        await messageStore(env, 'create-announcement', {
            actor: SYSTEM_ACTOR,
            fields: { title: `證照到期提醒（${handled.length} 件）`, content: handled.map(line).join('\n'), audience: 'officers' }
        });
    } catch (error) { console.error('Certificate digest failed', error?.message || String(error)); }
    await mark(handled);
    return { sent: handled.length };
}

