// HTTP routes for the paper forms (表單): records, AI drafting, print pages and the
// public equipment loan slip that needs no account.
import { canViewCms, canManageUsers, canManageEquipment, constantTimeEqual } from './auth.js';
import { renderPublicLoanForm } from './templates.js';
import { createCaptcha, verifyCaptcha } from './captcha.js';
import {
    FORM_TYPES,
    LETTER_TYPES,
    MAX_FORM_RECORDS,
    MAX_PUBLIC_FORM_RECORDS,
    DEFAULT_FORM_SETTINGS,
    normalizeFormData,
    normalizePublicLoan,
    normalizeFormSettings,
    formNumberPrefix,
    taipeiToday,
    formTitle,
    renderFormPrint,
    draftOfficialLetter,
    fillFormWithAi,
    aiProvider
} from './forms.js';
import { readJsonLimited } from './request.js';
import { sessionUser, captchaStore, verifyTurnstile } from './session.js';
import { FORM_SETTINGS_KEY } from './kv-keys.js';

const AI_DAILY_LIMIT = 30;
// The shared per-account daily AI quota; AI_DAILY_LIMIT in the environment overrides the default.
export function aiDailyLimit(env) {
    const limit = Number(env?.AI_DAILY_LIMIT);
    return Number.isInteger(limit) && limit >= 1 && limit <= 1000 ? limit : AI_DAILY_LIMIT;
}

// Every signed-in account can fill in forms. Officers see everyone's forms;
// members see only their own. Only the author or the president may change one.
// Public loan slips (source 'public') have no author account; equipment managers may correct them.
function canSeeForm(user, record) { return canViewCms(user) || (Boolean(record.createdBy) && record.createdBy === user.username); }
function canChangeForm(user, record) {
    if (canManageUsers(user)) return true;
    if (record.source === 'public') return canManageEquipment(user);
    return Boolean(record.createdBy) && record.createdBy === user.username;
}
// The print token of a public slip never leaves the server except to its submitter.
function formRecordView(record) {
    const { accessToken, ...rest } = record;
    return rest;
}

const PUBLIC_LOAN_IP_DAILY_LIMIT = 5;
const PUBLIC_LOAN_DAILY_LIMIT = 200;
const PUBLIC_LOAN_PRINT_DAYS = 3;

