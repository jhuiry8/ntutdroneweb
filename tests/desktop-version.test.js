import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { withSiteStore } from './helpers/site-store.js';

function kv(initial = {}) {
    const store = new Map(Object.entries(initial));
    return {
        async get(key) { return store.has(key) ? store.get(key) : null; },
        async put(key, value) { store.set(key, value); },
        async delete(key) { store.delete(key); },
        async list({ prefix }) { return { keys: [...store.keys()].filter(name => name.startsWith(prefix)).map(name => ({ name })) }; },
        _store: store
    };
}

const release = {
    version: '1.2.0',
    url: 'https://github.com/jhuiry8/ntutdroneweb/releases/download/desktop-v1.2.0/ClubDesk-Setup-1.2.0.exe',
    sha256: 'A'.repeat(64),
    notes: '新增表單作業'
};

function put(env, body, cookie) {
    return worker.fetch(new Request('https://example.com/api/desktop/version', {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body)
    }), env);
}

test('desktop version check is public and empty until a release is published', async () => {
    const env = withSiteStore({ DRONE_DB: kv() });
    const response = await worker.fetch(new Request('https://example.com/api/desktop/version'), env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { version: null });
});

test('only the president publishes a desktop release, and it is validated', async () => {
    const env = withSiteStore({ DRONE_DB: kv({
        'session:boss': 'admin',
        'session:cash': JSON.stringify({ username: 'finance1', version: 'v1' }),
        'user:finance1': JSON.stringify({ username: 'finance1', role: 'finance', active: true, version: 'v1' })
    }) });
    assert.equal((await put(env, release)).status, 401);
    assert.equal((await put(env, release, 'session=cash')).status, 403);
    for (const bad of [{ version: '1.2' }, { url: 'http://github.com/x.exe' }, { url: 'https://evil.example/x.exe' }, { sha256: 'abc' }]) {
        const response = await put(env, { ...release, ...bad }, 'session=boss');
        assert.equal(response.status, 400, JSON.stringify(bad));
    }
    const saved = await put(env, release, 'session=boss');
    assert.equal(saved.status, 200);
    const check = await (await worker.fetch(new Request('https://example.com/api/desktop/version'), env)).json();
    assert.equal(check.version, '1.2.0');
    assert.equal(check.sha256, 'a'.repeat(64));
    assert.equal(check.url, release.url);
    assert.equal(check.publishedBy, 'admin');
});

test('GitHub Actions can announce a release with the release token, never downgrading', async () => {
    const TOKEN = 'x'.repeat(40);
    const env = withSiteStore({ DRONE_DB: kv(), DESKTOP_RELEASE_TOKEN: TOKEN });
    const bearer = (body, token) => worker.fetch(new Request('https://example.com/api/desktop/version', {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body)
    }), env);
    assert.equal((await bearer(release, 'wrong-token')).status, 401);
    const saved = await bearer({ ...release, version: '1.2.3' }, TOKEN);
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).publishedBy, 'github-actions');
    const older = await bearer({ ...release, version: '1.2.1' }, TOKEN);
    assert.equal(older.status, 409);
    const check = await (await worker.fetch(new Request('https://example.com/api/desktop/version'), env)).json();
    assert.equal(check.version, '1.2.3');
});

test('the release token is ignored when it is missing or too short', async () => {
    const env = withSiteStore({ DRONE_DB: kv(), DESKTOP_RELEASE_TOKEN: 'short' });
    const response = await worker.fetch(new Request('https://example.com/api/desktop/version', {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer short' }, body: JSON.stringify(release)
    }), env);
    assert.equal(response.status, 401);
});
