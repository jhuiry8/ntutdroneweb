// NTUT Drone Club - Cloudflare Worker Entry Point (with i18n support)
import { marked } from 'marked';
import { sanitizeContent } from './html.js';
import { passwordHash, verifyPassword, PasswordResetRequiredError, validRole, canManageUsers, canEditCms, canViewCms, canManageFinance, canManageMembers, publicUser } from './auth.js';
import {
    renderLandingPage,
    renderBlogList,
    renderBlogPost,
    renderCustomPage,
    renderLogin,
    renderAdminDashboard
} from './templates.js';

// Configuration Defaults
const DEFAULT_PASS = 'admin123';
const SALT = 'ntut_drone_salt_123';

// Helper: Hashing password
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + SALT);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Helper: Parse Cookies
function parseCookies(request) {
    const list = {};
    const cookieHeader = request.headers.get('Cookie');
    if (!cookieHeader) return list;

    cookieHeader.split(';').forEach(cookie => {
        let [name, ...rest] = cookie.split('=');
        name = name.trim();
        if (!name) return;
        const value = rest.join('=').trim();
        list[name] = decodeURIComponent(value);
    });
    return list;
}

// Helper: Check Authentication
async function isAuthenticated(request, env) {
    return !!(await sessionUser(request, env));
}

const FINANCE_BUDGETS_KEY = 'finance:budgets';
const FINANCE_TRANSACTIONS_KEY = 'finance:transactions';
const MEMBERS_KEY = 'members:list';

class FinanceValidationError extends Error {}

function financeAmount(value) {
    const amount = Number(value);
    return Number.isSafeInteger(amount) && amount >= 0 && amount <= 1000000000 ? amount : null;
}

function financeText(value, field, maxLength = 100) {
    const text = String(value ?? '').trim();
    if (!text || text.length > maxLength) throw new FinanceValidationError(`${field} 為必填，且不可超過 ${maxLength} 字`);
    return text;
}

function financeDate(value) {
    const date = String(value ?? '');
    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) throw new FinanceValidationError('日期格式必須為 YYYY-MM-DD');
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.getUTCFullYear() !== Number(match[1]) || parsed.getUTCMonth() + 1 !== Number(match[2]) || parsed.getUTCDate() !== Number(match[3])) throw new FinanceValidationError('日期不存在');
    return date;
}

function parseFinanceList(json) {
    if (!json) return [];
    const list = JSON.parse(json);
    if (!Array.isArray(list)) throw new Error('財務資料格式錯誤');
    return list;
}

function importedDate(value) {
    const match = String(value ?? '').trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
    if (!match) throw new FinanceValidationError('日期格式必須為 YYYY/MM/DD 或 YYYY-MM-DD');
    return financeDate(`${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`);
}

function importAmount(value, field) {
    if (value === '' || value === null || value === undefined) return 0;
    const normalized = String(value).replace(/[,$\s]/g, '');
    const amount = Number(normalized);
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1000000000) throw new FinanceValidationError(`${field} 必須為 0 至 1,000,000,000 的整數`);
    return amount;
}

function transactionTotals(transactions) {
    const approved = transactions.filter(item => item.status === 'approved');
    const pending = transactions.filter(item => item.status === 'pending');
    const sum = (items, key) => items.reduce((total, item) => total + (item[key] || 0), 0);
    return {
        cashBalance: sum(approved, 'cashDelta'), postalBalance: sum(approved, 'postalDelta'),
        income: sum(approved, 'income'), expense: sum(approved, 'expense'),
        pendingCount: pending.length, pendingIncome: sum(pending, 'income'), pendingExpense: sum(pending, 'expense')
    };
}

