// Server-rendered pages: the public website (home, blog, custom pages) and the
// dashboard shell at /admin.
import { marked } from 'marked';
import { publicUser, canViewCms } from './auth.js';
import { renderLandingPage, renderBlogList, renderBlogPost, renderCustomPage, renderAdminDashboard } from './templates.js';
import { parseCookies } from './request.js';
import { sessionUser, isAuthenticated } from './session.js';
import { loginPageResponse } from './auth-routes.js';

// Returns a Response for the public pages, /admin and /admin/dashboard, or null for any other path.
export async function handlePageRequest(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

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
        return loginPageResponse(env);
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

    return null;
}
