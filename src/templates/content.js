// Blog list, blog post and custom pages of the public site.
import { locales } from '../locales.js';
import { escapeHtml, sanitizeContent } from '../html.js';
import { getHeader, getFooter } from './layout.js';

// 2. Render Blog List Page
export function renderBlogList(posts = [], lang = 'zh') {
    lang = lang === 'en' ? 'en' : 'zh';
    const t = locales[lang];
    let postsListHtml = '';
    
    if (posts.length === 0) {
        postsListHtml = `
            <div class="about-card text-center" style="grid-column: span 3; padding: 80px 40px;">
                <i data-lucide="book-open" style="width: 64px; height: 64px; color: var(--color-cyan); margin-bottom: 24px; opacity: 0.5;"></i>
                <h3>${lang === 'zh' ? '尚無文章' : 'No Articles'}</h3>
                <p style="color: var(--text-muted); margin-top: 8px;">${t.blogEmpty}</p>
            </div>
        `;
    } else {
        posts.forEach(post => {
            const dateStr = new Date(post.date).toLocaleDateString(lang === 'zh' ? 'zh-TW' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' });
            postsListHtml += `
                <article class="about-card" style="display: flex; flex-direction: column; justify-content: space-between;">
                    <div>
                        <span style="font-size: 0.85rem; color: var(--color-cyan); font-weight: 600;">${dateStr}</span>
                        <h3 style="margin-top: 10px; margin-bottom: 14px; font-size: 1.4rem; line-height: 1.3;">${escapeHtml(post.title)}</h3>
                        <p style="color: var(--text-secondary); font-size: 0.95rem; margin-bottom: 24px; line-height: 1.6;">${escapeHtml(post.summary || '')}</p>
                    </div>
                    <a href="/blog/${escapeHtml(post.slug)}?lang=${lang}" class="btn btn-secondary" style="width: 100%; text-align: center; padding: 10px;">${lang === 'zh' ? '閱讀文章' : 'Read Article'} <i data-lucide="arrow-right"></i></a>
                </article>
            `;
        });
    }

    return `
        ${getHeader(t.blogAllTitle, lang)}
        <main style="padding-top: 140px; min-height: 80vh;">
            <div class="section-container">
                <div class="section-header text-center">
                    <h1 class="section-title">${t.blogAllTitle}</h1>
                    <p class="section-subtitle">${t.blogAllDesc}</p>
                </div>
                <div class="about-grid blog-grid" style="grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 30px;">
                    ${postsListHtml}
                </div>
            </div>
        </main>
        ${getFooter(lang, 'blog')}
    `;
}

// 3. Render Blog Post Detail Page
export function renderBlogPost(post, parsedContentHtml, lang = 'zh') {
    lang = lang === 'en' ? 'en' : 'zh';
    const t = locales[lang];
    const dateStr = new Date(post.date).toLocaleDateString(lang === 'zh' ? 'zh-TW' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    return `
        ${getHeader(post.title, lang)}
        <main style="padding-top: 140px; min-height: 80vh;">
            <article class="section-container" style="max-width: 800px; padding: 40px 24px;">
                <div style="margin-bottom: 40px; border-bottom: 1px solid var(--border-glass); padding-bottom: 30px;">
                    <a href="/blog?lang=${lang}" style="color: var(--color-cyan); display: inline-flex; align-items: center; gap: 6px; font-weight: 500; margin-bottom: 20px; font-size: 0.95rem;">
                        <i data-lucide="arrow-left" style="width: 16px; height: 16px;"></i> ${t.blogBack}
                    </a>
                    <h1 style="font-size: 2.75rem; font-weight: 800; line-height: 1.25; margin-bottom: 16px; background: linear-gradient(135deg, #fff, var(--text-secondary)); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">${escapeHtml(post.title)}</h1>
                    <div style="display: flex; gap: 20px; color: var(--text-muted); font-size: 0.9rem;">
                        <span><i data-lucide="calendar" style="width: 14px; height: 14px; display: inline; vertical-align: middle; margin-right: 4px;"></i> ${dateStr}</span>
                    </div>
                </div>
                
                <div class="markdown-body" style="font-size: 1.05rem; line-height: 1.8; color: var(--text-secondary);">
                    ${sanitizeContent(parsedContentHtml)}
                </div>
            </article>
        </main>
        
        <style>
            .markdown-body h2 {
                font-size: 1.75rem;
                font-weight: 700;
                color: #fff;
                margin-top: 40px;
                margin-bottom: 16px;
                border-bottom: 1px solid var(--border-glass);
                padding-bottom: 8px;
            }
            .markdown-body h3 {
                font-size: 1.35rem;
                font-weight: 600;
                color: #fff;
                margin-top: 30px;
                margin-bottom: 12px;
            }
            .markdown-body p { margin-bottom: 20px; }
            .markdown-body ul, .markdown-body ol { margin-bottom: 20px; padding-left: 24px; }
            .markdown-body ul { list-style-type: disc; }
            .markdown-body ol { list-style-type: decimal; }
            .markdown-body li { margin-bottom: 6px; }
            .markdown-body blockquote {
                border-left: 4px solid var(--color-cyan);
                background: rgba(0, 240, 255, 0.05);
                padding: 16px 20px;
                border-radius: 0 8px 8px 0;
                margin: 24px 0;
                color: var(--text-primary);
                font-style: italic;
            }
            .markdown-body pre {
                background: rgba(0, 0, 0, 0.4);
                border: 1px solid var(--border-glass);
                padding: 16px;
                border-radius: 12px;
                overflow-x: auto;
                margin: 24px 0;
                font-family: monospace;
            }
            .markdown-body code {
                font-family: monospace;
                background: rgba(255, 255, 255, 0.08);
                padding: 2px 6px;
                border-radius: 4px;
                font-size: 0.9em;
                color: var(--color-cyan);
            }
            .markdown-body img {
                max-width: 100%;
                border-radius: 16px;
                border: 1px solid var(--border-glass);
                margin: 30px auto;
                box-shadow: 0 10px 30px rgba(0,0,0,0.5);
                display: block;
            }
            .markdown-body a { color: var(--color-cyan); text-decoration: underline; }
            .markdown-body a:hover { color: var(--color-purple); }
        </style>
        ${getFooter(lang, 'blog')}
    `;
}

// 4. Render Dynamic Custom Page
export function renderCustomPage(page, parsedContentHtml, lang = 'zh') {
    return `
        ${getHeader(page.title, lang)}
        <main style="padding-top: 140px; min-height: 80vh;">
            <article class="section-container" style="max-width: 900px; padding: 40px 24px;">
                <h1 style="font-size: 3rem; font-weight: 900; margin-bottom: 40px; border-bottom: 1px solid var(--border-glass); padding-bottom: 20px; background: linear-gradient(135deg, #fff, var(--color-cyan)); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">${escapeHtml(page.title)}</h1>
                <div class="markdown-body" style="font-size: 1.05rem; line-height: 1.8; color: var(--text-secondary);">
                    ${sanitizeContent(parsedContentHtml)}
                </div>
            </article>
        </main>
        
        <style>
            .markdown-body h2 {
                font-size: 1.85rem;
                font-weight: 700;
                color: #fff;
                margin-top: 40px;
                margin-bottom: 16px;
                border-bottom: 1px solid var(--border-glass);
                padding-bottom: 8px;
            }
            .markdown-body p { margin-bottom: 20px; }
            .markdown-body img { max-width: 100%; border-radius: 16px; border: 1px solid var(--border-glass); margin: 30px 0; }
            .markdown-body a { color: var(--color-cyan); text-decoration: underline; }
        </style>
        ${getFooter(lang)}
    `;
}
