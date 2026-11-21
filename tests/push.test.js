import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { MessageStore } from '../src/worker.js';
import { withSiteStore } from './helpers/site-store.js';
import { b64urlEncode, b64urlDecode, encryptPayload, sendWebPush, validEndpoint } from '../src/webpush.js';

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


const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
const jwk = await crypto.subtle.exportKey('jwk', keys.privateKey);
const VAPID = {
    VAPID_PUBLIC_KEY: b64urlEncode(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')])),
    VAPID_PRIVATE_KEY: jwk.d, VAPID_SUBJECT: 'mailto:test@example.com'
};

// A browser's side of the subscription, able to decrypt what the server sends (RFC 8291).
async function browser(endpoint) {
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const p256dh = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const hkdf = async (secret, salt, info, bytes) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']), bytes * 8));
    const enc = new TextEncoder();
    return {
        subscription: { endpoint, keys: { p256dh: b64urlEncode(p256dh), auth: b64urlEncode(auth) } },
        async decrypt(body) {
            const salt = body.slice(0, 16), idlen = body[20], serverPublic = body.slice(21, 21 + idlen), cipher = body.slice(21 + idlen);
            const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: await crypto.subtle.importKey('raw', serverPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []) }, pair.privateKey, 256));
            const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...p256dh, ...serverPublic]);
            const ikm = await hkdf(shared, auth, info, 32);
            const cek = await hkdf(ikm, salt, enc.encode('Content-Encoding: aes128gcm\0'), 16);
            const nonce = await hkdf(ikm, salt, enc.encode('Content-Encoding: nonce\0'), 12);
            const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), cipher));
            assert.equal(plain.at(-1), 2);
            return JSON.parse(new TextDecoder().decode(plain.slice(0, -1)));
        }
    };
}

test('push payload is encrypted so only the subscribed browser can read it', async () => {
    const b = await browser('https://fcm.googleapis.com/fcm/send/abc');
    const body = await encryptPayload(b.subscription, JSON.stringify({ title: '你好', body: '世界' }));
    assert.deepEqual(await b.decrypt(body), { title: '你好', body: '世界' });
});

test('push is signed with VAPID and only goes to browser push services', async () => {
    assert.equal(validEndpoint('https://fcm.googleapis.com/fcm/send/x'), true);
    assert.equal(validEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x'), true);
    assert.equal(validEndpoint('https://169.254.169.254/latest'), false);
    assert.equal(validEndpoint('http://fcm.googleapis.com/x'), false);
    assert.equal(validEndpoint('https://evil.example.com/fcm.googleapis.com'), false);
    const b = await browser('https://fcm.googleapis.com/fcm/send/abc');
    let call;
    const result = await sendWebPush(VAPID, b.subscription, { title: 't' }, { fetcher: async (url, init) => { call = { url, init }; return new Response(null, { status: 201 }); } });
    assert.equal(result.ok, true);
    const [, jwt, publicKey] = /^vapid t=([^,]+), k=(.+)$/.exec(call.init.headers.Authorization);
    assert.equal(publicKey, VAPID.VAPID_PUBLIC_KEY);
    const [h, c, sig] = jwt.split('.');
    const verifyKey = await crypto.subtle.importKey('raw', b64urlDecode(VAPID.VAPID_PUBLIC_KEY), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    assert.equal(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifyKey, b64urlDecode(sig), new TextEncoder().encode(`${h}.${c}`)), true);
    assert.equal(JSON.parse(Buffer.from(c, 'base64url')).aud, 'https://fcm.googleapis.com');
    assert.equal((await sendWebPush(VAPID, b.subscription, {}, { fetcher: async () => new Response(null, { status: 410 }) })).gone, true);
    assert.equal((await sendWebPush({}, b.subscription, {})).ok, false); // not configured
});

async function setup() {
    const f = fixture();
    Object.assign(f.env, VAPID);
    const sent = [];
    const subs = {};
    const original = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        const who = Object.keys(subs).find(name => subs[name].subscription.endpoint === String(url));
        if (!who) return original(url, init);
        sent.push({ who, payload: await subs[who].decrypt(new Uint8Array(init.body)) });
        return new Response(null, { status: 201 });
    };
    const subscribe = async (name, prefs) => {
        subs[name] = await browser(`https://fcm.googleapis.com/fcm/send/${name}`);
        const res = await f.request('/api/push/subscribe', name, 'POST', { subscription: subs[name].subscription, prefs });
        assert.equal(res.status, 200);
    };
    return { ...f, sent, subscribe, restore: () => { globalThis.fetch = original; } };
}

