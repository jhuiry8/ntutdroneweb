import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

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
