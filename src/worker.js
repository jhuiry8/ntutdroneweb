// NTUT Drone Club - Cloudflare Worker Entry Point
import { marked } from 'marked';
import {
    renderLandingPage,
    renderBlogList,
    renderBlogPost,
    renderCustomPage,
    renderLogin,
    renderAdminDashboard
} from './templates.js';

// Configuration Defaults
const DEFAULT_PASS = 'admin123'; // Initial password. Recommended to change in settings.
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
    const cookies = parseCookies(request);
    const sessionToken = cookies.session;
    if (!sessionToken) return false;

    // Check session in KV
    const sessionUser = await env.DRONE_DB.get(`session:${sessionToken}`);
    return !!sessionUser;
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        // Static files (style.css, main.js, images) are served automatically by Cloudflare Workers Assets.
        // The fetch handler only processes routes not matching static files, or we can route explicitly.

        try {
            // ==================== ROUTE: Home Landing Page ====================
            if (path === '/' && method === 'GET') {
                const postsListJson = await env.DRONE_DB.get('posts_list');
                const postsList = postsListJson ? JSON.parse(postsListJson) : [];
                // Get latest 3 posts
                const latestPosts = postsList.slice(0, 3);
                return new Response(renderLandingPage(latestPosts), {
                    headers: { 'Content-Type': 'text/html; charset=utf-8' }
                });
            }

            // ==================== ROUTE: Blog List ====================
            if (path === '/blog' && method === 'GET') {
                const postsListJson = await env.DRONE_DB.get('posts_list');
                const postsList = postsListJson ? JSON.parse(postsListJson) : [];
                return new Response(renderBlogList(postsList), {
                    headers: { 'Content-Type': 'text/html; charset=utf-8' }
                });
            }

            // ==================== ROUTE: Blog Post Detail ====================
            if (path.startsWith('/blog/') && method === 'GET') {
                const slug = path.substring(6);
                const postJson = await env.DRONE_DB.get(`post:${slug}`);
                if (!postJson) {
                    return new Response('文章未找到 Article Not Found', { status: 404 });
                }
                const post = JSON.parse(postJson);
                // Parse markdown content
                const contentHtml = marked.parse(post.content || '');
                return new Response(renderBlogPost(post, contentHtml), {
                    headers: { 'Content-Type': 'text/html; charset=utf-8' }
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
                const contentHtml = marked.parse(page.content || '');
                return new Response(renderCustomPage(page, contentHtml), {
                    headers: { 'Content-Type': 'text/html; charset=utf-8' }
                });
            }

            // ==================== ROUTE: Admin Login / Dashboard ====================
            if (path === '/admin' && method === 'GET') {
                const authed = await isAuthenticated(request, env);
                if (authed) {
                    return Response.redirect(`${url.origin}/admin/dashboard`, 302);
                }
                return new Response(renderLogin(), {
                    headers: { 'Content-Type': 'text/html; charset=utf-8' }
                });
            }

            if (path === '/admin/dashboard' && method === 'GET') {
                const authed = await isAuthenticated(request, env);
                if (!authed) {
                    return Response.redirect(`${url.origin}/admin`, 302);
                }

                // Fetch posts and pages lists to display
                const postsListJson = await env.DRONE_DB.get('posts_list');
                const postsList = postsListJson ? JSON.parse(postsListJson) : [];
                
                const pagesListJson = await env.DRONE_DB.get('pages_list');
                const pagesList = pagesListJson ? JSON.parse(pagesListJson) : [];

                return new Response(renderAdminDashboard(postsList, pagesList), {
                    headers: { 'Content-Type': 'text/html; charset=utf-8' }
                });
            }

            // ==================== API: Login Action ====================
            if (path === '/api/login' && method === 'POST') {
                const formData = await request.formData();
                const password = formData.get('password');

                // Get password hash from KV or set default
                let passHash = await env.DRONE_DB.get('admin_password_hash');
                if (!passHash) {
                    passHash = await hashPassword(DEFAULT_PASS);
                    await env.DRONE_DB.put('admin_password_hash', passHash);
                }

                const inputHash = await hashPassword(password);
                if (inputHash === passHash) {
                    // Create session
                    const token = crypto.randomUUID();
                    // Set session token in KV with 1-day expiration (86400 seconds)
                    await env.DRONE_DB.put(`session:${token}`, 'admin', { expirationTtl: 86400 });

                    // Set Cookie and Redirect
                    return new Response('', {
                        status: 302,
                        headers: {
                            'Location': '/admin/dashboard',
                            'Set-Cookie': `session=${token}; Path=/; HttpOnly; Max-Age=86400; Secure; SameSite=Lax`
                        }
                    });
                } else {
                    return new Response(renderLogin('密碼不正確，請重新輸入！'), {
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
                const authed = await isAuthenticated(request, env);
                if (!authed) {
                    return new Response(JSON.stringify({ error: '未授權 Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
                }

                // API: GET specific post
                if (method === 'GET') {
                    const slug = path.substring(11);
                    const postJson = await env.DRONE_DB.get(`post:${slug}`);
                    if (!postJson) return new Response(JSON.stringify({ error: '文章不存在' }), { status: 404 });
                    return new Response(postJson, { headers: { 'Content-Type': 'application/json' } });
                }

                // API: DELETE post
                if (method === 'DELETE') {
                    const slug = path.substring(11);
                    await env.DRONE_DB.delete(`post:${slug}`);
                    
                    // Update posts list
                    const postsListJson = await env.DRONE_DB.get('posts_list');
                    let postsList = postsListJson ? JSON.parse(postsListJson) : [];
                    postsList = postsList.filter(p => p.slug !== slug);
                    await env.DRONE_DB.put('posts_list', JSON.stringify(postsList));
                    
                    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
                }

                // API: POST create/update post
                if (method === 'POST') {
                    const { title, slug, summary, content, originalSlug } = await request.json();
                    
                    if (!title || !slug || !content) {
                        return new Response(JSON.stringify({ error: '標題、路徑與內容為必填！' }), { status: 400 });
                    }

                    // Check if slug already exists (only for new posts)
                    if (!originalSlug) {
                        const existing = await env.DRONE_DB.get(`post:${slug}`);
                        if (existing) {
                            return new Response(JSON.stringify({ error: '該網址代稱已存在，請使用不同的代稱。' }), { status: 400 });
                        }
                    }

                    const postData = {
                        title,
                        slug,
                        summary,
                        content,
                        date: new Date().toISOString()
                    };

                    // Save post content
                    await env.DRONE_DB.put(`post:${slug}`, JSON.stringify(postData));

                    // Update listing
                    const postsListJson = await env.DRONE_DB.get('posts_list');
                    let postsList = postsListJson ? JSON.parse(postsListJson) : [];
                    
                    // Remove old record if editing
                    if (originalSlug) {
                        postsList = postsList.filter(p => p.slug !== originalSlug);
                        if (originalSlug !== slug) {
                            await env.DRONE_DB.delete(`post:${originalSlug}`);
                        }
                    }

                    // Add new/updated record to list
                    postsList.push({
                        title,
                        slug,
                        summary,
                        date: postData.date
                    });

                    // Sort posts by date descending
                    postsList.sort((a, b) => new Date(b.date) - new Date(a.date));
                    await env.DRONE_DB.put('posts_list', JSON.stringify(postsList));

                    return new Response(JSON.stringify({ success: true, post: postData }), { headers: { 'Content-Type': 'application/json' } });
                }
            }

            // ==================== API: Pages CRUD (Admin Auth required) ====================
            if (path.startsWith('/api/pages') && ['POST', 'DELETE', 'GET'].includes(method)) {
                const authed = await isAuthenticated(request, env);
                if (!authed) {
                    return new Response(JSON.stringify({ error: '未授權' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
                }

                // API: GET specific page
                if (method === 'GET') {
                    const slug = path.substring(11);
                    const pageJson = await env.DRONE_DB.get(`page:${slug}`);
                    if (!pageJson) return new Response(JSON.stringify({ error: '頁面不存在' }), { status: 404 });
                    return new Response(pageJson, { headers: { 'Content-Type': 'application/json' } });
                }

                // API: DELETE page
                if (method === 'DELETE') {
                    const slug = path.substring(11);
                    await env.DRONE_DB.delete(`page:${slug}`);
                    
                    const pagesListJson = await env.DRONE_DB.get('pages_list');
                    let pagesList = pagesListJson ? JSON.parse(pagesListJson) : [];
                    pagesList = pagesList.filter(p => p.slug !== slug);
                    await env.DRONE_DB.put('pages_list', JSON.stringify(pagesList));
                    
                    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
                }

                // API: POST create/update page
                if (method === 'POST') {
                    const { title, slug, content, originalSlug } = await request.json();
                    
                    if (!title || !slug || !content) {
                        return new Response(JSON.stringify({ error: '標題、路徑與內容為必填！' }), { status: 400 });
                    }

                    if (!originalSlug) {
                        const existing = await env.DRONE_DB.get(`page:${slug}`);
                        if (existing) {
                            return new Response(JSON.stringify({ error: '該頁面路徑已存在！' }), { status: 400 });
                        }
                    }

                    const pageData = { title, slug, content };
                    await env.DRONE_DB.put(`page:${slug}`, JSON.stringify(pageData));

                    // Update listing
                    const pagesListJson = await env.DRONE_DB.get('pages_list');
                    let pagesList = pagesListJson ? JSON.parse(pagesListJson) : [];
                    
                    if (originalSlug) {
                        pagesList = pagesList.filter(p => p.slug !== originalSlug);
                        if (originalSlug !== slug) {
                            await env.DRONE_DB.delete(`page:${originalSlug}`);
                        }
                    }

                    pagesList.push({ title, slug });
                    await env.DRONE_DB.put('pages_list', JSON.stringify(pagesList));

                    return new Response(JSON.stringify({ success: true, page: pageData }), { headers: { 'Content-Type': 'application/json' } });
                }
            }

            // ==================== API: Change Password ====================
            if (path === '/api/change-password' && method === 'POST') {
                const authed = await isAuthenticated(request, env);
                if (!authed) {
                    return new Response(JSON.stringify({ error: '未授權' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
                }

                const { oldPassword, newPassword } = await request.json();
                const passHash = await env.DRONE_DB.get('admin_password_hash');
                const oldHash = await hashPassword(oldPassword);

                if (oldHash !== passHash) {
                    return new Response(JSON.stringify({ error: '舊密碼輸入錯誤！' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
                }

                const newHash = await hashPassword(newPassword);
                await env.DRONE_DB.put('admin_password_hash', newHash);

                return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
            }

            // ==================== API: Upload Image to GitHub ====================
            if (path === '/api/upload' && method === 'POST') {
                const authed = await isAuthenticated(request, env);
                if (!authed) {
                    return new Response(JSON.stringify({ error: '未授權' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
                }

                // Check environment secrets
                if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
                    return new Response(JSON.stringify({ error: 'Worker 尚未設定 GITHUB_TOKEN 或 GITHUB_REPO 環境變數！' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
                }

                const formData = await request.formData();
                const file = formData.get('image');

                if (!file || typeof file === 'string') {
                    return new Response(JSON.stringify({ error: '無效的圖片檔案' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
                }

                // Convert file to Base64
                const arrayBuffer = await file.arrayBuffer();
                const base64Content = btoa(
                    new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
                );

                // Generate clean filename
                const extension = file.name.split('.').pop();
                const timestamp = Date.now();
                const filename = `upload_${timestamp}.${extension}`;
                const commitPath = `public/assets/uploads/${filename}`;

                // Push to GitHub API
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

                // Construct accessible URL
                // Format: https://jhuiry8.github.io/ntutdroneweb/assets/uploads/filename
                const [owner, repo] = env.GITHUB_REPO.split('/');
                const publicUrl = `https://${owner}.github.io/${repo}/assets/uploads/${filename}`;

                return new Response(JSON.stringify({
                    success: true,
                    filename,
                    url: publicUrl
                }), { headers: { 'Content-Type': 'application/json' } });
            }

            // Fallback for standard worker request handler (will try static asset match first)
            return new Response('Not Found', { status: 404 });

        } catch (e) {
            return new Response(`伺服器內部錯誤 Internal Server Error: ${e.message}`, { status: 500 });
        }
    }
};
