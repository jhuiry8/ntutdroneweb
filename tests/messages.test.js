import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { MessageStore } from '../src/worker.js';
import { normalizePushSettings, publicPushSettings, pushNotice, dmConversation, MessageError } from '../src/messages.js';
import { withSiteStore } from './helpers/site-store.js';

function durableObject(Class) {
    const values = new Map();
    let tail = Promise.resolve();
    const storage = {
        async get(key) { return structuredClone(values.get(key)); },
        async put(key, value) { values.set(key, structuredClone(value)); },
        async delete(keys) { for (const key of [].concat(keys)) values.delete(key); },
        async list({ prefix = '', start = '', limit = Infinity } = {}) {
            return new Map([...values.entries()].filter(([key]) => key.startsWith(prefix) && key >= start).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit));
        },
        transaction(callback) { const result = tail.then(() => callback(storage)); tail = result.catch(() => {}); return result; }
    };
    const object = new Class({ storage });
    return { idFromName: name => name, get: () => ({ fetch: (input, init) => object.fetch(input instanceof Request ? input : new Request(input, init)) }), values };
}

function fixture() {
    const store = new Map();
    const db = {
        async get(key) { return store.get(key) ?? null; },
        async put(key, value) { store.set(key, typeof value === 'string' ? value : JSON.stringify(value)); },
        async delete(key) { store.delete(key); },
        async list({ prefix }) { listCalls.push(prefix); return { keys: [...store.keys()].filter(name => name.startsWith(prefix)).map(name => ({ name })) }; }
    };
    const listCalls = [];
    const accounts = { president: 'president', cadre1: 'cadre', alice: 'member', bob: 'member', gone: 'member' };
    for (const [username, role] of Object.entries(accounts)) {
        store.set(`user:${username}`, JSON.stringify({ username, role, active: username !== 'gone', version: 'v1', memberId: username === 'alice' ? 'm1' : '' }));
        store.set(`session:${username}`, JSON.stringify({ username, version: 'v1' }));
    }
    store.set('members:list', JSON.stringify([{ id: 'm1', name: '王小明', level: 'member', feeStatus: 'lifetime' }]));
    const env = withSiteStore({ DRONE_DB: db, MESSAGE_STORE: durableObject(MessageStore) });
    const request = async (path, who, method = 'GET', body) => {
        const response = await worker.fetch(new Request(`https://example.com${path}`, {
            method,
            headers: { ...(who ? { Cookie: `session=${who}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) })
        }), env);
        return { status: response.status, body: await response.json() };
    };
    return { request, store, env, listCalls };
}

test('message centre needs a signed-in account', async () => {
    const { request } = fixture();
    assert.equal((await request('/api/messages/summary')).status, 401);
});

test('default chat rooms respect who may see them', async () => {
    const { request } = fixture();
    const member = (await request('/api/messages/conversations', 'alice')).body.map(item => item.id);
    assert.deepEqual(member.sort(), ['flight', 'general']);
    const officer = (await request('/api/messages/conversations', 'cadre1')).body.map(item => item.id);
    assert.ok(officer.includes('officers'));
    const denied = await request('/api/messages/c/ch~officers', 'alice', 'POST', { text: 'hi' });
    assert.equal(denied.status, 404);
});

test('chat messages count as unread until read, and your own are read', async () => {
    const { request } = fixture();
    const sent = await request('/api/messages/c/ch~general', 'alice', 'POST', { text: '  今天有人要去飛嗎？ ' });
    assert.equal(sent.status, 201);
    assert.equal(sent.body.seq, 1);
    assert.equal(sent.body.text, '今天有人要去飛嗎？');
    assert.equal(sent.body.authorName, '王小明');
    assert.equal((await request('/api/messages/summary', 'alice')).body.unreadMessages, 0);
    const bobSummary = (await request('/api/messages/summary', 'bob')).body;
    assert.equal(bobSummary.unreadMessages, 1);
    assert.equal(bobSummary.conversations[0].conv, 'ch~general');
    await request('/api/messages/c/ch~general', 'bob', 'POST', { text: '我！' });
    const history = await request('/api/messages/c/ch~general?after=1', 'alice');
    assert.deepEqual(history.body.messages.map(item => item.text), ['我！']);
    await request('/api/messages/c/ch~general/read', 'alice', 'POST', { seq: 2 });
    assert.equal((await request('/api/messages/summary', 'alice')).body.unreadMessages, 0);
    assert.equal((await request('/api/messages/c/ch~general', 'alice', 'POST', { text: '   ' })).status, 400);
});

test('only the author edits a message; the president may also delete it', async () => {
    const { request } = fixture();
    await request('/api/messages/c/ch~general', 'alice', 'POST', { text: '原本' });
    assert.equal((await request('/api/messages/c/ch~general/1', 'bob', 'PATCH', { text: '亂改' })).status, 403);
    const edited = await request('/api/messages/c/ch~general/1', 'alice', 'PATCH', { text: '修改後' });
    assert.equal(edited.body.text, '修改後');
    assert.ok(edited.body.editedAt);
    assert.equal((await request('/api/messages/c/ch~general/1', 'bob', 'DELETE')).status, 403);
    const removed = await request('/api/messages/c/ch~general/1', 'president', 'DELETE');
    assert.equal(removed.body.deleted, true);
    assert.equal((await request('/api/messages/c/ch~general', 'bob')).body.messages[0].text, '');
});

test('private messages stay between the two people', async () => {
    const { request } = fixture();
    const opened = await request('/api/messages/dm', 'alice', 'POST', { username: 'bob' });
    assert.equal(opened.body.conv, dmConversation('alice', 'bob'));
    assert.equal((await request('/api/messages/dm', 'alice', 'POST', { username: 'gone' })).status, 404);
    assert.equal((await request('/api/messages/dm', 'alice', 'POST', { username: 'alice' })).status, 400);
    const conv = opened.body.conv;
    assert.equal((await request(`/api/messages/c/${conv}`, 'alice', 'POST', { text: '借我電池' })).status, 201);
    assert.equal((await request(`/api/messages/c/${conv}`, 'cadre1')).status, 404);
    assert.equal((await request(`/api/messages/c/${conv}`, 'president')).status, 404);
    const bob = (await request('/api/messages/conversations', 'bob')).body.find(item => item.kind === 'dm');
    assert.equal(bob.with, 'alice');
    assert.equal(bob.unread, 1);
    assert.equal((await request('/api/messages/c/dm~alice~gone', 'alice', 'POST', { text: 'x' })).status, 404);
    // The same pair in the other order is not a second thread.
    assert.equal((await request('/api/messages/c/dm~bob~alice', 'alice', 'POST', { text: '另一串' })).status, 404);
    assert.equal((await request('/api/messages/conversations', 'bob')).body.filter(item => item.kind === 'dm').length, 1);
});

test('officers create rooms; members cannot, and custom rooms list their members', async () => {
    const { request } = fixture();
    assert.equal((await request('/api/messages/channels', 'alice', 'POST', { name: '我的房間' })).status, 403);
    const created = await request('/api/messages/channels', 'cadre1', 'POST', { name: '比賽小組', audience: 'custom', members: ['alice', 'BAD NAME'] });
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.members, ['alice']);
    assert.ok((await request('/api/messages/conversations', 'alice')).body.some(item => item.id === created.body.id));
    assert.ok(!(await request('/api/messages/conversations', 'bob')).body.some(item => item.id === created.body.id));
    const readOnly = await request(`/api/messages/channels/${created.body.id}`, 'cadre1', 'PATCH', { readOnly: true, audience: 'all' });
    assert.equal(readOnly.body.readOnly, true);
    assert.equal((await request(`/api/messages/c/ch~${created.body.id}`, 'bob', 'POST', { text: 'hi' })).status, 403);
    const archived = await request(`/api/messages/channels/${created.body.id}`, 'president', 'PATCH', { archived: true });
    assert.equal(archived.body.archived, true);
    // Members no longer see it; its creator still does (to reopen it) but cannot post.
    assert.ok(!(await request('/api/messages/conversations', 'alice')).body.some(item => item.id === created.body.id));
    assert.ok((await request('/api/messages/conversations', 'cadre1')).body.some(item => item.id === created.body.id && item.archived));
    assert.equal((await request(`/api/messages/c/ch~${created.body.id}`, 'cadre1', 'POST', { text: 'hi' })).status, 409);
    const reopened = await request(`/api/messages/channels/${created.body.id}`, 'cadre1', 'PATCH', { archived: false });
    assert.equal(reopened.body.archived, false);
    assert.equal((await request(`/api/messages/c/ch~${created.body.id}`, 'cadre1', 'POST', { text: 'hi' })).status, 201);
});

test('announcements: officers publish, everyone gets an unread notice, officers see who read it', async () => {
    const { request } = fixture();
    assert.equal((await request('/api/announcements', 'alice', 'POST', { title: 'x', content: 'y' })).status, 403);
    const created = await request('/api/announcements', 'cadre1', 'POST', { title: '期末社員大會', content: '12/20 晚上七點', pinned: true });
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.push, []);
    const officersOnly = await request('/api/announcements', 'cadre1', 'POST', { title: '幹部會議', content: '週五', audience: 'officers' });
    const alice = (await request('/api/messages/summary', 'alice')).body;
    assert.equal(alice.unreadAnnouncements, 1);
    assert.equal(alice.announcements[0].title, '期末社員大會');
    assert.equal((await request(`/api/announcements/${officersOnly.body.id}/read`, 'alice', 'POST')).status, 404);
    const read = await request(`/api/announcements/${created.body.id}/read`, 'alice', 'POST');
    assert.equal(read.body.read, true);
    assert.equal(read.body.readBy, undefined);
    assert.equal((await request('/api/messages/summary', 'alice')).body.unreadAnnouncements, 0);
    const officerView = (await request('/api/announcements', 'president')).body.find(item => item.id === created.body.id);
    assert.deepEqual(officerView.readBy, ['alice']);
    assert.equal((await request(`/api/announcements/${created.body.id}`, 'bob', 'DELETE')).status, 403);
    assert.equal((await request(`/api/announcements/${created.body.id}`, 'president', 'DELETE')).status, 200);
});

test('external push is off by default, president only, and keeps webhook URLs secret', async t => {
    const { request } = fixture();
    assert.equal((await request('/api/messages/push-settings', 'cadre1')).status, 403);
    assert.equal((await request('/api/messages/push-settings', 'president')).body.enabled, false);
    const bad = await request('/api/messages/push-settings', 'president', 'PUT', { webhooks: [{ url: 'https://evil.example/hook' }] });
    assert.equal(bad.status, 400);
    const hook = 'https://discord.com/api/webhooks/123456/abcdefghijklmnopqrstuvwxyz';
    const saved = await request('/api/messages/push-settings', 'president', 'PUT', { enabled: true, webhooks: [{ url: hook, label: 'Discord 社團' }] });
    assert.equal(saved.status, 200);
    assert.notEqual(saved.body.webhooks[0].url, hook);
    // Saving the masked value again keeps the stored URL.
    const again = await request('/api/messages/push-settings', 'president', 'PUT', { webhooks: saved.body.webhooks });
    assert.equal(again.status, 200);
    const sent = [];
    t.mock.method(globalThis, 'fetch', async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return new Response(null, { status: 204 }); });
    const created = await request('/api/announcements', 'cadre1', 'POST', { title: '招生說明會', content: '歡迎參加' });
    assert.deepEqual(created.body.push, [{ target: 'Discord 社團', result: 'sent' }]);
    assert.equal(sent[0].url, hook);
    assert.match(sent[0].body.content, /招生說明會/);
    await request('/api/announcements', 'cadre1', 'POST', { title: '幹部限定', content: '不外流', audience: 'officers' });
    assert.equal(sent.length, 1);
});

test('push settings validation and message formats', async () => {
    assert.throws(() => normalizePushSettings({ webhooks: [{ url: 'http://hooks.slack.com/x' }] }), MessageError);
    assert.throws(() => normalizePushSettings({ lineToken: 'short' }), MessageError);
    const settings = normalizePushSettings({ enabled: true, webhooks: [{ url: 'https://hooks.slack.com/services/T/B/C' }], lineToken: 'a'.repeat(40) });
    assert.equal(publicPushSettings(settings).line, true);
    assert.ok(!JSON.stringify(publicPushSettings(settings)).includes('a'.repeat(40)));
    const calls = [];
    const results = await pushNotice(settings, { title: 'T', body: 'B' }, async (url, init) => { calls.push({ url, init }); return { ok: true }; });
    assert.equal(results.length, 2);
    assert.deepEqual(JSON.parse(calls[0].init.body), { text: '📢 T\nB' });
    assert.equal(calls[1].url, 'https://api.line.me/v2/bot/message/broadcast');
    assert.equal(calls[1].init.headers.Authorization, `Bearer ${'a'.repeat(40)}`);
    assert.deepEqual(await pushNotice({ ...settings, enabled: false }, { title: 'T', body: 'B' }), []);
});

test('mark all as read also records announcement read receipts', async () => {
    const { request } = fixture();
    const created = await request('/api/announcements', 'cadre1', 'POST', { title: '社課暫停', content: '下週停課' });
    await request('/api/messages/c/ch~general', 'bob', 'POST', { text: '收到' });
    assert.equal((await request('/api/messages/read-all', 'alice', 'POST', {})).status, 200);
    const summary = (await request('/api/messages/summary', 'alice')).body;
    assert.equal(summary.unreadAnnouncements, 0);
    assert.equal(summary.unreadMessages, 0);
    const officerView = (await request('/api/announcements', 'president')).body.find(item => item.id === created.body.id);
    assert.deepEqual(officerView.readBy, ['alice']);
});

test('deleted announcements do not keep a place in the read list', async () => {
    const { request, env } = fixture();
    const first = await request('/api/announcements', 'cadre1', 'POST', { title: '舊公告', content: 'x' });
    await request(`/api/announcements/${first.body.id}/read`, 'alice', 'POST');
    await request(`/api/announcements/${first.body.id}`, 'cadre1', 'DELETE');
    const second = await request('/api/announcements', 'cadre1', 'POST', { title: '新公告', content: 'y' });
    await request(`/api/announcements/${second.body.id}/read`, 'alice', 'POST');
    const stored = await env.MESSAGE_STORE.values.get('read:alice');
    assert.deepEqual(stored.announcements, [second.body.id]);
});

test('unread checks do not read the whole account list', async () => {
    const { request, listCalls } = fixture();
    listCalls.length = 0;
    await request('/api/messages/summary', 'alice');
    await request('/api/messages/conversations', 'alice');
    await request('/api/messages/c/ch~general', 'alice', 'POST', { text: '頻道訊息不需要帳號清單' });
    assert.ok(!listCalls.includes('user:'), `unexpected account listing: ${listCalls}`);
    const sent = await request('/api/messages/c/ch~general', 'alice', 'GET');
    assert.equal(sent.body.messages.at(-1).authorName, '王小明');
    await request('/api/messages/people', 'alice');
    assert.ok(listCalls.includes('user:'));
});