test('push endpoints need sign-in, report the public key and validate subscriptions', async () => {
    const f = await setup();
    try {
        assert.equal((await f.request('/api/push/public-key')).status, 401);
        assert.equal((await f.request('/api/push/public-key', 'alice')).body.publicKey, VAPID.VAPID_PUBLIC_KEY);
        const bad = await f.request('/api/push/subscribe', 'alice', 'POST', { subscription: { endpoint: 'https://evil.example.com/x', keys: { p256dh: 'a', auth: 'b' } } });
        assert.equal(bad.status, 400);
    } finally { f.restore(); }
});

test('new chat messages are pushed to the other people who may see the room, not the sender', async () => {
    const f = await setup();
    try {
        await f.subscribe('alice'); await f.subscribe('bob'); await f.subscribe('cadre1');
        await f.request('/api/messages/c/ch~general', 'alice', 'POST', { text: '今天有人要去飛嗎？' });
        assert.deepEqual(f.sent.map(item => item.who).sort(), ['bob', 'cadre1']);
        assert.equal(f.sent[0].payload.title, '💬 全體社員聊天室');
        assert.match(f.sent[0].payload.body, /王小明：今天有人要去飛嗎？/);
        assert.equal(f.sent[0].payload.conv, 'ch~general');
        f.sent.length = 0;
        // the officers room is invisible to members
        await f.request('/api/messages/c/ch~officers', 'cadre1', 'POST', { text: '幹部會議' });
        assert.deepEqual(f.sent, []);
    } finally { f.restore(); }
});

test('private messages go only to the other person, and respect their preferences', async () => {
    const f = await setup();
    try {
        await f.subscribe('alice'); await f.subscribe('bob', { messages: false });
        const dm = (await f.request('/api/messages/dm', 'alice', 'POST', { username: 'bob' })).body;
        await f.request(`/api/messages/c/${dm.conv}`, 'alice', 'POST', { text: 'hi' });
        assert.deepEqual(f.sent, []); // bob turned message pushes off
        await f.subscribe('bob', { messages: true });
        await f.request(`/api/messages/c/${dm.conv}`, 'alice', 'POST', { text: 'hi again' });
        assert.deepEqual(f.sent.map(item => item.who), ['bob']);
        assert.equal(f.sent[0].payload.tab, 'dm');
    } finally { f.restore(); }
});

test('announcements are pushed to everyone, or only officers, and dead subscriptions are removed', async () => {
    const f = await setup();
    try {
        await f.subscribe('alice'); await f.subscribe('bob'); await f.subscribe('cadre1'); await f.subscribe('president');
        await f.request('/api/announcements', 'cadre1', 'POST', { title: '週六飛行', content: '集合', audience: 'all' });
        assert.deepEqual(f.sent.map(item => item.who).sort(), ['alice', 'bob', 'president']);
        assert.equal(f.sent[0].payload.kind, 'announcements');
        f.sent.length = 0;
        await f.request('/api/announcements', 'cadre1', 'POST', { title: '幹部限定', content: 'x', audience: 'officers' });
        assert.deepEqual(f.sent.map(item => item.who), ['president']);
        // a browser signing in as someone else takes over the subscription
        const endpoint = 'https://fcm.googleapis.com/fcm/send/alice';
        await f.request('/api/push/subscribe', 'bob', 'POST', { subscription: { ...(await f.request('/api/push/public-key', 'bob')).body && { endpoint, keys: { p256dh: 'x', auth: 'y' } } } });
        const real = f.store.get('push:alice');
        assert.equal(real, undefined);
        // unsubscribe
        await f.request('/api/push/unsubscribe', 'president', 'POST', { endpoint: 'https://fcm.googleapis.com/fcm/send/president' });
        assert.equal(f.store.get('push:president'), undefined);
    } finally { f.restore(); }
});
