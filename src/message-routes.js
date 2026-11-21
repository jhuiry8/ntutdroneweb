// HTTP routes for 社團通訊 (chat rooms, private messages, announcements) and
// the optional external push module. Storage lives in the MessageStore Durable Object.
import { canViewCms, canManageUsers } from './auth.js';
import { pushToUsers, usersWithSubscriptions } from './push-routes.js';
import { MessageError, PUSH_SETTINGS_KEY, DEFAULT_PUSH_SETTINGS, normalizePushSettings, publicPushSettings, pushNotice } from './messages.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const ROLE_LABELS = { president: '社長', finance: '財務', cadre: '幹部', member: '社員' };

async function store(env, op, payload) {
    if (!env.MESSAGE_STORE) throw new MessageError('此網站尚未設定 MESSAGE_STORE，通訊功能無法使用', 503);
    const stub = env.MESSAGE_STORE.get(env.MESSAGE_STORE.idFromName('club-messages'));
    const response = await stub.fetch(`https://message-store/${op}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await response.json();
    if (response.status >= 500) throw new Error(body?.error || 'Message store failed');
    return { status: response.status, body };
}

export async function readPushSettings(env) {
    const raw = await env.DRONE_DB.get(PUSH_SETTINGS_KEY);
    try { return { ...DEFAULT_PUSH_SETTINGS, ...(raw ? JSON.parse(raw) : {}) }; }
    catch { return { ...DEFAULT_PUSH_SETTINGS }; }
}

// Pushes a new website post when the president turned that on. Never throws.
export async function pushNewPost(env, origin, post) {
    try {
        const settings = await readPushSettings(env);
        if (!settings.enabled || !settings.posts) return [];
        return await pushNotice(settings, { title: `網站新文章：${post.title}`, body: post.summary || '', link: `${origin}/blog/${post.slug}` });
    } catch { return []; }
}

// Active accounts with the roster name each one is bound to.
async function people(env, deps) {
    const [users, members] = await Promise.all([deps.listUsers(env), deps.readMembers(env)]);
    const names = new Map(members.map(member => [member.id, member.name]));
    return users.filter(user => user.active !== false).map(user => ({
        username: user.username, name: (user.memberId && names.get(user.memberId)) || '', role: user.role, roleLabel: ROLE_LABELS[user.role] || user.role
    })).sort((a, b) => a.username.localeCompare(b.username));
}

// Returns a Response for message routes, or null when the path is not one of them.
export async function handleMessageRequest(request, env, deps, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (!path.startsWith('/api/messages') && !path.startsWith('/api/announcements')) return null;

    const user = await deps.sessionUser(request, env);
    if (!user) return json({ error: '未授權' }, 401);
    // Unread checks run every 20–30 s from every open app, so the account list (one KV read per
    // account) is only loaded by the routes that need it, and the display name only when one is shown.
    let directoryPromise = null;
    const directory = () => (directoryPromise ||= people(env, deps));
    const usernames = async () => (await directory()).map(entry => entry.username);
    const actor = { username: user.username, name: user.username, officer: canViewCms(user), president: canManageUsers(user) };
    const withName = async () => {
        if (user.memberId) {
            const member = (await deps.readMembers(env)).find(entry => entry.id === user.memberId);
            if (member?.name) actor.name = member.name;
        }
        return actor;
    };
    const run = async (op, payload = {}, status = 200) => {
        const result = await store(env, op, { actor, ...payload });
        return json(result.body, result.status === 200 ? status : result.status);
    };
    const body = () => deps.readJsonLimited(request, 64 * 1024);
    // Browser push to subscribed accounts, after the response (never delays or fails the request).
    const pushLater = work => { const job = work().catch(() => {}); if (ctx?.waitUntil) ctx.waitUntil(job); else return job; };
    const subscribers = async () => {
        const subscribed = new Set(await usersWithSubscriptions(env));
        if (!subscribed.size) return []; // nobody to push to: skip listing the accounts
        return (await deps.listUsers(env)).filter(entry => entry.active !== false && entry.username !== actor.username && subscribed.has(entry.username))
            .map(entry => ({ username: entry.username, officer: canViewCms(entry), president: canManageUsers(entry) }));
    };

    if (path === '/api/messages/summary' && method === 'GET') return run('summary');
    if (path === '/api/messages/conversations' && method === 'GET') return run('conversations');
    if (path === '/api/messages/people' && method === 'GET') return json({ me: await withName(), people: await directory() });
    if (path === '/api/messages/read-all' && method === 'POST') return run('read-all');
    if (path === '/api/messages/dm' && method === 'POST') return run('open-dm', { username: (await body())?.username, people: await usernames() });
    if (path === '/api/messages/channels' && method === 'POST') return run('create-channel', { fields: await body() }, 201);
    const channelMatch = /^\/api\/messages\/channels\/([\w-]{1,40})$/.exec(path);
    if (channelMatch && method === 'PATCH') return run('update-channel', { id: channelMatch[1], fields: await body() });

    const convMatch = /^\/api\/messages\/c\/([\w~.-]{4,90})(?:\/(read|\d{1,8}))?$/.exec(path);
    if (convMatch) {
        const [, conv, extra] = convMatch;
        if (!extra && method === 'GET') return run('messages', { conv, after: url.searchParams.get('after'), before: url.searchParams.get('before'), limit: url.searchParams.get('limit') });
        if (!extra && method === 'POST') {
            const text = (await body())?.text;
            await withName();
            // Only private messages need to know whether the other account is still active.
            const response = await run('send', { conv, text, ...(conv.startsWith('dm~') ? { people: await usernames() } : {}) }, 201);
            if (response.status === 201) {
                const sent = await response.clone().json();
                await pushLater(async () => {
                    const users = await subscribers();
                    if (!users.length) return;
                    const { body: who } = await store(env, 'recipients', { actor, conv, users });
                    await pushToUsers(env, who.usernames, {
                        kind: 'messages', title: conv.startsWith('dm~') ? `💬 ${actor.name}` : `💬 ${who.name || '聊天室'}`,
                        body: `${conv.startsWith('dm~') ? '' : `${actor.name}：`}${sent.text.replace(/\s+/g, ' ').slice(0, 100)}`,
                        tab: conv.startsWith('dm~') ? 'dm' : 'chat', conv, tag: `c:${conv}`
                    });
                });
            }
            return response;
        }
        if (extra === 'read' && method === 'POST') return run('read', { conv, seq: (await body())?.seq });
        if (extra && extra !== 'read' && method === 'PATCH') return run('edit', { conv, seq: Number(extra), text: (await body())?.text });
        if (extra && extra !== 'read' && method === 'DELETE') return run('delete', { conv, seq: Number(extra) });
        return json({ error: '方法不允許' }, 405);
    }

    if (path === '/api/messages/push-settings' && ['GET', 'PUT'].includes(method)) {
        if (!actor.president) return json({ error: '只有社長可以設定外部推播' }, 403);
        const current = await readPushSettings(env);
        if (method === 'GET') return json(publicPushSettings(current));
        const settings = normalizePushSettings(await body(), current);
        await env.DRONE_DB.put(PUSH_SETTINGS_KEY, JSON.stringify(settings));
        return json(publicPushSettings(settings));
    }
    if (path === '/api/messages/push-test' && method === 'POST') {
        if (!actor.president) return json({ error: '只有社長可以設定外部推播' }, 403);
        const settings = await readPushSettings(env);
        if (!settings.enabled) return json({ error: '請先啟用外部推播' }, 400);
        return json({ results: await pushNotice(settings, { title: '推播測試', body: `這是北科無人機社社務系統的測試訊息（${actor.username}）。`, link: url.origin }) });
    }

    if (path === '/api/announcements' && method === 'GET') return run('announcements');
    if (path === '/api/announcements' && method === 'POST') {
        const fields = await body();
        const result = await store(env, 'create-announcement', { actor: await withName(), fields });
        if (result.status !== 200) return json(result.body, result.status);
        // Optional external push; only announcements for everyone leave the system.
        let push = [];
        const settings = await readPushSettings(env);
        if (fields?.push !== false && settings.enabled && settings.announcements && result.body.audience === 'all') {
            push = await pushNotice(settings, { title: result.body.title, body: result.body.content, link: `${url.origin}/admin/dashboard` });
        }
        await pushLater(async () => {
            const users = (await subscribers()).filter(entry => result.body.audience === 'all' || entry.officer);
            await pushToUsers(env, users.map(entry => entry.username), {
                kind: 'announcements', title: `📢 ${actor.name} 發布新公告`, body: result.body.title, tab: 'announcements', conv: '', tag: `a:${result.body.id}`
            });
        });
        return json({ ...result.body, push }, 201);
    }
    const annMatch = /^\/api\/announcements\/([\w-]{1,80})(?:\/(read))?$/.exec(path);
    if (annMatch) {
        const [, id, action] = annMatch;
        if (action === 'read' && method === 'POST') return run('read-announcement', { id });
        if (!action && method === 'PATCH') return run('update-announcement', { id, fields: await body() });
        if (!action && method === 'DELETE') return run('delete-announcement', { id });
        return json({ error: '方法不允許' }, 405);
    }
    return json({ error: 'Not Found' }, 404);
}