// All form records, numbers and quotas go through one serialized Durable Object.
export async function formStore(env, path, payload = {}) {
    const namespace = env.FORM_STORE;
    const stub = namespace.get(namespace.idFromName('club-forms'));
    const response = await stub.fetch(`https://form-store${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const body = await response.json();
    if (response.status >= 500) throw new Error(body?.error || 'Form store failed');
    return { status: response.status, body };
}

// One shared daily AI quota per account, taken atomically and refunded if the AI call fails.
export async function withAiQuota(env, user, run) {
    const quota = { key: `ai:${user.username}`, limit: aiDailyLimit(env), day: taipeiToday() };
    const taken = await formStore(env, '/quota', quota);
    if (taken.status === 429) return Response.json({ error: `今日 AI 使用已達 ${quota.limit} 次上限，請明天再試` }, { status: 429 });
    try {
        return Response.json(await run());
    } catch (error) {
        await formStore(env, '/quota', { ...quota, release: true });
        throw error;
    }
}

export async function readFormSettings(env) {
    const stored = await env.DRONE_DB.get(FORM_SETTINGS_KEY);
    return { ...DEFAULT_FORM_SETTINGS, ...(stored ? JSON.parse(stored) : {}) };
}

// Returns a Response for /api/forms*, /admin/forms/*, /forms/* and /api/public/equipment-loan, or null otherwise.
export async function handleFormRequest(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // ==================== Public equipment loan slip (no login, no AI) ====================
    if (path === '/forms/equipment-loan' && method === 'GET') {
        const captcha = env.TURNSTILE_SECRET_KEY ? null : await createCaptcha(captchaStore(env));
        return new Response(renderPublicLoanForm(env.TURNSTILE_SITE_KEY, captcha), {
            headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
        });
    }

    if (path === '/api/public/equipment-loan' && method === 'POST') {
        const body = await readJsonLimited(request, 32 * 1024);
        const ip = request.headers.get('CF-Connecting-IP') || '';
        // Without Turnstile the self-hosted image CAPTCHA is required instead.
        const human = env.TURNSTILE_SECRET_KEY
            ? await verifyTurnstile(env, String(body?.turnstileToken || ''), ip)
            : await verifyCaptcha(captchaStore(env), String(body?.captchaId || ''), body?.captcha);
        if (!human) return Response.json({ error: '驗證碼錯誤或已過期，請重新輸入' }, { status: 400 });
        const day = taipeiToday();
        const data = normalizePublicLoan(body?.data, day);
        const now = new Date().toISOString();
        const accessToken = Array.from(crypto.getRandomValues(new Uint8Array(24)), value => value.toString(16).padStart(2, '0')).join('');
        // Cloudflare always sends CF-Connecting-IP; without it only the site-wide limit applies.
        const quotas = [{ key: 'public-loan:all', limit: PUBLIC_LOAN_DAILY_LIMIT }, ...(ip ? [{ key: `public-loan:ip:${ip}`, limit: PUBLIC_LOAN_IP_DAILY_LIMIT }] : [])];
        const created = await formStore(env, '/create', {
            day, quotas,
            numberPrefix: formNumberPrefix('equipment-loan', now),
            cap: { limit: MAX_PUBLIC_FORM_RECORDS, message: '外部借據已達上限，請聯絡幹部' },
            record: { id: crypto.randomUUID(), type: 'equipment-loan', source: 'public', title: formTitle('equipment-loan', data), data, createdBy: '', createdAt: now, updatedBy: '', updatedAt: now, accessToken }
        });
        if (created.status !== 201) return Response.json(created.body, { status: created.status });
        return Response.json({ number: created.body.number, printUrl: `/forms/print/${created.body.id}?token=${accessToken}`, printDays: PUBLIC_LOAN_PRINT_DAYS }, { status: 201 });
    }

    const publicPrint = /^\/forms\/print\/([\w-]{1,80})$/.exec(path);
    if (publicPrint && method === 'GET') {
        const found = await formStore(env, '/get', { id: publicPrint[1] });
        const record = found.status === 200 ? found.body : null;
        const token = url.searchParams.get('token') || '';
        const fresh = record && Date.now() - Date.parse(record.createdAt) < PUBLIC_LOAN_PRINT_DAYS * 86400000;
        if (!record || record.source !== 'public' || !record.accessToken || !fresh || !constantTimeEqual(token, record.accessToken)) {
            return new Response('借據不存在或列印連結已失效，請聯絡幹部。', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        }
        return new Response(renderFormPrint(record, await readFormSettings(env)), {
            headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' }
        });
    }

    // ==================== Paper forms (fill in online, review on paper) ====================
    if (path === '/api/forms/settings' && ['GET', 'PUT'].includes(method)) {
        const user = await sessionUser(request, env);
        if (!user) return Response.json({ error: '未授權' }, { status: 401 });
        if (method === 'GET') {
            const provider = aiProvider(env);
            return Response.json({ ...(await readFormSettings(env)), ai: provider ? { provider: provider.name, model: provider.model } : null });
        }
        if (!canManageUsers(user)) return Response.json({ error: '只有社長可以修改表單設定' }, { status: 403 });
        const settings = normalizeFormSettings(await readJsonLimited(request, 16 * 1024));
        await env.DRONE_DB.put(FORM_SETTINGS_KEY, JSON.stringify(settings));
        return Response.json(settings);
    }

    if (path === '/api/forms/ai-letter' && method === 'POST') {
        const user = await sessionUser(request, env);
        if (!user) return Response.json({ error: '未授權' }, { status: 401 });
        if (!canViewCms(user)) return Response.json({ error: '只有幹部可以使用 AI 公文產生' }, { status: 403 });
        const body = await readJsonLimited(request, 32 * 1024);
        const plainText = String(body?.text ?? '').trim();
        if (!plainText || plainText.length > 4000) return Response.json({ error: '請輸入 1 至 4000 字的白話內容' }, { status: 400 });
        const docType = LETTER_TYPES.includes(body?.docType) ? body.docType : '函';
        if (!aiProvider(env)) return Response.json({ error: '尚未設定 GROQ_API_KEY，無法使用 AI 公文產生' }, { status: 503 });
        return await withAiQuota(env, user, () => draftOfficialLetter(env, plainText, docType));
    }

    // AI turns a free-text description into form fields; the user reviews them before saving.
    if (path === '/api/forms/ai-fill' && method === 'POST') {
        const user = await sessionUser(request, env);
        if (!user) return Response.json({ error: '未授權' }, { status: 401 });
        const body = await readJsonLimited(request, 32 * 1024);
        const type = String(body?.type || '');
        if (!Object.hasOwn(FORM_TYPES, type)) return Response.json({ error: '表單類型無效' }, { status: 400 });
        if (type === 'official-letter' && !canViewCms(user)) return Response.json({ error: '只有幹部可以使用 AI 公文產生' }, { status: 403 });
        const description = String(body?.text ?? '').trim();
        if (!description || description.length > 4000) return Response.json({ error: '請輸入 1 至 4000 字的描述' }, { status: 400 });
        if (!aiProvider(env)) return Response.json({ error: '尚未設定 GROQ_API_KEY，無法使用 AI 協助填寫' }, { status: 503 });
        return await withAiQuota(env, user, () => fillFormWithAi(env, type, description));
    }

    if (path === '/api/forms' && ['GET', 'POST'].includes(method)) {
        const user = await sessionUser(request, env);
        if (!user) return Response.json({ error: '未授權' }, { status: 401 });
        if (method === 'GET') {
            const type = url.searchParams.get('type');
            const records = (await formStore(env, '/list')).body;
            const visible = records.filter(record => canSeeForm(user, record) && (!type || record.type === type));
            return Response.json(visible.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(formRecordView));
        }
        const body = await readJsonLimited(request, 64 * 1024);
        const type = String(body?.type || '');
        if (!Object.hasOwn(FORM_TYPES, type)) return Response.json({ error: '表單類型無效' }, { status: 400 });
        const data = normalizeFormData(type, body.data);
        const now = new Date().toISOString();
        const created = await formStore(env, '/create', {
            numberPrefix: formNumberPrefix(type, now),
            cap: { limit: MAX_FORM_RECORDS, message: `表單紀錄已達 ${MAX_FORM_RECORDS} 筆上限，請先刪除舊紀錄` },
            record: { id: crypto.randomUUID(), type, title: formTitle(type, data), data, createdBy: user.username, createdAt: now, updatedBy: user.username, updatedAt: now }
        });
        return Response.json(created.body, { status: created.status });
    }

    if (path.startsWith('/api/forms/') && ['GET', 'PUT', 'DELETE'].includes(method)) {
        const user = await sessionUser(request, env);
        if (!user) return Response.json({ error: '未授權' }, { status: 401 });
        const id = path.slice('/api/forms/'.length);
        const found = await formStore(env, '/get', { id });
        const record = found.status === 200 ? found.body : null;
        if (!record || !canSeeForm(user, record)) return Response.json({ error: '表單不存在' }, { status: 404 });
        if (method === 'GET') return Response.json(formRecordView(record));
        if (!canChangeForm(user, record)) return Response.json({ error: '只有填表人或社長可以修改或刪除此表單' }, { status: 403 });
        if (method === 'DELETE') {
            const deleted = await formStore(env, '/delete', { id });
            return Response.json(deleted.body, { status: deleted.status });
        }
        const body = await readJsonLimited(request, 64 * 1024);
        const data = normalizeFormData(record.type, body?.data);
        const updated = await formStore(env, '/update', { id, fields: { data, title: formTitle(record.type, data), updatedBy: user.username, updatedAt: new Date().toISOString() } });
        return Response.json(updated.status === 200 ? formRecordView(updated.body) : updated.body, { status: updated.status });
    }

    if (path.startsWith('/admin/forms/') && method === 'GET') {
        const user = await sessionUser(request, env);
        if (!user) return Response.redirect(`${url.origin}/admin`, 302);
        const settings = await readFormSettings(env);
        const htmlHeaders = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' };
        const blank = /^\/admin\/forms\/blank\/([\w-]+)$/.exec(path);
        if (blank) {
            if (!Object.hasOwn(FORM_TYPES, blank[1])) return new Response('表單類型不存在', { status: 404 });
            return new Response(renderFormPrint({ type: blank[1], data: {} }, settings), { headers: htmlHeaders });
        }
        const print = /^\/admin\/forms\/print\/([\w-]{1,80})$/.exec(path);
        if (print) {
            const found = await formStore(env, '/get', { id: print[1] });
            if (found.status !== 200 || !canSeeForm(user, found.body)) return new Response('表單不存在', { status: 404 });
            return new Response(renderFormPrint(found.body, settings), { headers: htmlHeaders });
        }
    }

    return null;
}
