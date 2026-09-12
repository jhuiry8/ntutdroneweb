import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

const deriveBits = crypto.subtle.deriveBits.bind(crypto.subtle);
// Local WebCrypto is more permissive than production Workers. Apply the real
// limit to every route test, including bootstrap, migration, and password changes.
beforeEach(t => {
    t.mock.method(crypto.subtle, 'deriveBits', (params, key, length) => {
        if (params.name === 'PBKDF2' && params.iterations > 100000) {
            throw new Error(`Pbkdf2 failed: iteration counts above 100000 are not supported (requested ${params.iterations}).`);
        }
        return deriveBits(params, key, length);
    });
});

// Create Mock KV Store for Cloudflare DRONE_DB
function createMockKV(initialData = {}) {
    const store = new Map(Object.entries(initialData));
    return {
        async get(key) {
            return store.has(key) ? store.get(key) : null;
        },
        async put(key, val) {
            store.set(key, typeof val === 'string' ? val : JSON.stringify(val));
        },
        async delete(key) {
            store.delete(key);
        },
        async list({ prefix }) {
            return { keys: [...store.keys()].filter(name => name.startsWith(prefix)).map(name => ({ name })) };
        },
        _store: store
    };
}

test('Worker test suite - Cloudflare Worker Routes & CMS APIs', async (t) => {
    const mockEnv = {
        DRONE_DB: createMockKV({
            'posts_list': JSON.stringify([
                { title: '測試文章 1', slug: 'ntut1', date: '2026-07-28T00:00:00.000Z', summary: '摘要 1' }
            ]),
            'pages_list': JSON.stringify([
                { title: '關於我們 頁面', slug: 'about-us' }
            ]),
            'admin_password_hash': 'ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f', // sha256 for "admin123"
            'session:valid-token': 'admin'
        })
    };

    await t.test('GET / should return 200 OK landing page HTML', async () => {
        const req = new Request('http://localhost/', { method: 'GET' });
        const res = await worker.fetch(req, mockEnv);
        assert.equal(res.status, 200);
        const text = await res.text();
        assert.ok(text.includes('<!DOCTYPE html>'));
        assert.ok(text.includes('北科無人機社'));
    });

    await t.test('GET /blog/ntut1 should return 200 OK post page HTML with list fallback', async () => {
        const req = new Request('http://localhost/blog/ntut1', { method: 'GET' });
        const res = await worker.fetch(req, mockEnv);
        assert.equal(res.status, 200);
        const text = await res.text();
        assert.ok(text.includes('測試文章 1'));
    });

    await t.test('GET /api/posts/ntut1 unauthenticated should return 401 Unauthorized', async () => {
        const req = new Request('http://localhost/api/posts/ntut1', { method: 'GET' });
        const res = await worker.fetch(req, mockEnv);
        assert.equal(res.status, 401);
    });

    await t.test('GET /api/posts/ntut1 authenticated with KV fallback should return 200 OK post JSON', async () => {
        const req = new Request('http://localhost/api/posts/ntut1', {
            method: 'GET',
            headers: { 'Cookie': 'session=valid-token' }
        });
        const res = await worker.fetch(req, mockEnv);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.slug, 'ntut1');
        assert.equal(data.title, '測試文章 1');
    });

    await t.test('POST /api/posts should create new post', async () => {
        const newPost = {
            title: '全新測試文章',
            lang: 'zh',
            slug: 'new-post-test',
            summary: '全新測試摘要',
            content: '# 全新測試內容',
            originalSlug: ''
        };

        const req = new Request('http://localhost/api/posts', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': 'session=valid-token'
            },
            body: JSON.stringify(newPost)
        });

        const res = await worker.fetch(req, mockEnv);
        assert.equal(res.status, 200);
        const result = await res.json();
        assert.equal(result.success, true);

        // Verify stored in mock KV
        const stored = await mockEnv.DRONE_DB.get('post:new-post-test');
        assert.ok(stored);
        assert.ok(stored.includes('全新測試文章'));
    });

    await t.test('DELETE /api/posts/new-post-test should delete post', async () => {
        const req = new Request('http://localhost/api/posts/new-post-test', {
            method: 'DELETE',
            headers: { 'Cookie': 'session=valid-token' }
        });

        const res = await worker.fetch(req, mockEnv);
        assert.equal(res.status, 200);

        // Verify removed from mock KV
        const stored = await mockEnv.DRONE_DB.get('post:new-post-test');
        assert.equal(stored, null);
    });

    await t.test('GET /admin should render admin page or login page', async () => {
        const req = new Request('http://localhost/admin', { method: 'GET' });
        const res = await worker.fetch(req, mockEnv);
        assert.equal(res.status, 200);
    });
});

