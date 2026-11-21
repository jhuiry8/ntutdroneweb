// 社團通訊：聊天室（頻道）、私人訊息、公告與已讀狀態。
// Everything lives in one MessageStore Durable Object so message numbers,
// unread counters and read markers stay consistent under concurrent use.
//
// Keys
//   channel:<id>         { id, name, description, audience, members, readOnly, createdBy, createdAt, archived }
//   meta:<conv>          { conv, lastSeq, lastAt, lastPreview, lastAuthor, participants? }
//   msg:<conv>:<seq>     { seq, author, authorName, text, createdAt, editedAt?, deleted? }
//   read:<username>      { [conv]: seq, announcements: [ids] }
//   ann:<id>             { id, title, content, audience, pinned, createdBy, createdByName, createdAt, readBy: [] }
//
// Conversations are "ch~<channelId>" or "dm~<user a>~<user b>" (names sorted).

import { isExportRequest, exportStorage } from './do-export.js';
export class MessageError extends Error {
    constructor(message, status = 400) { super(message); this.name = 'MessageError'; this.status = status; }
}

export const AUDIENCES = { all: '全體社員', officers: '幹部限定', custom: '指定成員' };
export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_MESSAGES_PER_CONVERSATION = 3000;
export const MAX_CHANNELS = 60;
export const MAX_ANNOUNCEMENTS = 300;
const USERNAME = /^[a-z0-9._-]{3,40}$/;
const CHANNEL_ID = /^[\w-]{1,40}$/;
export const CONVERSATION = /^(ch~[\w-]{1,40}|dm~[a-z0-9._-]{3,40}~[a-z0-9._-]{3,40})$/;

// Created the first time anyone opens the message centre.
export const DEFAULT_CHANNELS = [
    { id: 'general', name: '全體社員聊天室', description: '社團大小事都可以在這裡聊', audience: 'all', readOnly: false },
    { id: 'officers', name: '幹部聊天室', description: '幹部討論社務', audience: 'officers', readOnly: false },
    { id: 'flight', name: '飛行揪團', description: '約飛、場地與天氣', audience: 'all', readOnly: false }
];

const seqKey = seq => String(seq).padStart(8, '0');
const text = (value, max) => String(value ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);
const preview = value => String(value).replace(/\s+/g, ' ').slice(0, 80);

export function dmConversation(a, b) {
    const [x, y] = [String(a), String(b)].sort();
    return `dm~${x}~${y}`;
}

export function dmParticipants(conv) {
    const parts = conv.split('~');
    return parts[0] === 'dm' ? [parts[1], parts[2]] : null;
}

export function canSeeChannel(channel, actor) {
    // Archived rooms stay visible to the president and to whoever created them, so they can be reopened.
    if (!channel || (channel.archived && !actor.president && channel.createdBy !== actor.username)) return false;
    if (channel.audience === 'all') return true;
    if (channel.audience === 'officers') return Boolean(actor.officer);
    return actor.president || channel.createdBy === actor.username || (channel.members || []).includes(actor.username);
}

export function canSeeAnnouncement(announcement, actor) {
    return announcement.audience !== 'officers' || Boolean(actor.officer);
}

export function normalizeChannel(fields, existing = null) {
    const name = text(fields?.name ?? existing?.name, 40);
    if (!name) throw new MessageError('請輸入聊天室名稱');
    const audience = AUDIENCES[fields?.audience] ? fields.audience : existing?.audience || 'all';
    const members = audience === 'custom'
        ? [...new Set((Array.isArray(fields?.members) ? fields.members : existing?.members || []).map(item => String(item).trim().toLowerCase()).filter(item => USERNAME.test(item)))].slice(0, 200)
        : [];
    return {
        name, audience, members,
        description: text(fields?.description ?? existing?.description, 200),
        readOnly: fields?.readOnly === undefined ? Boolean(existing?.readOnly) : fields.readOnly === true
    };
}

