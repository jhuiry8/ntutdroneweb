// Sessions, site-wide switches and the SiteStore Durable Object (CAPTCHA,
// rate limits, CMS content lists), shared by every route module.
import { parseCookies } from './request.js';
import { SITE_SETTINGS_KEY } from './kv-keys.js';
import { orgStoreRequest } from './org-store.js';

// CAPTCHA challenges, login counters and the CMS content lists go through one
// serialized Durable Object, so concurrent requests cannot race them.
export async function siteStore(env, path, payload = {}) {
    const namespace = env.SITE_STORE;
    const stub = namespace.get(namespace.idFromName('site-security'));
    const response = await stub.fetch(`https://site-store${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const body = await response.json();
    if (response.status >= 500 || response.status === 400) throw new Error(body?.error || 'Site store failed');
    return { status: response.status, body };
}
export const captchaStore = env => (path, payload) => siteStore(env, path, payload);

// Atomically takes one attempt from every listed counter; false once any is used up.
export async function takeAttempt(env, limits) {
    return (await siteStore(env, '/limit/check', { limits, hit: true })).status === 200;
}
export async function giveBackAttempt(env, keys) {
    for (const key of keys) await siteStore(env, '/limit/release', { key });
}

export async function listUsers(env) {
    const keys = await env.DRONE_DB.list({ prefix: 'user:' });
    const users = await Promise.all(keys.keys.map(async key => {
        try { return JSON.parse(await env.DRONE_DB.get(key.name)); } catch { return null; }
    }));
    return users.filter(user => user && typeof user.username === 'string');
}

export async function verifyTurnstile(env, token, ip) {
    if (!env.TURNSTILE_SECRET_KEY) return false;
    if (!token) return false;
    const verification = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST', body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip || '' })
    });
    return verification.ok && (await verification.json()).success === true;
}

// Site-wide switches the president controls. memberLogin: whether 'member' accounts may sign in
// (members without accounts use the 學號＋姓名 meeting page instead).
export const DEFAULT_SITE_SETTINGS = { memberLogin: true };
export async function readSiteSettings(env) {
    const stored = await env.DRONE_DB.get(SITE_SETTINGS_KEY);
    try { return { ...DEFAULT_SITE_SETTINGS, ...(stored ? JSON.parse(stored) : {}) }; }
    catch { return { ...DEFAULT_SITE_SETTINGS }; }
}
export const MEMBER_LOGIN_CLOSED = '目前未開放社員帳號登入。開會時請使用主席提供的會議連結，以學號與姓名簽到。';

// Adds what the account may do: `positions` (職位), `permissions` (權限代碼) and the `role` that matches its
// main position. Without an ORG_STORE binding the user is returned as it is and its legacy role decides
// (see hasPermission in permissions.js), so deployments and tests that have no OrgStore keep working.
// A failing OrgStore throws instead of guessing: a request must never get more rights than the store says.
export async function withAccess(env, user) {
    if (!user || !env.ORG_STORE) return user;
    const { status, body } = await orgStoreRequest(env, 'resolve', { username: user.username, legacyRole: user.role });
    if (status !== 200) throw new Error('Could not resolve account permissions');
    return { ...user, role: body.role, positions: body.positions, permissions: body.permissions, realPresident: body.realPresident, actingPresident: body.acting };
}

export async function sessionUser(request, env) {
    const cookies = parseCookies(request);
    const sessionToken = cookies.session;
    if (!sessionToken) return null;

    const sessionUser = await env.DRONE_DB.get(`session:${sessionToken}`);
    if (!sessionUser) return null;
    if (sessionUser === 'admin') return await env.DRONE_DB.get('user:admin') ? null : await withAccess(env, { username: 'admin', role: 'president', active: true });
    const session = JSON.parse(sessionUser);
    const userJson = await env.DRONE_DB.get(`user:${session.username}`);
    const user = userJson ? JSON.parse(userJson) : null;
    if (!user || user.active === false || user.version !== session.version) return null;
    const resolved = await withAccess(env, user);
    if (resolved.role === 'member' && !(await readSiteSettings(env)).memberLogin) return null;
    return resolved;
}

// Helper: Check Authentication
export async function isAuthenticated(request, env) {
    return !!(await sessionUser(request, env));
}