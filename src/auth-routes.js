// HTTP routes for signing in and out, accounts (帳號管理), the caller's own account
// and the site-wide switches only the president changes.
import { membershipStatus } from './membership.js';
import { passwordHash, verifyPassword, validRole, canManageUsers, publicUser } from './auth.js';
import { renderLogin } from './templates.js';
import { createCaptcha, verifyCaptcha } from './captcha.js';
import { parseCookies, readJsonObject } from './request.js';
import { siteStore, captchaStore, takeAttempt, giveBackAttempt, readSiteSettings, MEMBER_LOGIN_CLOSED, sessionUser, listUsers, verifyTurnstile } from './session.js';
import { parseStoredList } from './validation.js';
import { MEMBERS_KEY, MEMBERSHIP_RECEIPTS_KEY, SITE_SETTINGS_KEY } from './kv-keys.js';

// Legacy unsalted admin hash format (migrated to PBKDF2 on first login)
const SALT = 'ntut_drone_salt_123';

// Helper: Hashing password
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + SALT);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const LOGIN_MAX_ATTEMPTS_PER_ACCOUNT = 5;
const LOGIN_MAX_ATTEMPTS_PER_IP = 20;
const LOGIN_LOCKOUT_SECONDS = 900;
const CAPTCHA_MAX_PER_IP = 60;
// Normal sessions last a day; "保持登入" (desktop program) lasts 30 days, then the person signs in again.
const SESSION_SECONDS = 86400;
const DESKTOP_USER_AGENT_PREFIX = 'NTUTDroneClubDesk';
export const REMEMBER_SESSION_SECONDS = 30 * 86400;

// Helper: Render the login page. When Cloudflare Turnstile is not configured,
// a self-hosted image CAPTCHA is attached so every login attempt needs one.
export async function loginPageResponse(env, message = '', status = 200) {
    const captcha = env.TURNSTILE_SECRET_KEY ? null : await createCaptcha(captchaStore(env));
    return new Response(renderLogin(message, env.TURNSTILE_SITE_KEY, captcha), {
        status,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
    });
}

// Verified against when the account does not exist, so a login for an unknown
// username takes as long as one for a real account.
let dummyPasswordHash = null;
async function dummyHash() {
    dummyPasswordHash ??= await passwordHash(crypto.randomUUID());
    return dummyPasswordHash;
}