async function sessionUser(request, env) {
    const cookies = parseCookies(request);
    const sessionToken = cookies.session;
    if (!sessionToken) return null;

    const sessionUser = await env.DRONE_DB.get(`session:${sessionToken}`);
    if (!sessionUser) return null;
    if (sessionUser === 'admin') return await env.DRONE_DB.get('user:admin') ? null : { username: 'admin', role: 'president', active: true };
    const session = JSON.parse(sessionUser);
    const userJson = await env.DRONE_DB.get(`user:${session.username}`);
    const user = userJson ? JSON.parse(userJson) : null;
    return user?.active !== false && user?.version === session.version ? user : null;
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        try {
            // ==================== LANGUAGE DETECTION ====================
            const cookieLang = parseCookies(request).lang;
            const queryLang = url.searchParams.get('lang');
            
            let lang = 'zh';
            if (queryLang === 'en' || queryLang === 'zh') {
                lang = queryLang;
            } else if (cookieLang === 'en' || cookieLang === 'zh') {
                lang = cookieLang;
            }
            // Always default to 'zh' for all visitors unless explicitly toggled

            // Headers helper to append language cookie if updated via query
            const getResponseHeaders = (contentType = 'text/html; charset=utf-8') => {
                const headers = { 'Content-Type': contentType };
                if (queryLang === 'en' || queryLang === 'zh') {
                    // Set language cookie (expires in 1 year)
                    headers['Set-Cookie'] = `lang=${lang}; Path=/; Max-Age=31536000; Secure; SameSite=Lax`;
                }
                return headers;
            };

            // ==================== ROUTE: Home Landing Page ====================
            if (path === '/' && method === 'GET') {
                const postsListJson = await env.DRONE_DB.get('posts_list');
                const postsList = postsListJson ? JSON.parse(postsListJson) : [];
                
                // Filter posts by language
                const filteredPosts = postsList.filter(p => (p.lang || 'zh') === lang);
                const latestPosts = filteredPosts.slice(0, 3);

                // Read homepage content override from KV
                const homepageJson = await env.DRONE_DB.get('homepage_content');
                const homepageOverride = homepageJson ? JSON.parse(homepageJson) : {};
                
                return new Response(renderLandingPage(latestPosts, lang, homepageOverride), {
                    headers: getResponseHeaders()
                });
            }

            // ==================== ROUTE: Blog List ====================
            if (path === '/blog' && method === 'GET') {
                const postsListJson = await env.DRONE_DB.get('posts_list');
                const postsList = postsListJson ? JSON.parse(postsListJson) : [];
                
                // Filter by language
                const filteredPosts = postsList.filter(p => (p.lang || 'zh') === lang);
                
                return new Response(renderBlogList(filteredPosts, lang), {
                    headers: getResponseHeaders()
                });
            }

            // ==================== ROUTE: Blog Post Detail ====================
            if (path.startsWith('/blog/') && method === 'GET') {
                const slug = path.substring(6);
                let postJson = await env.DRONE_DB.get(`post:${slug}`);
                if (!postJson) {
                    const postsListJson = await env.DRONE_DB.get('posts_list');
                    if (postsListJson) {
                        try {
                            const postsList = JSON.parse(postsListJson);
                            const found = postsList.find(p => p.slug === slug);
                            if (found) {
                                postJson = JSON.stringify({
                                    title: found.title || '',
                                    lang: found.lang || 'zh',
                                    slug: found.slug || slug,
                                    summary: found.summary || '',
                                    content: found.content || found.summary || '',
                                    date: found.date || new Date().toISOString()
                                });
                            }
                        } catch (e) {}
                    }
                }
                if (!postJson) {
                    return new Response('文章未找到 Article Not Found', { status: 404 });
                }
                const post = JSON.parse(postJson);
                
                // Set page lang from post lang if available
                const postLang = post.lang || 'zh';
                
                const contentHtml = marked.parse(post.content || '');
                return new Response(renderBlogPost(post, contentHtml, postLang), {
                    headers: getResponseHeaders()
                });
            }

            // ==================== ROUTE: Custom Dynamic Page ====================
            if (path.startsWith('/page/') && method === 'GET') {
                const slug = path.substring(6);
                const pageJson = await env.DRONE_DB.get(`page:${slug}`);
                if (!pageJson) {
                    return new Response('頁面未找到 Page Not Found', { status: 404 });
                }
                const page = JSON.parse(pageJson);
                const pageLang = page.lang || 'zh';
                const contentHtml = marked.parse(page.content || '');
                return new Response(renderCustomPage(page, contentHtml, pageLang), {
                    headers: getResponseHeaders()
                });
            }

            // ==================== ROUTE: Admin Login / Dashboard ====================
            if (path === '/admin' && method === 'GET') {
                const authed = await isAuthenticated(request, env);
                if (authed) {
                    return Response.redirect(`${url.origin}/admin/dashboard`, 302);
                }
                return new Response(renderLogin('', env.TURNSTILE_SITE_KEY), {
                    headers: { 'Content-Type': 'text/html; charset=utf-8' }
                });
            }

            if (path === '/admin/dashboard' && method === 'GET') {
                const user = await sessionUser(request, env);
                if (!user) {
                    return Response.redirect(`${url.origin}/admin`, 302);
                }

                if (!canViewCms(user)) {
                    return new Response(renderAdminDashboard([], [], publicUser(user)), {
                        headers: { 'Content-Type': 'text/html; charset=utf-8' }
                    });
                }

                const postsListJson = await env.DRONE_DB.get('posts_list');
                const postsList = postsListJson ? JSON.parse(postsListJson) : [];
                
                const pagesListJson = await env.DRONE_DB.get('pages_list');
                const pagesList = pagesListJson ? JSON.parse(pagesListJson) : [];

                return new Response(renderAdminDashboard(postsList, pagesList, publicUser(user)), {
                    headers: { 'Content-Type': 'text/html; charset=utf-8' }
                });
            }

            // Use the same server-side sanitizer for editor previews and published content.
            if (path === '/api/preview' && method === 'POST') {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                if (!canViewCms(user)) return Response.json({ error: '權限不足' }, { status: 403 });
                const { content } = await request.json();
                if (typeof content !== 'string') return Response.json({ error: '內容格式錯誤' }, { status: 400 });
                return Response.json({ html: sanitizeContent(marked.parse(content)) });
            }

            // ==================== API: Login Action ====================
            if (path === '/api/login' && method === 'POST') {
                const formData = await request.formData();
                const username = String(formData.get('username') || '').trim().toLowerCase();
                const password = String(formData.get('password') || '');
                const attemptsKey = `login-attempts:${username}:${request.headers.get('CF-Connecting-IP') || 'unknown'}`;
                const attempts = Number(await env.DRONE_DB.get(attemptsKey) || 0);
                if (attempts >= 5) return new Response(renderLogin('登入嘗試過多，請 15 分鐘後再試。', env.TURNSTILE_SITE_KEY), { status: 429, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
                if (env.TURNSTILE_SECRET_KEY) {
                    const token = String(formData.get('cf-turnstile-response') || '');
                    if (!token) return new Response(renderLogin('請完成驗證碼。', env.TURNSTILE_SITE_KEY), { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
                    const verification = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
                        method: 'POST', body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: request.headers.get('CF-Connecting-IP') || '' })
                    });
                    if (!verification.ok || !(await verification.json()).success) return new Response(renderLogin('驗證碼無效，請重試。', env.TURNSTILE_SITE_KEY), { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
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
                if (user?.active !== false && await verifyPassword(password, user?.passwordHash)) {
                    await env.DRONE_DB.delete(attemptsKey);
                    const token = crypto.randomUUID();
                    await env.DRONE_DB.put(`session:${token}`, JSON.stringify({ username: user.username, version: user.version }), { expirationTtl: 86400 });

                    return new Response('', {
                        status: 302,
                        headers: {
                            'Location': '/admin/dashboard',
                            'Set-Cookie': `session=${token}; Path=/; HttpOnly; Max-Age=86400; Secure; SameSite=Lax`
                        }
                    });
                } else {
                    await env.DRONE_DB.put(attemptsKey, String(attempts + 1), { expirationTtl: 900 });
                    return new Response(renderLogin('帳號或密碼不正確，請重新輸入！', env.TURNSTILE_SITE_KEY), {
                        headers: { 'Content-Type': 'text/html; charset=utf-8' }
                    });
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

            // ==================== API: Posts CRUD (Admin Auth required) ====================
            if (path.startsWith('/api/posts') && ['POST', 'DELETE', 'GET'].includes(method)) {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                if (method !== 'GET' ? !canEditCms(user) : !canViewCms(user)) return Response.json({ error: '權限不足' }, { status: 403 });

                if (method === 'GET') {
                    const slug = path.substring(11);
                    let postJson = await env.DRONE_DB.get(`post:${slug}`);
                    if (!postJson) {
                        const postsListJson = await env.DRONE_DB.get('posts_list');
                        if (postsListJson) {
                            try {
                                const postsList = JSON.parse(postsListJson);
                                const found = postsList.find(p => p.slug === slug);
                                if (found) {
                                    postJson = JSON.stringify({
                                        title: found.title || '',
                                        lang: found.lang || 'zh',
                                        slug: found.slug || slug,
                                        summary: found.summary || '',
                                        content: found.content || found.summary || '',
                                        date: found.date || new Date().toISOString()
                                    });
                                }
                            } catch (e) {}
                        }
                    }
                    if (!postJson) return new Response(JSON.stringify({ error: '文章不存在' }), { status: 404 });
                    return new Response(postJson, { headers: { 'Content-Type': 'application/json' } });
                }

                if (method === 'DELETE') {
                    const slug = path.substring(11);
                    await env.DRONE_DB.delete(`post:${slug}`);
                    
                    const postsListJson = await env.DRONE_DB.get('posts_list');
                    let postsList = postsListJson ? JSON.parse(postsListJson) : [];
                    postsList = postsList.filter(p => p.slug !== slug);
                    await env.DRONE_DB.put('posts_list', JSON.stringify(postsList));
                    
                    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
                }

                if (method === 'POST') {
                    const { title, lang: postLang, slug, summary, content, originalSlug } = await request.json();
                    
                    if (!title || !slug || !content) {
                        return new Response(JSON.stringify({ error: '標題、路徑與內容為必填！' }), { status: 400 });
                    }

                    if (!originalSlug) {
                        const existing = await env.DRONE_DB.get(`post:${slug}`);
                        if (existing) {
                            return new Response(JSON.stringify({ error: '該網址代稱已存在。' }), { status: 400 });
                        }
                    }

                    const postData = {
                        title,
                        lang: postLang || 'zh',
                        slug,
                        summary,
                        content,
                        date: new Date().toISOString()
                    };

                    await env.DRONE_DB.put(`post:${slug}`, JSON.stringify(postData));

                    const postsListJson = await env.DRONE_DB.get('posts_list');
                    let postsList = postsListJson ? JSON.parse(postsListJson) : [];
                    
                    if (originalSlug) {
                        postsList = postsList.filter(p => p.slug !== originalSlug);
                        if (originalSlug !== slug) {
                            await env.DRONE_DB.delete(`post:${originalSlug}`);
                        }
                    }

                    postsList.push({
                        title,
                        lang: postData.lang,
                        slug,
                        summary,
                        date: postData.date
                    });

                    postsList.sort((a, b) => new Date(b.date) - new Date(a.date));
                    await env.DRONE_DB.put('posts_list', JSON.stringify(postsList));

                    return new Response(JSON.stringify({ success: true, post: postData }), { headers: { 'Content-Type': 'application/json' } });
                }
            }

            // ==================== API: Pages CRUD (Admin Auth required) ====================
            if (path.startsWith('/api/pages') && ['POST', 'DELETE', 'GET'].includes(method)) {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                if (method !== 'GET' ? !canEditCms(user) : !canViewCms(user)) return Response.json({ error: '權限不足' }, { status: 403 });

                if (method === 'GET') {
                    const slug = path.substring(11);
                    let pageJson = await env.DRONE_DB.get(`page:${slug}`);
                    if (!pageJson) {
                        const pagesListJson = await env.DRONE_DB.get('pages_list');
                        if (pagesListJson) {
                            try {
                                const pagesList = JSON.parse(pagesListJson);
                                const found = pagesList.find(p => p.slug === slug);
                                if (found) {
                                    pageJson = JSON.stringify({
                                        title: found.title || '',
                                        lang: found.lang || 'zh',
                                        slug: found.slug || slug,
                                        content: found.content || '',
                                        date: found.date || new Date().toISOString()
                                    });
                                }
                            } catch (e) {}
                        }
                    }
                    if (!pageJson) return new Response(JSON.stringify({ error: '頁面不存在' }), { status: 404 });
                    return new Response(pageJson, { headers: { 'Content-Type': 'application/json' } });
                }

                if (method === 'DELETE') {
                    const slug = path.substring(11);
                    await env.DRONE_DB.delete(`page:${slug}`);
                    
                    const pagesListJson = await env.DRONE_DB.get('pages_list');
                    let pagesList = pagesListJson ? JSON.parse(pagesListJson) : [];
                    pagesList = pagesList.filter(p => p.slug !== slug);
                    await env.DRONE_DB.put('pages_list', JSON.stringify(pagesList));
                    
                    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
                }

                if (method === 'POST') {
                    const { title, lang: pageLang, slug, content, originalSlug } = await request.json();
                    
                    if (!title || !slug || !content) {
                        return new Response(JSON.stringify({ error: '標題、路徑與內容為必填！' }), { status: 400 });
                    }

                    if (!originalSlug) {
                        const existing = await env.DRONE_DB.get(`page:${slug}`);
                        if (existing) {
                            return new Response(JSON.stringify({ error: '該頁面路徑已存在！' }), { status: 400 });
                        }
                    }

                    const pageData = {
                        title,
                        lang: pageLang || 'zh',
                        slug,
                        content
                    };
                    await env.DRONE_DB.put(`page:${slug}`, JSON.stringify(pageData));

                    const pagesListJson = await env.DRONE_DB.get('pages_list');
                    let pagesList = pagesListJson ? JSON.parse(pagesListJson) : [];
                    
                    if (originalSlug) {
                        pagesList = pagesList.filter(p => p.slug !== originalSlug);
                        if (originalSlug !== slug) {
                            await env.DRONE_DB.delete(`page:${originalSlug}`);
                        }
                    }

                    pagesList.push({
                        title,
                        lang: pageData.lang,
                        slug
                    });
                    await env.DRONE_DB.put('pages_list', JSON.stringify(pagesList));

                    return new Response(JSON.stringify({ success: true, page: pageData }), { headers: { 'Content-Type': 'application/json' } });
                }
            }

            // ==================== API: Change Password ====================
            if (path === '/api/change-password' && method === 'POST') {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                const { oldPassword, newPassword } = await request.json();
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
                    const keys = await env.DRONE_DB.list({ prefix: 'user:' });
                    const users = await Promise.all(keys.keys.map(async key => JSON.parse(await env.DRONE_DB.get(key.name))));
                    return Response.json(users.map(publicUser));
                }
                const body = await request.json();
                const username = String(body.username || '').trim().toLowerCase();
                if (!/^[a-z0-9._-]{3,40}$/.test(username)) return Response.json({ error: '帳號須為 3–40 位英數字、點、底線或連字號' }, { status: 400 });
                if (method === 'POST') {
                    if (!validRole(body.role) || typeof body.password !== 'string' || body.password.length < 8) return Response.json({ error: '角色無效或密碼少於 8 字元' }, { status: 400 });
                    if (await env.DRONE_DB.get(`user:${username}`)) return Response.json({ error: '帳號已存在' }, { status: 409 });
                    const user = { username, role: body.role, active: true, passwordHash: await passwordHash(body.password), version: crypto.randomUUID(), createdAt: new Date().toISOString() };
                    await env.DRONE_DB.put(`user:${username}`, JSON.stringify(user));
                    return Response.json(publicUser(user), { status: 201 });
                }
                const existing = await env.DRONE_DB.get(`user:${username}`);
                if (!existing) return Response.json({ error: '帳號不存在' }, { status: 404 });
                const user = JSON.parse(existing);
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

            // ==================== API: Finance ledger, budget, import, and review ====================
            if (path === '/api/finance/summary' && method === 'GET') {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                if (!canManageFinance(user)) return Response.json({ error: '權限不足' }, { status: 403 });
                const transactions = parseFinanceList(await env.DRONE_DB.get(FINANCE_TRANSACTIONS_KEY));
                const budgets = parseFinanceList(await env.DRONE_DB.get(FINANCE_BUDGETS_KEY));
                const approved = transactions.filter(item => item.status === 'approved');
                const spentByCategory = Object.fromEntries(budgets.map(item => [item.id, 0]));
                for (const item of approved) if (item.kind === 'expense' && item.budgetId && spentByCategory[item.budgetId] !== undefined) spentByCategory[item.budgetId] += item.expense;
                return Response.json({
                    transactions: transactions.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
                    budgets: budgets.map(item => ({ ...item, spent: spentByCategory[item.id] || 0 })),
                    totals: transactionTotals(transactions)
                });
            }

            if (path === '/api/finance/transactions' && method === 'POST') {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                if (!canManageFinance(user)) return Response.json({ error: '權限不足' }, { status: 403 });
                const body = await request.json();
                const kind = String(body.kind || '');
                if (!['income', 'expense', 'transfer'].includes(kind)) return Response.json({ error: '收支類型無效' }, { status: 400 });
                const amount = financeAmount(body.amount);
                if (!amount) return Response.json({ error: '金額必須為 1 至 1,000,000,000 的整數' }, { status: 400 });
                const account = String(body.account || 'cash');
                if (!['cash', 'postal'].includes(account)) return Response.json({ error: '帳戶無效' }, { status: 400 });
                const item = financeText(body.item, '事由', 120);
                const date = financeDate(body.date);
                const transaction = {
                    id: crypto.randomUUID(), date, item, kind, amount,
                    income: kind === 'income' ? amount : 0, expense: kind === 'expense' ? amount : 0,
                    cashDelta: kind === 'transfer' ? (account === 'cash' ? -amount : amount) : (account === 'cash' ? (kind === 'income' ? amount : -amount) : 0),
                    postalDelta: kind === 'transfer' ? (account === 'cash' ? amount : -amount) : (account === 'postal' ? (kind === 'income' ? amount : -amount) : 0),
                    budgetId: typeof body.budgetId === 'string' ? body.budgetId : '', status: 'pending',
                    createdBy: user.username, createdAt: new Date().toISOString(), source: 'manual'
                };
                const transactions = parseFinanceList(await env.DRONE_DB.get(FINANCE_TRANSACTIONS_KEY));
                transactions.push(transaction);
                await env.DRONE_DB.put(FINANCE_TRANSACTIONS_KEY, JSON.stringify(transactions));
                return Response.json(transaction, { status: 201 });
            }

            if (path.startsWith('/api/finance/transactions/') && path.endsWith('/review') && method === 'PATCH') {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                if (!canManageUsers(user)) return Response.json({ error: '僅社長可審核收支' }, { status: 403 });
                const id = path.slice('/api/finance/transactions/'.length, -'/review'.length);
                const body = await request.json();
                const status = body.status === 'approved' || body.status === 'rejected' ? body.status : null;
                if (!status) return Response.json({ error: '審核結果無效' }, { status: 400 });
                const transactions = parseFinanceList(await env.DRONE_DB.get(FINANCE_TRANSACTIONS_KEY));
                const transaction = transactions.find(item => item.id === id);
                if (!transaction) return Response.json({ error: '帳目不存在' }, { status: 404 });
                if (transaction.status !== 'pending') return Response.json({ error: '此帳目已完成審核' }, { status: 409 });
                transaction.status = status;
                transaction.reviewedBy = user.username;
                transaction.reviewedAt = new Date().toISOString();
                transaction.reviewNote = status === 'rejected' ? financeText(body.note, '退回原因', 200) : '';
                await env.DRONE_DB.put(FINANCE_TRANSACTIONS_KEY, JSON.stringify(transactions));
                return Response.json(transaction);
            }

            if (path === '/api/finance/budgets' && ['GET', 'PUT'].includes(method)) {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                if (!canManageFinance(user)) return Response.json({ error: '權限不足' }, { status: 403 });
                if (method === 'GET') return Response.json(parseFinanceList(await env.DRONE_DB.get(FINANCE_BUDGETS_KEY)));
                const { budgets } = await request.json();
                if (!Array.isArray(budgets) || budgets.length > 100) return Response.json({ error: '預算最多 100 個分類' }, { status: 400 });
                const names = new Set();
                const normalized = budgets.map(item => {
                    const name = financeText(item.name, '分類名稱', 60);
                    if (names.has(name)) throw new FinanceValidationError('預算分類不可重複');
                    names.add(name);
                    const planned = financeAmount(item.planned);
                    if (planned === null) throw new FinanceValidationError('預算金額無效');
                    return { id: typeof item.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(item.id) ? item.id : crypto.randomUUID(), name, planned };
                });
                await env.DRONE_DB.put(FINANCE_BUDGETS_KEY, JSON.stringify(normalized));
                return Response.json(normalized);
            }

            if (path === '/api/finance/import' && method === 'POST') {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                if (!canManageFinance(user)) return Response.json({ error: '權限不足' }, { status: 403 });
                const { rows } = await request.json();
                if (!Array.isArray(rows) || rows.length < 1 || rows.length > 1000) return Response.json({ error: '匯入資料需介於 1 至 1,000 筆' }, { status: 400 });
                let previousCash = 0, previousPostal = 0;
                const imported = rows.map((row, index) => {
                    const date = importedDate(row.date);
                    const item = financeText(row.item, `第 ${index + 1} 列事宜`, 120);
                    const income = importAmount(row.income, `第 ${index + 1} 列收入`);
                    const expense = importAmount(row.expense, `第 ${index + 1} 列支出`);
                    if (income && expense) throw new FinanceValidationError(`第 ${index + 1} 列不可同時填寫收入與支出`);
                    const cashBalance = importAmount(row.cashBalance, `第 ${index + 1} 列現金餘額`);
                    const postalBalance = importAmount(row.postalBalance, `第 ${index + 1} 列郵局餘額`);
                    const cashDelta = cashBalance - previousCash;
                    const postalDelta = postalBalance - previousPostal;
                    previousCash = cashBalance; previousPostal = postalBalance;
                    return { id: crypto.randomUUID(), date, item, kind: income ? 'income' : expense ? 'expense' : 'transfer', amount: income || expense || Math.abs(cashDelta) || Math.abs(postalDelta), income, expense, cashDelta, postalDelta, budgetId: '', status: 'pending', createdBy: user.username, createdAt: new Date().toISOString(), source: 'legacy-spreadsheet' };
                });
                const transactions = parseFinanceList(await env.DRONE_DB.get(FINANCE_TRANSACTIONS_KEY));
                await env.DRONE_DB.put(FINANCE_TRANSACTIONS_KEY, JSON.stringify([...transactions, ...imported]));
                return Response.json({ imported: imported.length, transactions: imported }, { status: 201 });
            }

            // ==================== API: Member directory ====================
            if (path === '/api/members' && ['GET', 'POST'].includes(method)) {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                if (!canManageMembers(user)) return Response.json({ error: '權限不足' }, { status: 403 });
                const members = parseFinanceList(await env.DRONE_DB.get(MEMBERS_KEY));
                if (method === 'GET') {
                    const query = String(url.searchParams.get('q') || '').trim().toLowerCase();
                    return Response.json(query ? members.filter(member => [member.name, member.studentId, member.email, member.phone].some(value => String(value || '').toLowerCase().includes(query))) : members);
                }
                const body = await request.json();
                const studentId = String(body.studentId || '').trim();
                if (studentId && (studentId.length > 30 || members.some(member => member.studentId === studentId))) return Response.json({ error: '學號已存在或格式錯誤' }, { status: 409 });
                const member = { id: crypto.randomUUID(), name: financeText(body.name, '姓名', 50), studentId, email: String(body.email || '').trim().slice(0, 100), phone: String(body.phone || '').trim().slice(0, 30), joinedAt: financeDate(body.joinedAt || new Date().toISOString().slice(0, 10)), createdAt: new Date().toISOString() };
                members.push(member);
                await env.DRONE_DB.put(MEMBERS_KEY, JSON.stringify(members));
                return Response.json(member, { status: 201 });
            }

            if (path.startsWith('/api/members/') && method === 'DELETE') {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                if (!canManageMembers(user)) return Response.json({ error: '權限不足' }, { status: 403 });
                const id = path.slice('/api/members/'.length);
                const members = parseFinanceList(await env.DRONE_DB.get(MEMBERS_KEY));
                if (!members.some(member => member.id === id)) return Response.json({ error: '社員不存在' }, { status: 404 });
                await env.DRONE_DB.put(MEMBERS_KEY, JSON.stringify(members.filter(member => member.id !== id)));
                return Response.json({ success: true });
            }

            // ==================== API: Upload Image to GitHub ====================
            if (path === '/api/upload' && method === 'POST') {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                if (!canEditCms(user)) return Response.json({ error: '權限不足' }, { status: 403 });

                if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
                    return new Response(JSON.stringify({ error: 'Worker 尚未設定 GITHUB_TOKEN 或 GITHUB_REPO 變數！' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
                }

                const formData = await request.formData();
                const file = formData.get('image');

                if (!file || typeof file === 'string') {
                    return new Response(JSON.stringify({ error: '無效的圖片檔案' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
                }

                const arrayBuffer = await file.arrayBuffer();
                const base64Content = btoa(
                    new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
                );

                const extension = file.name.split('.').pop();
                const timestamp = Date.now();
                const filename = `upload_${timestamp}.${extension}`;
                const commitPath = `public/assets/uploads/${filename}`;

                const githubUrl = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${commitPath}`;
                const commitBody = {
                    message: `Upload image: ${filename} via CMS Admin`,
                    content: base64Content,
                    branch: 'main'
                };

                const githubResponse = await fetch(githubUrl, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `token ${env.GITHUB_TOKEN}`,
                        'Accept': 'application/vnd.github.v3+json',
                        'User-Agent': 'Cloudflare-Worker-CMS'
                    },
                    body: JSON.stringify(commitBody)
                });

                if (!githubResponse.ok) {
                    const errText = await githubResponse.text();
                    return new Response(JSON.stringify({ error: `GitHub API 錯誤: ${errText}` }), { status: 500, headers: { 'Content-Type': 'application/json' } });
                }

                const publicUrl = `/assets/uploads/${filename}`;

                return new Response(JSON.stringify({
                    success: true,
                    filename,
                    url: publicUrl
                }), { headers: { 'Content-Type': 'application/json' } });
            }

            // ==================== API: Get Homepage Content ====================
            if (path === '/api/homepage' && method === 'GET') {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                if (!canViewCms(user)) return Response.json({ error: '權限不足' }, { status: 403 });
                const data = await env.DRONE_DB.get('homepage_content');
                return new Response(data || '{}', { headers: { 'Content-Type': 'application/json' } });
            }

            // ==================== API: Save Homepage Content ====================
            if (path === '/api/homepage' && method === 'POST') {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                if (!canEditCms(user)) return Response.json({ error: '權限不足' }, { status: 403 });
                const body = await request.json();
                // Whitelist allowed keys for full homepage customization
                const allowed = [
                    'heroTitle', 'heroDesc', 'heroBadge',
                    'aboutTitle', 'aboutSubtitle',
                    'aboutCard1Title', 'aboutCard1Desc',
                    'aboutCard2Title', 'aboutCard2Desc',
                    'aboutCard3Title', 'aboutCard3Desc',
                    'featuresTitle', 'featuresSubtitle',
                    'feat1Title', 'feat1Desc',
                    'feat2Title', 'feat2Desc',
                    'feat3Title', 'feat3Desc',
                    'feat4Title', 'feat4Desc',
                    'ctaTitle', 'ctaDesc',
                    'lineLink', 'igLink', 'emailLink',
                    'igCard1Tag', 'igCard1Caption', 'igCard1Img', 'igCard1Likes', 'igCard1Comments',
                    'igCard2Tag', 'igCard2Caption', 'igCard2Img', 'igCard2Likes', 'igCard2Comments',
                    'igCard3Tag', 'igCard3Caption', 'igCard3Img', 'igCard3Likes', 'igCard3Comments',
                    'igCard4Tag', 'igCard4Caption', 'igCard4Img', 'igCard4Likes', 'igCard4Comments'
                ];
                const filtered = {};
                allowed.forEach(k => { if (body[k] !== undefined) filtered[k] = String(body[k]); });
                await env.DRONE_DB.put('homepage_content', JSON.stringify(filtered));
                return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
            }

            return new Response('Not Found', { status: 404 });

        } catch (e) {
            if (e instanceof FinanceValidationError) return Response.json({ error: e.message }, { status: 400 });
            if (e instanceof PasswordResetRequiredError) {
                if (path === '/api/login') {
                    return new Response(renderLogin(e.message, env.TURNSTILE_SITE_KEY), {
                        status: 409, headers: { 'Content-Type': 'text/html; charset=utf-8' }
                    });
                }
                return Response.json({ error: e.message }, { status: 409 });
            }
            return new Response(`伺服器內部錯誤 Internal Server Error: ${e.message}`, { status: 500 });
        }
    }
};
