// HTTP routes for the website content managed in the dashboard: posts, pages,
// the homepage text, the Markdown preview and club class notes (社課備忘).
import { marked } from 'marked';
import { sanitizeContent } from './html.js';
import { canEditCms, canViewCms, hasPermission, hasAnyPermission } from './auth.js';
import { pushNewPost } from './message-routes.js';
import { CONTENT_JSON_LIMIT, readJsonObject } from './request.js';
import { siteStore, sessionUser } from './session.js';
import { ValidationError, SLUG_PATTERN, financeText, financeDate, parseStoredList } from './validation.js';
import { NOTES_KEY } from './kv-keys.js';

// Returns a Response for /api/posts*, /api/pages*, /api/homepage, /api/preview and /api/notes*, or null otherwise.
export async function handleCmsRequest(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Use the same server-side sanitizer for editor previews and published content.
    if (path === '/api/preview' && method === 'POST') {
        const user = await sessionUser(request, env);
        if (!user) return Response.json({ error: '未授權' }, { status: 401 });
        if (!canViewCms(user)) return Response.json({ error: '權限不足' }, { status: 403 });
        const { content } = await readJsonObject(request, CONTENT_JSON_LIMIT);
        if (typeof content !== 'string') return Response.json({ error: '內容格式錯誤' }, { status: 400 });
        return Response.json({ html: sanitizeContent(marked.parse(content)) });
    }

    // ==================== API: Posts CRUD (Admin Auth required) ====================
    if (path.startsWith('/api/posts') && ['POST', 'DELETE', 'GET'].includes(method)) {
        const user = await sessionUser(request, env);
        if (!user) return Response.json({ error: '未授權' }, { status: 401 });
        if (method !== 'GET' ? !canEditCms(user) : !canViewCms(user)) return Response.json({ error: '權限不足' }, { status: 403 });

        if (method === 'GET') {
            const slug = path.substring(11);
            // GET /api/posts lists every post (the desktop program's 文章管理).
            if (!slug) return Response.json(JSON.parse((await env.DRONE_DB.get('posts_list')) || '[]'));
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
            await siteStore(env, '/content-index', { list: 'posts_list', remove: [slug] });
            
            return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
        }

        if (method === 'POST') {
            const { title, lang: postLang, slug, summary, content, originalSlug } = await readJsonObject(request, CONTENT_JSON_LIMIT);
            
            if (!title || !slug || !content) {
                return new Response(JSON.stringify({ error: '標題、路徑與內容為必填！' }), { status: 400 });
            }
            if (typeof title !== 'string' || typeof content !== 'string' || (summary !== undefined && typeof summary !== 'string') || typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) {
                return Response.json({ error: '網址代稱只能使用英文字母、數字、底線或連字號（最多 100 字），且需以英數字開頭' }, { status: 400 });
            }
            if (originalSlug !== undefined && originalSlug !== null && typeof originalSlug !== 'string') return Response.json({ error: '原網址代稱格式錯誤' }, { status: 400 });

            if (!originalSlug || originalSlug !== slug) {
                const existing = await env.DRONE_DB.get(`post:${slug}`);
                if (existing) {
                    return new Response(JSON.stringify({ error: '該網址代稱已存在。' }), { status: 400 });
                }
            }

            const postData = {
                title,
                lang: postLang === 'en' ? 'en' : 'zh',
                slug,
                summary,
                content,
                date: new Date().toISOString()
            };

            await env.DRONE_DB.put(`post:${slug}`, JSON.stringify(postData));
            if (originalSlug && originalSlug !== slug) await env.DRONE_DB.delete(`post:${originalSlug}`);
            await siteStore(env, '/content-index', {
                list: 'posts_list',
                remove: originalSlug ? [originalSlug] : [],
                add: { title, lang: postData.lang, slug, summary, date: postData.date },
                sortByDate: true
            });

            // Optional external push (社團通訊 → 外部推播) for brand-new posts.
            const push = originalSlug ? [] : await pushNewPost(env, url.origin, postData);
            return new Response(JSON.stringify({ success: true, post: postData, push }), { headers: { 'Content-Type': 'application/json' } });
        }
    }

    // ==================== API: Pages CRUD (Admin Auth required) ====================
    if (path.startsWith('/api/pages') && ['POST', 'DELETE', 'GET'].includes(method)) {
        const user = await sessionUser(request, env);
        if (!user) return Response.json({ error: '未授權' }, { status: 401 });
        if (method !== 'GET' ? !canEditCms(user) : !canViewCms(user)) return Response.json({ error: '權限不足' }, { status: 403 });

        if (method === 'GET') {
            const slug = path.substring(11);
            if (!slug) return Response.json(JSON.parse((await env.DRONE_DB.get('pages_list')) || '[]'));
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
            await siteStore(env, '/content-index', { list: 'pages_list', remove: [slug] });
            
            return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
        }

        if (method === 'POST') {
            const { title, lang: pageLang, slug, content, originalSlug } = await readJsonObject(request, CONTENT_JSON_LIMIT);
            
            if (!title || !slug || !content) {
                return new Response(JSON.stringify({ error: '標題、路徑與內容為必填！' }), { status: 400 });
            }
            if (typeof title !== 'string' || typeof content !== 'string' || typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) {
                return Response.json({ error: '頁面路徑只能使用英文字母、數字、底線或連字號（最多 100 字），且需以英數字開頭' }, { status: 400 });
            }
            if (originalSlug !== undefined && originalSlug !== null && typeof originalSlug !== 'string') return Response.json({ error: '原頁面路徑格式錯誤' }, { status: 400 });

            if (!originalSlug || originalSlug !== slug) {
                const existing = await env.DRONE_DB.get(`page:${slug}`);
                if (existing) {
                    return new Response(JSON.stringify({ error: '該頁面路徑已存在！' }), { status: 400 });
                }
            }

            const pageData = {
                title,
                lang: pageLang === 'en' ? 'en' : 'zh',
                slug,
                content
            };
            await env.DRONE_DB.put(`page:${slug}`, JSON.stringify(pageData));
            if (originalSlug && originalSlug !== slug) await env.DRONE_DB.delete(`page:${originalSlug}`);
            await siteStore(env, '/content-index', {
                list: 'pages_list',
                remove: originalSlug ? [originalSlug] : [],
                add: { title, lang: pageData.lang, slug }
            });

            return new Response(JSON.stringify({ success: true, page: pageData }), { headers: { 'Content-Type': 'application/json' } });
        }
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
        const body = await readJsonObject(request);
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

    // ==================== API: Club class notes ====================
    if (path === '/api/notes' && ['GET', 'POST'].includes(method)) {
        const user = await sessionUser(request, env);
        if (!user) return Response.json({ error: '未授權' }, { status: 401 });
        const notes = parseStoredList(await env.DRONE_DB.get(NOTES_KEY));
        if (method === 'GET') {
            if (!hasAnyPermission(user, ['cms.view', 'notes.manage'])) return Response.json({ error: '權限不足' }, { status: 403 });
            return Response.json(notes.sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt)));
        }
        if (!hasPermission(user, 'notes.manage')) return Response.json({ error: '權限不足' }, { status: 403 });
        const body = await readJsonObject(request);
        const title = financeText(body.title, '社課名稱', 120);
        const date = financeDate(body.date);
        const content = String(body.content ?? '').trim();
        if (content.length > 5000) return Response.json({ error: '備忘內容不可超過 5000 字' }, { status: 400 });
        const links = Array.isArray(body.links) ? body.links : [];
        if (links.length > 20) return Response.json({ error: '每則備忘最多 20 個網址' }, { status: 400 });
        const normalizedLinks = links.map((link, index) => {
            const label = String(link?.label || '').trim().slice(0, 100);
            const value = String(link?.url || '').trim();
            let parsed;
            try { parsed = new URL(value); } catch { throw new ValidationError(`第 ${index + 1} 個網址格式無效`); }
            if (!['http:', 'https:'].includes(parsed.protocol) || value.length > 2048) throw new ValidationError(`第 ${index + 1} 個網址僅可使用 http 或 https，且不可超過 2048 字`);
            return { label: label || value, url: parsed.href };
        });
        const now = new Date().toISOString();
        const note = { id: crypto.randomUUID(), title, date, content, links: normalizedLinks, createdBy: user.username, createdAt: now, updatedAt: now };
        notes.push(note);
        await env.DRONE_DB.put(NOTES_KEY, JSON.stringify(notes));
        return Response.json(note, { status: 201 });
    }

    if (path.startsWith('/api/notes/') && method === 'DELETE') {
        const user = await sessionUser(request, env);
        if (!user) return Response.json({ error: '未授權' }, { status: 401 });
        if (!hasPermission(user, 'notes.manage')) return Response.json({ error: '權限不足' }, { status: 403 });
        const id = path.slice('/api/notes/'.length);
        const notes = parseStoredList(await env.DRONE_DB.get(NOTES_KEY));
        if (!notes.some(note => note.id === id)) return Response.json({ error: '備忘錄不存在' }, { status: 404 });
        await env.DRONE_DB.put(NOTES_KEY, JSON.stringify(notes.filter(note => note.id !== id)));
        return Response.json({ success: true });
    }

    return null;
}