// Returns a Response for the login, account and site-settings routes, or null for any other path.
export async function handleAuthRequest(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // ==================== API: Login Action ====================
    if (path === '/api/captcha' && method === 'POST') {
        if (env.TURNSTILE_SECRET_KEY) return Response.json({ error: '未啟用' }, { status: 404 });
        const genKey = `captcha-gen:${request.headers.get('CF-Connecting-IP') || 'unknown'}`;
        if (!(await takeAttempt(env, [{ key: genKey, max: CAPTCHA_MAX_PER_IP, windowSeconds: LOGIN_LOCKOUT_SECONDS }]))) {
            return Response.json({ error: '請求過於頻繁，請稍後再試' }, { status: 429 });
        }
        return Response.json(await createCaptcha(captchaStore(env)), { headers: { 'Cache-Control': 'no-store' } });
    }

    if (path === '/api/login' && method === 'POST') {
        const formData = await request.formData();
        const username = String(formData.get('username') || '').trim().toLowerCase();
        const password = String(formData.get('password') || '');
        const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
        const attemptsKey = `login-attempts:${username.slice(0, 100)}:${clientIp}`;
        const ipAttemptsKey = `login-attempts-ip:${clientIp}`;
        // Every attempt is counted atomically before anything is checked, so
        // parallel requests cannot all slip in under the limit.
        if (!(await takeAttempt(env, [
            { key: attemptsKey, max: LOGIN_MAX_ATTEMPTS_PER_ACCOUNT, windowSeconds: LOGIN_LOCKOUT_SECONDS },
            { key: ipAttemptsKey, max: LOGIN_MAX_ATTEMPTS_PER_IP, windowSeconds: LOGIN_LOCKOUT_SECONDS }
        ]))) {
            return loginPageResponse(env, '登入嘗試過多，請 15 分鐘後再試。', 429);
        }
        if (env.TURNSTILE_SECRET_KEY) {
            const token = String(formData.get('cf-turnstile-response') || '');
            if (!token) {
                await giveBackAttempt(env, [attemptsKey, ipAttemptsKey]);
                return loginPageResponse(env, '請完成驗證碼。', 400);
            }
            if (!(await verifyTurnstile(env, token, clientIp === 'unknown' ? '' : clientIp))) {
                await giveBackAttempt(env, [attemptsKey]);
                return loginPageResponse(env, '驗證碼無效，請重試。', 400);
            }
        } else if (!(await verifyCaptcha(captchaStore(env), String(formData.get('captcha_id') || ''), formData.get('captcha')))) {
            // A wrong CAPTCHA still counts against the IP, not against the account.
            await giveBackAttempt(env, [attemptsKey]);
            return loginPageResponse(env, '驗證碼錯誤或已過期，請重新輸入。', 400);
        }
        let userJson = await env.DRONE_DB.get(`user:${username}`);
        let user = userJson ? JSON.parse(userJson) : null;
        if (username === 'admin' && !user) {
            const legacyHash = await env.DRONE_DB.get('admin_password_hash');
            const initialPassword = env.ADMIN_INITIAL_PASSWORD;
            if ((legacyHash && await hashPassword(password) === legacyHash) || (!legacyHash && initialPassword?.length >= 8 && password === initialPassword)) {
                user = { username: 'admin', role: 'president', active: true, passwordHash: await passwordHash(password), version: crypto.randomUUID(), createdAt: new Date().toISOString() };
                await env.DRONE_DB.put('user:admin', JSON.stringify(user));
                await env.DRONE_DB.delete('admin_password_hash');
            }
        }
        // Always run one PBKDF2 derivation so unknown usernames are not faster.
        const passwordOk = await verifyPassword(password, user ? user.passwordHash : await dummyHash());
        if (user && user.active !== false && passwordOk && user.role === 'member' && !(await readSiteSettings(env)).memberLogin) {
            await giveBackAttempt(env, [attemptsKey, ipAttemptsKey]);
            return loginPageResponse(env, MEMBER_LOGIN_CLOSED, 403);
        }
        if (user && user.active !== false && passwordOk) {
            await siteStore(env, '/limit/clear', { key: attemptsKey });
            await giveBackAttempt(env, [ipAttemptsKey]);
            const token = crypto.randomUUID();
            // The desktop program asks for the long session; web form logins get one day. The User-Agent is
            // client-supplied, so this is a best-effort limit, not a security boundary: it is no stronger than the password.
            const wantsRemember = ['1', 'true', 'on'].includes(String(formData.get('remember') || ''))
                && (request.headers.get('User-Agent') || '').startsWith(DESKTOP_USER_AGENT_PREFIX);
            const sessionSeconds = wantsRemember ? REMEMBER_SESSION_SECONDS : SESSION_SECONDS;
            await env.DRONE_DB.put(`session:${token}`, JSON.stringify({ username: user.username, version: user.version }), { expirationTtl: sessionSeconds });

            return new Response('', {
                status: 302,
                headers: {
                    'Location': '/admin/dashboard',
                    'Set-Cookie': `session=${token}; Path=/; HttpOnly; Max-Age=${sessionSeconds}; Secure; SameSite=Lax`
                }
            });
        } else {
            return loginPageResponse(env, '帳號或密碼不正確，請重新輸入！');
        }
    }

    // ==================== API: Logout Action ====================
    if (path === '/api/logout' && method === 'POST') {
        const cookies = parseCookies(request);
        const sessionToken = cookies.session;
        if (sessionToken) {
            await env.DRONE_DB.delete(`session:${sessionToken}`);
        }
        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Set-Cookie': 'session=; Path=/; HttpOnly; Max-Age=0; Secure; SameSite=Lax'
            }
        });
    }

    // ==================== API: Site settings (president) ====================
    if (path === '/api/site-settings' && ['GET', 'PUT'].includes(method)) {
        const user = await sessionUser(request, env);
        if (!user) return Response.json({ error: '未授權' }, { status: 401 });
        if (method === 'GET') return Response.json(await readSiteSettings(env));
        if (!canManageUsers(user)) return Response.json({ error: '只有社長可以修改網站設定' }, { status: 403 });
        const body = await readJsonObject(request);
        const settings = await readSiteSettings(env);
        if (typeof body.memberLogin === 'boolean') settings.memberLogin = body.memberLogin;
        await env.DRONE_DB.put(SITE_SETTINGS_KEY, JSON.stringify(settings));
        return Response.json(settings);
    }

    // ==================== API: Change Password ====================
    if (path === '/api/change-password' && method === 'POST') {
        const user = await sessionUser(request, env);
        if (!user) return Response.json({ error: '未授權' }, { status: 401 });
        const { oldPassword, newPassword } = await readJsonObject(request);
        if (!await verifyPassword(oldPassword, user.passwordHash)) {
            return new Response(JSON.stringify({ error: '舊密碼輸入錯誤！' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        if (typeof newPassword !== 'string' || newPassword.length < 8) return Response.json({ error: '新密碼至少需要 8 個字元' }, { status: 400 });
        user.passwordHash = await passwordHash(newPassword);
        user.version = crypto.randomUUID();
        await env.DRONE_DB.put(`user:${user.username}`, JSON.stringify(user));

        return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (path === '/api/users' && ['GET', 'POST', 'PATCH'].includes(method)) {
        const actor = await sessionUser(request, env);
        if (!actor) return Response.json({ error: '未授權' }, { status: 401 });
        if (!canManageUsers(actor)) return Response.json({ error: '權限不足' }, { status: 403 });
        if (method === 'GET') {
            const users = await listUsers(env);
            const members = new Map(parseStoredList(await env.DRONE_DB.get(MEMBERS_KEY)).map(member => [member.id, member]));
            return Response.json(users.map(item => {
                const member = item.memberId ? members.get(item.memberId) : null;
                return { ...publicUser(item), member: member ? { id: member.id, name: member.name, studentId: member.studentId, status: membershipStatus(member) } : null };
            }));
        }
        const body = await readJsonObject(request);
        const username = String(body.username || '').trim().toLowerCase();
        if (!/^[a-z0-9._-]{3,40}$/.test(username)) return Response.json({ error: '帳號須為 3–40 位英數字、點、底線或連字號' }, { status: 400 });
        // Binding an account to a roster entry (帳號與社員綁定). One roster entry per account.
        let memberId;
        if (body.memberId !== undefined) {
            memberId = typeof body.memberId === 'string' ? body.memberId : '';
            if (memberId) {
                const members = parseStoredList(await env.DRONE_DB.get(MEMBERS_KEY));
                if (!members.some(member => member.id === memberId)) return Response.json({ error: '社員不存在' }, { status: 404 });
                const owner = (await listUsers(env)).find(item => item.memberId === memberId && item.username !== username);
                if (owner) return Response.json({ error: `此社員已綁定帳號 ${owner.username}` }, { status: 409 });
            }
        }
        if (method === 'POST') {
            if (!validRole(body.role) || typeof body.password !== 'string' || body.password.length < 8) return Response.json({ error: '角色無效或密碼少於 8 字元' }, { status: 400 });
            if (await env.DRONE_DB.get(`user:${username}`)) return Response.json({ error: '帳號已存在' }, { status: 409 });
            const user = { username, role: body.role, active: true, passwordHash: await passwordHash(body.password), version: crypto.randomUUID(), createdAt: new Date().toISOString(), ...(memberId ? { memberId } : {}) };
            await env.DRONE_DB.put(`user:${username}`, JSON.stringify(user));
            return Response.json(publicUser(user), { status: 201 });
        }
        const existing = await env.DRONE_DB.get(`user:${username}`);
        if (!existing) return Response.json({ error: '帳號不存在' }, { status: 404 });
        const user = JSON.parse(existing);
        // Changing only the binding does not sign the person out.
        const onlyBinding = memberId !== undefined && body.role === undefined && body.active === undefined && body.password === undefined;
        if (memberId !== undefined) {
            if (memberId) user.memberId = memberId; else delete user.memberId;
        }
        if (onlyBinding) {
            await env.DRONE_DB.put(`user:${username}`, JSON.stringify(user));
            return Response.json(publicUser(user));
        }
        if (body.role !== undefined) {
            if (!validRole(body.role)) return Response.json({ error: '角色無效' }, { status: 400 });
            user.role = body.role;
        }
        if (body.active !== undefined) user.active = body.active === true;
        if (body.password !== undefined) {
            if (typeof body.password !== 'string' || body.password.length < 8) return Response.json({ error: '密碼至少需要 8 個字元' }, { status: 400 });
            user.passwordHash = await passwordHash(body.password);
        }
        if (username === 'admin' && (user.role !== 'president' || !user.active)) return Response.json({ error: '不可停用或降權主要管理員' }, { status: 400 });
        if (username === actor.username && !user.active) return Response.json({ error: '不可停用自己' }, { status: 400 });
        user.version = crypto.randomUUID();
        await env.DRONE_DB.put(`user:${username}`, JSON.stringify(user));
        return Response.json(publicUser(user));
    }

    // ==================== API: Own account and bound member record ====================
    if (path === '/api/me' && method === 'GET') {
        const user = await sessionUser(request, env);
        if (!user) return Response.json({ error: '未授權' }, { status: 401 });
        const member = user.memberId ? parseStoredList(await env.DRONE_DB.get(MEMBERS_KEY)).find(item => item.id === user.memberId) : null;
        const receipts = member ? parseStoredList(await env.DRONE_DB.get(MEMBERSHIP_RECEIPTS_KEY)).filter(item => item.memberId === member.id)
            .sort((a, b) => b.date.localeCompare(a.date)).map(({ date, amount, feeType, semester, receiptNumber }) => ({ date, amount, feeType, semester, receiptNumber })) : [];
        return Response.json({
            ...publicUser(user),
            member: member ? { name: member.name, studentId: member.studentId, email: member.email, phone: member.phone, position: member.position, joinedAt: member.joinedAt, feeSemester: member.feeSemester || '', status: membershipStatus(member) } : null,
            feeReceipts: receipts
        });
    }

    return null;
}