test('individual accounts enforce roles and password rotation', async () => {
    const env = { DRONE_DB: createMockKV(), ADMIN_INITIAL_PASSWORD: 'initial-admin-secret' };
    const login = async (username, password) => worker.fetch(new Request('https://example.com/api/login', {
        method: 'POST', body: new URLSearchParams({ username, password })
    }), env);
    const adminLogin = await login('admin', 'initial-admin-secret');
    assert.equal(adminLogin.status, 302);
    const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];
    const create = await worker.fetch(new Request('https://example.com/api/users', {
        method: 'POST', headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'treasurer', password: 'finance-secret-123', role: 'finance' })
    }), env);
    assert.equal(create.status, 201);
    const financeLogin = await login('treasurer', 'finance-secret-123');
    assert.equal(financeLogin.status, 302);
    const financeCookie = financeLogin.headers.get('set-cookie').split(';')[0];
    const read = await worker.fetch(new Request('https://example.com/api/homepage', { headers: { Cookie: financeCookie } }), env);
    assert.equal(read.status, 200);
    const denied = await worker.fetch(new Request('https://example.com/api/homepage', {
        method: 'POST', headers: { Cookie: financeCookie, 'Content-Type': 'application/json' }, body: '{}'
    }), env);
    assert.equal(denied.status, 403);
    const passwordChange = await worker.fetch(new Request('https://example.com/api/change-password', {
        method: 'POST', headers: { Cookie: financeCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword: 'finance-secret-123', newPassword: 'updated-finance-secret' })
    }), env);
    assert.equal(passwordChange.status, 200);
    assert.equal((await login('treasurer', 'finance-secret-123')).status, 200);
    assert.equal((await login('treasurer', 'updated-finance-secret')).status, 302);
    assert.equal((await worker.fetch(new Request('https://example.com/api/homepage', { headers: { Cookie: financeCookie } }), env)).status, 401);
});

test('login requires configured CAPTCHA and limits repeated bad passwords', async () => {
    const env = { DRONE_DB: createMockKV(), ADMIN_INITIAL_PASSWORD: 'adminpass', TURNSTILE_SITE_KEY: 'site-key', TURNSTILE_SECRET_KEY: 'secret-key' };
    const page = await worker.fetch(new Request('https://example.com/admin'), env);
    assert.match(await page.text(), /cf-turnstile/);
    const missingCaptcha = await worker.fetch(new Request('https://example.com/api/login', {
        method: 'POST', body: new URLSearchParams({ username: 'admin', password: 'adminpass' })
    }), env);
    assert.equal(missingCaptcha.status, 400);
    delete env.TURNSTILE_SECRET_KEY;
    for (let i = 0; i < 5; i++) {
        const response = await worker.fetch(new Request('https://example.com/api/login', {
            method: 'POST', body: new URLSearchParams({ username: 'admin', password: 'wrongpass' })
        }), env);
        assert.equal(response.status, 200);
    }
    const limited = await worker.fetch(new Request('https://example.com/api/login', {
        method: 'POST', body: new URLSearchParams({ username: 'admin', password: 'adminpass' })
    }), env);
    assert.equal(limited.status, 429);
});

test('legacy shared password migrates to admin account without losing content', async () => {
    const legacy = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('oldpassword' + 'ntut_drone_salt_123'));
    const hash = [...new Uint8Array(legacy)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const env = { DRONE_DB: createMockKV({ admin_password_hash: hash, posts_list: '[{"title":"保留文章"}]', 'session:legacy': 'admin' }) };
    const response = await worker.fetch(new Request('https://example.com/api/login', {
        method: 'POST', body: new URLSearchParams({ username: 'admin', password: 'oldpassword' })
    }), env);
    assert.equal(response.status, 302);
    assert.equal(await env.DRONE_DB.get('admin_password_hash'), null);
    assert.ok(await env.DRONE_DB.get('user:admin'));
    assert.equal(await env.DRONE_DB.get('posts_list'), '[{"title":"保留文章"}]');
    const oldSession = await worker.fetch(new Request('https://example.com/api/homepage', { headers: { Cookie: 'session=legacy' } }), env);
    assert.equal(oldSession.status, 401);
});

test('unsupported existing account hash gives a recovery message without overwriting credentials', async () => {
    const user = JSON.stringify({ username: 'imported', role: 'member', active: true, version: 'v1', passwordHash: `pbkdf2:old-salt:${'a'.repeat(64)}` });
    const env = { DRONE_DB: createMockKV({ 'user:imported': user }), ADMIN_INITIAL_PASSWORD: 'bootstrap-password' };
    const response = await worker.fetch(new Request('https://example.com/api/login', {
        method: 'POST', body: new URLSearchParams({ username: 'imported', password: 'some-password' })
    }), env);
    assert.equal(response.status, 409);
    assert.match(await response.text(), /重設密碼/);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(await env.DRONE_DB.get('user:imported'), user);

    const adminLogin = await worker.fetch(new Request('https://example.com/api/login', {
        method: 'POST', body: new URLSearchParams({ username: 'admin', password: 'bootstrap-password' })
    }), env);
    assert.equal(adminLogin.status, 302);
    const reset = await worker.fetch(new Request('https://example.com/api/users', {
        method: 'PATCH', headers: { Cookie: adminLogin.headers.get('set-cookie').split(';')[0], 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'imported', password: 'reset-password' })
    }), env);
    assert.equal(reset.status, 200);
    assert.match(JSON.parse(await env.DRONE_DB.get('user:imported')).passwordHash, /^pbkdf2:100000:/);
    const loginAfterReset = await worker.fetch(new Request('https://example.com/api/login', {
        method: 'POST', body: new URLSearchParams({ username: 'imported', password: 'reset-password' })
    }), env);
    assert.equal(loginAfterReset.status, 302);
});
