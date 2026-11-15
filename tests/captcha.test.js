import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { CAPTCHA_CHARSET, createCaptcha, randomCaptchaCode, renderCaptchaSvg, verifyCaptcha } from '../src/captcha.js';

function createMockKV() {
    const store = new Map();
    return {
        async get(key) { return store.has(key) ? store.get(key) : null; },
        async put(key, val) { store.set(key, String(val)); },
        async delete(key) { store.delete(key); },
        async list({ prefix }) { return { keys: [...store.keys()].filter(n => n.startsWith(prefix)).map(name => ({ name })) }; },
        _store: store
    };
}

const loginPage = async env => (await worker.fetch(new Request('https://example.com/admin'), env)).text();
const captchaIdFrom = html => /name="captcha_id"[^>]*value="([^"]+)"/.exec(html)[1];
const postLogin = (env, fields, ip = '203.0.113.7') => worker.fetch(new Request('https://example.com/api/login', {
    method: 'POST', headers: { 'CF-Connecting-IP': ip }, body: new URLSearchParams(fields)
}), env);

test('captcha codes use the readable charset and are drawn as paths, not text', () => {
    const code = randomCaptchaCode();
    assert.equal(code.length, 5);
    for (const char of code) assert.ok(CAPTCHA_CHARSET.includes(char));
    const svg = renderCaptchaSvg(code);
    assert.doesNotMatch(svg, /<text/);
    assert.ok(!svg.includes(code));
});

test('captcha verification is case-insensitive and single use', async () => {
    const kv = createMockKV();
    const { id } = await createCaptcha(kv);
    const code = await kv.get(`captcha:${id}`);
    assert.equal(await verifyCaptcha(kv, id, code.toLowerCase()), true);
    assert.equal(await verifyCaptcha(kv, id, code), false, 'reused challenge must fail');

    const second = await createCaptcha(kv);
    assert.equal(await verifyCaptcha(kv, second.id, 'WRONG'), false);
    assert.equal(await kv.get(`captcha:${second.id}`), null, 'failed attempt burns the challenge');
    assert.equal(await verifyCaptcha(kv, 'not-a-uuid', 'X'), false);
});

test('login without Turnstile requires the image captcha', async () => {
    const env = { DRONE_DB: createMockKV(), ADMIN_INITIAL_PASSWORD: 'adminpass' };
    const html = await loginPage(env);
    assert.match(html, /name="captcha"/);
    assert.doesNotMatch(html, /cf-turnstile/);

    const missing = await postLogin(env, { username: 'admin', password: 'adminpass' });
    assert.equal(missing.status, 400);
    assert.equal(missing.headers.get('set-cookie'), null);

    const id = captchaIdFrom(await loginPage(env));
    const wrong = await postLogin(env, { username: 'admin', password: 'adminpass', captcha_id: id, captcha: 'XXXXX' });
    assert.equal(wrong.status, 400);
    assert.match(await wrong.text(), /驗證碼錯誤/);

    const freshId = captchaIdFrom(await loginPage(env));
    const ok = await postLogin(env, { username: 'admin', password: 'adminpass', captcha_id: freshId, captcha: await env.DRONE_DB.get(`captcha:${freshId}`) });
    assert.equal(ok.status, 302);
});

test('login is limited per IP even when usernames rotate', async () => {
    const env = { DRONE_DB: createMockKV(), ADMIN_INITIAL_PASSWORD: 'adminpass' };
    for (let i = 0; i < 20; i++) {
        const id = captchaIdFrom(await loginPage(env));
        const res = await postLogin(env, { username: `user${i}`, password: 'nope', captcha_id: id, captcha: await env.DRONE_DB.get(`captcha:${id}`) });
        assert.equal(res.status, 200);
    }
    const id = captchaIdFrom(await loginPage(env));
    const limited = await postLogin(env, { username: 'admin', password: 'adminpass', captcha_id: id, captcha: await env.DRONE_DB.get(`captcha:${id}`) });
    assert.equal(limited.status, 429);
    const otherIp = captchaIdFrom(await loginPage(env));
    const allowed = await postLogin(env, { username: 'admin', password: 'adminpass', captcha_id: otherIp, captcha: await env.DRONE_DB.get(`captcha:${otherIp}`) }, '198.51.100.1');
    assert.equal(allowed.status, 302);
});

test('captcha refresh endpoint issues a new challenge', async () => {
    const env = { DRONE_DB: createMockKV() };
    const res = await worker.fetch(new Request('https://example.com/api/captcha', { method: 'POST' }), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.match(body.svg, /^<svg/);
    assert.ok(await env.DRONE_DB.get(`captcha:${body.id}`));
    const turnstile = await worker.fetch(new Request('https://example.com/api/captcha', { method: 'POST' }), { ...env, TURNSTILE_SECRET_KEY: 's' });
    assert.equal(turnstile.status, 404);
});