export function normalizeAnnouncement(fields) {
    const title = text(fields?.title, 120);
    const content = text(fields?.content, 10000);
    if (!title) throw new MessageError('請輸入公告標題');
    if (!content) throw new MessageError('請輸入公告內容');
    return { title, content, audience: fields?.audience === 'officers' ? 'officers' : 'all', pinned: fields?.pinned === true };
}

// A user's read announcement ids, without deleted announcements (so the cap never pushes out real ones).
function trimRead(ids, existing) {
    return ids.filter(id => existing.has(id)).slice(-MAX_ANNOUNCEMENTS);
}

async function readState(storage, username) {
    return (await storage.get(`read:${username}`)) || { announcements: [] };
}

async function ensureDefaults(storage, now) {
    if (await storage.get('defaults-created')) return;
    for (const channel of DEFAULT_CHANNELS) {
        if (!(await storage.get(`channel:${channel.id}`))) await storage.put(`channel:${channel.id}`, { ...channel, members: [], createdBy: 'system', createdAt: now, archived: false });
    }
    await storage.put('defaults-created', true);
}

// Whether actor may read (and usually write) a conversation; returns the channel for channel conversations.
async function access(storage, conv, actor, people) {
    if (!CONVERSATION.test(conv)) throw new MessageError('對話不存在', 404);
    const pair = dmParticipants(conv);
    if (pair) {
        // Only the canonical id (names sorted) is accepted, so two people always share one thread.
        if (!pair.includes(actor.username) || pair[0] === pair[1] || conv !== dmConversation(pair[0], pair[1])) throw new MessageError('對話不存在', 404);
        const other = pair[0] === actor.username ? pair[1] : pair[0];
        if (people && !people.has(other)) throw new MessageError('對方帳號不存在或已停用', 404);
        return { channel: null, participants: pair };
    }
    const channel = await storage.get(`channel:${conv.slice(3)}`);
    if (!canSeeChannel(channel, actor)) throw new MessageError('聊天室不存在', 404);
    return { channel };
}

function channelView(channel, meta, unread) {
    return {
        conv: `ch~${channel.id}`, kind: 'channel', id: channel.id, name: channel.name, description: channel.description,
        audience: channel.audience, audienceLabel: AUDIENCES[channel.audience], members: channel.members || [], readOnly: Boolean(channel.readOnly),
        archived: Boolean(channel.archived), createdBy: channel.createdBy,
        lastAt: meta?.lastAt || '', lastPreview: meta?.lastPreview || '', lastAuthor: meta?.lastAuthor || '', lastSeq: meta?.lastSeq || 0, unread
    };
}

async function conversations(storage, actor, read) {
    const result = [];
    for (const channel of (await storage.list({ prefix: 'channel:' })).values()) {
        if (!canSeeChannel(channel, actor)) continue;
        const conv = `ch~${channel.id}`;
        const meta = await storage.get(`meta:${conv}`);
        result.push(channelView(channel, meta, channel.archived ? 0 : Math.max(0, (meta?.lastSeq || 0) - (read[conv] || 0))));
    }
    for (const meta of (await storage.list({ prefix: 'meta:dm~' })).values()) {
        if (!meta.participants?.includes(actor.username)) continue;
        const other = meta.participants.find(name => name !== actor.username) || actor.username;
        result.push({
            conv: meta.conv, kind: 'dm', with: other, name: other, lastAt: meta.lastAt, lastPreview: meta.lastPreview,
            lastAuthor: meta.lastAuthor, lastSeq: meta.lastSeq, unread: Math.max(0, meta.lastSeq - (read[meta.conv] || 0))
        });
    }
    return result;
}

function announcementView(item, actor, read) {
    const view = { ...item, read: read.announcements.includes(item.id) || item.createdBy === actor.username, readCount: item.readBy.length };
    delete view.readBy;
    // Officers see who has read an announcement (已讀名單).
    if (actor.officer) view.readBy = item.readBy;
    return view;
}

async function announcementList(storage, actor, read) {
    return [...(await storage.list({ prefix: 'ann:' })).values()]
        .filter(item => canSeeAnnouncement(item, actor))
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt))
        .map(item => announcementView(item, actor, read));
}

// One operation on the store. actor = { username, name, officer, president }; people = Set of active usernames (DMs).
export async function messageOp(storage, op, payload, now = new Date().toISOString()) {
    const actor = payload.actor;
    if (!actor?.username) throw new MessageError('未授權', 401);
    await ensureDefaults(storage, now);
    const people = payload.people ? new Set(payload.people) : null;
    const read = await readState(storage, actor.username);

    if (op === 'summary') {
        const list = await conversations(storage, actor, read);
        const announcements = await announcementList(storage, actor, read);
        const unreadAnnouncements = announcements.filter(item => !item.read);
        return {
            unreadMessages: list.reduce((sum, item) => sum + item.unread, 0),
            unreadAnnouncements: unreadAnnouncements.length,
            conversations: list.filter(item => item.unread).map(({ conv, name, kind, unread, lastPreview, lastAuthor, lastAt }) => ({ conv, name, kind, unread, lastPreview, lastAuthor, lastAt })),
            announcements: unreadAnnouncements.slice(0, 5).map(({ id, title, createdAt, createdByName, pinned }) => ({ id, title, createdAt, createdByName, pinned }))
        };
    }
    if (op === 'conversations') return conversations(storage, actor, read);

    if (op === 'messages') {
        const conv = String(payload.conv || '');
        await access(storage, conv, actor, null);
        const limit = Math.min(Math.max(Number(payload.limit) || 50, 1), 200);
        const after = Math.max(Number(payload.after) || 0, 0);
        const before = Number(payload.before) || 0;
        let entries;
        if (after) {
            entries = [...(await storage.list({ prefix: `msg:${conv}:`, start: `msg:${conv}:${seqKey(after + 1)}`, limit })).values()];
        } else {
            const all = [...(await storage.list({ prefix: `msg:${conv}:` })).values()].filter(item => !before || item.seq < before);
            entries = all.slice(-limit);
        }
        // Some storage implementations ignore `start`; filter again so callers can rely on it.
        entries = entries.filter(item => item.seq > after).slice(0, limit);
        const meta = await storage.get(`meta:${conv}`);
        return { conv, messages: entries.map(item => item.deleted ? { ...item, text: '' } : item), lastSeq: meta?.lastSeq || 0, readSeq: read[conv] || 0 };
    }

    if (op === 'send') {
        const conv = String(payload.conv || '');
        const { channel, participants } = await access(storage, conv, actor, people);
        if (channel?.archived) throw new MessageError('此聊天室已封存，無法發言', 409);
        if (channel?.readOnly && !actor.officer) throw new MessageError('此聊天室只有幹部可以發言', 403);
        const body = text(payload.text, MAX_MESSAGE_LENGTH);
        if (!body) throw new MessageError('訊息不可空白');
        const meta = (await storage.get(`meta:${conv}`)) || { conv, lastSeq: 0, ...(participants ? { participants } : {}) };
        const message = { seq: meta.lastSeq + 1, author: actor.username, authorName: actor.name || actor.username, text: body, createdAt: now };
        await storage.put(`msg:${conv}:${seqKey(message.seq)}`, message);
        if (message.seq > MAX_MESSAGES_PER_CONVERSATION) await storage.delete(`msg:${conv}:${seqKey(message.seq - MAX_MESSAGES_PER_CONVERSATION)}`);
        Object.assign(meta, { lastSeq: message.seq, lastAt: now, lastPreview: preview(body), lastAuthor: message.authorName });
        await storage.put(`meta:${conv}`, meta);
        read[conv] = message.seq; // your own message is read
        await storage.put(`read:${actor.username}`, read);
        return message;
    }

    if (op === 'edit' || op === 'delete') {
        const conv = String(payload.conv || '');
        await access(storage, conv, actor, null);
        const key = `msg:${conv}:${seqKey(Number(payload.seq) || 0)}`;
        const message = await storage.get(key);
        if (!message || message.deleted) throw new MessageError('訊息不存在', 404);
        if (message.author !== actor.username && !(op === 'delete' && actor.president)) throw new MessageError('只能修改自己的訊息', 403);
        if (op === 'edit') {
            const body = text(payload.text, MAX_MESSAGE_LENGTH);
            if (!body) throw new MessageError('訊息不可空白');
            Object.assign(message, { text: body, editedAt: now });
        } else {
            Object.assign(message, { text: '', deleted: true, deletedBy: actor.username, editedAt: now });
        }
        await storage.put(key, message);
        return message;
    }

    if (op === 'read') {
        const conv = String(payload.conv || '');
        await access(storage, conv, actor, null);
        const meta = await storage.get(`meta:${conv}`);
        const seq = Math.min(Math.max(Number(payload.seq) || meta?.lastSeq || 0, 0), meta?.lastSeq || 0);
        if (seq > (read[conv] || 0)) { read[conv] = seq; await storage.put(`read:${actor.username}`, read); }
        return { conv, readSeq: read[conv] || 0 };
    }

    if (op === 'read-all') {
        for (const item of await conversations(storage, actor, read)) read[item.conv] = item.lastSeq;
        const existing = new Set();
        for (const item of (await storage.list({ prefix: 'ann:' })).values()) {
            existing.add(item.id);
            if (!canSeeAnnouncement(item, actor)) continue;
            if (!read.announcements.includes(item.id)) read.announcements.push(item.id);
            // Read receipts for officers (已讀名單) count this as read too.
            if (!item.readBy.includes(actor.username) && item.createdBy !== actor.username) {
                item.readBy.push(actor.username);
                await storage.put(`ann:${item.id}`, item);
            }
        }
        read.announcements = trimRead(read.announcements, existing);
        await storage.put(`read:${actor.username}`, read);
        return { success: true };
    }

    if (op === 'open-dm') {
        const target = String(payload.username || '').trim().toLowerCase();
        if (!USERNAME.test(target) || target === actor.username) throw new MessageError('請選擇其他帳號');
        if (people && !people.has(target)) throw new MessageError('對方帳號不存在或已停用', 404);
        return { conv: dmConversation(actor.username, target), with: target };
    }

    if (op === 'create-channel' || op === 'update-channel') {
        if (!actor.officer) throw new MessageError('只有幹部可以建立或修改聊天室', 403);
        if (op === 'create-channel') {
            const channels = await storage.list({ prefix: 'channel:' });
            if (channels.size >= MAX_CHANNELS) throw new MessageError(`聊天室最多 ${MAX_CHANNELS} 個`, 409);
            const id = crypto.randomUUID().slice(0, 8);
            const channel = { id, ...normalizeChannel(payload.fields), createdBy: actor.username, createdAt: now, archived: false };
            await storage.put(`channel:${id}`, channel);
            return channelView(channel, null, 0);
        }
        const id = String(payload.id || '');
        const channel = CHANNEL_ID.test(id) ? await storage.get(`channel:${id}`) : null;
        if (!channel) throw new MessageError('聊天室不存在', 404);
        if (!actor.president && channel.createdBy !== actor.username) throw new MessageError('只有建立者或社長可以修改此聊天室', 403);
        Object.assign(channel, normalizeChannel(payload.fields || {}, channel));
        if (typeof payload.fields?.archived === 'boolean') channel.archived = payload.fields.archived;
        channel.updatedAt = now;
        await storage.put(`channel:${id}`, channel);
        return channelView(channel, await storage.get(`meta:ch~${id}`), 0);
    }

    if (op === 'announcements') return announcementList(storage, actor, read);

    if (op === 'create-announcement') {
        if (!actor.officer) throw new MessageError('只有幹部可以發布公告', 403);
        const all = [...(await storage.list({ prefix: 'ann:' })).values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        // Oldest unpinned announcements make room for new ones.
        while (all.length >= MAX_ANNOUNCEMENTS) {
            const index = all.findIndex(item => !item.pinned);
            const [old] = all.splice(index < 0 ? 0 : index, 1);
            await storage.delete(`ann:${old.id}`);
        }
        const announcement = { id: crypto.randomUUID(), ...normalizeAnnouncement(payload.fields), createdBy: actor.username, createdByName: actor.name || actor.username, createdAt: now, readBy: [] };
        await storage.put(`ann:${announcement.id}`, announcement);
        return announcementView(announcement, actor, read);
    }

    const annId = String(payload.id || '');
    const announcement = op.endsWith('-announcement') && /^[\w-]{1,80}$/.test(annId) ? await storage.get(`ann:${annId}`) : null;
    if (op.endsWith('-announcement') && (!announcement || !canSeeAnnouncement(announcement, actor))) throw new MessageError('公告不存在', 404);

    if (op === 'read-announcement') {
        if (!read.announcements.includes(annId)) {
            const existing = new Set([...(await storage.list({ prefix: 'ann:' })).values()].map(item => item.id));
            read.announcements = trimRead([...read.announcements, annId], existing);
            await storage.put(`read:${actor.username}`, read);
        }
        if (!announcement.readBy.includes(actor.username)) {
            announcement.readBy.push(actor.username);
            await storage.put(`ann:${annId}`, announcement);
        }
        return announcementView(announcement, actor, read);
    }
    if (op === 'update-announcement' || op === 'delete-announcement') {
        if (!actor.president && announcement.createdBy !== actor.username) throw new MessageError('只有發布者或社長可以修改此公告', 403);
        if (op === 'delete-announcement') { await storage.delete(`ann:${annId}`); return { success: true }; }
        Object.assign(announcement, normalizeAnnouncement({ ...announcement, ...payload.fields }), { updatedAt: now });
        await storage.put(`ann:${annId}`, announcement);
        return announcementView(announcement, actor, read);
    }
    throw new MessageError('操作不存在', 404);
}

export class MessageStore {
    constructor(ctx) { this.storage = ctx.storage; }

    async fetch(request) {
        try {
            if (isExportRequest(request)) return await exportStorage(this.storage);
            const payload = await request.json();
            const op = new URL(request.url).pathname.slice(1);
            const body = await this.storage.transaction(storage => messageOp(storage, op, payload));
            return Response.json(body);
        } catch (error) {
            if (error instanceof MessageError) return Response.json({ error: error.message }, { status: error.status });
            console.error('Message store failed', error?.message || String(error));
            return Response.json({ error: '訊息資料操作失敗' }, { status: 500 });
        }
    }
}

// ─────────────── External push (optional module) ───────────────
// Announcements (and, if chosen, new website posts) can also be sent to
// Discord, Slack, Google Chat or Microsoft Teams incoming webhooks, or to
// every friend of a LINE official account (Messaging API broadcast).

export const PUSH_SETTINGS_KEY = 'messages:push-settings';
export const DEFAULT_PUSH_SETTINGS = { enabled: false, announcements: true, posts: false, webhooks: [], lineToken: '' };
const WEBHOOK_HOSTS = [/^discord(app)?\.com$/, /^hooks\.slack\.com$/, /^chat\.googleapis\.com$/, /\.webhook\.office\.com$/, /\.logic\.azure\.com$/];

export function webhookKind(url) {
    const host = new URL(url).hostname;
    if (/discord/.test(host)) return 'discord';
    if (/slack/.test(host)) return 'slack';
    if (/googleapis/.test(host)) return 'google-chat';
    return 'teams';
}

export function normalizePushSettings(input, current = DEFAULT_PUSH_SETTINGS) {
    const settings = { ...DEFAULT_PUSH_SETTINGS, ...current };
    if (typeof input?.enabled === 'boolean') settings.enabled = input.enabled;
    if (typeof input?.announcements === 'boolean') settings.announcements = input.announcements;
    if (typeof input?.posts === 'boolean') settings.posts = input.posts;
    if (Array.isArray(input?.webhooks)) {
        if (input.webhooks.length > 5) throw new MessageError('最多設定 5 個 Webhook');
        settings.webhooks = input.webhooks.map((entry, index) => {
            const raw = String(entry?.url ?? entry ?? '').trim();
            // A masked value from GET means "keep the stored one".
            const kept = current.webhooks?.find(item => maskUrl(item.url) === raw);
            if (kept) return { ...kept, label: text(entry?.label ?? kept.label, 40) };
            let parsed;
            try { parsed = new URL(raw); } catch { throw new MessageError(`第 ${index + 1} 個 Webhook 網址格式錯誤`); }
            if (parsed.protocol !== 'https:' || !WEBHOOK_HOSTS.some(pattern => pattern.test(parsed.hostname)) || raw.length > 600) {
                throw new MessageError(`第 ${index + 1} 個 Webhook 只支援 Discord、Slack、Google Chat 或 Microsoft Teams 的 https 網址`);
            }
            return { url: parsed.href, label: text(entry?.label, 40) || webhookKind(parsed.href) };
        });
    }
    if (typeof input?.lineToken === 'string' && input.lineToken !== maskToken(current.lineToken)) {
        const token = input.lineToken.trim();
        if (token && !/^[A-Za-z0-9+/=._-]{20,400}$/.test(token)) throw new MessageError('LINE Channel access token 格式錯誤');
        settings.lineToken = token;
    }
    return settings;
}

export function maskUrl(url) {
    const value = String(url || '');
    return value.length > 40 ? `${value.slice(0, 32)}…${value.slice(-4)}` : value.replace(/.(?=.{4})/g, '•');
}
function maskToken(token) { return token ? `••••${String(token).slice(-4)}` : ''; }

export function publicPushSettings(settings) {
    return {
        enabled: settings.enabled, announcements: settings.announcements, posts: settings.posts,
        webhooks: settings.webhooks.map(item => ({ label: item.label, kind: webhookKind(item.url), url: maskUrl(item.url) })),
        lineToken: maskToken(settings.lineToken), line: Boolean(settings.lineToken)
    };
}

function webhookBody(kind, title, body, link) {
    const message = `📢 ${title}\n${body}${link ? `\n${link}` : ''}`;
    if (kind === 'discord') return { content: message.slice(0, 1990) };
    if (kind === 'teams') return { text: message.replace(/\n/g, '\n\n') };
    return { text: message }; // Slack, Google Chat
}

// Sends one notice to every configured destination. Returns [{ target, result }].
export async function pushNotice(settings, { title, body, link = '' }, fetcher = fetch) {
    if (!settings?.enabled) return [];
    const short = String(body || '').slice(0, 1500);
    const jobs = settings.webhooks.map(item => ({
        target: item.label,
        send: () => fetcher(item.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(webhookBody(webhookKind(item.url), title, short, link)), signal: AbortSignal.timeout(10000) })
    }));
    if (settings.lineToken) {
        jobs.push({
            target: 'LINE',
            send: () => fetcher('https://api.line.me/v2/bot/message/broadcast', {
                method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.lineToken}` },
                body: JSON.stringify({ messages: [{ type: 'text', text: `📢 ${title}\n${short}${link ? `\n${link}` : ''}`.slice(0, 4900) }] }), signal: AbortSignal.timeout(10000)
            })
        });
    }
    return Promise.all(jobs.map(async job => {
        try { const response = await job.send(); return { target: job.target, result: response.ok ? 'sent' : `failed (${response.status})` }; }
        catch { return { target: job.target, result: 'failed' }; }
    }));
}
