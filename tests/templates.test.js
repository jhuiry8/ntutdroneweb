import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { renderLandingPage, renderAdminDashboard, renderBlogPost, renderCustomPage } from '../src/templates.js';

test('Templates test suite - HTML Rendering & Component Generator', async (t) => {
    const mockPosts = [
        {
            title: '測試文章 1',
            slug: 'test-post-1',
            date: '2026-07-28T00:00:00.000Z',
            summary: '這是一篇測試文章摘要',
            content: '測試文章詳細內容',
            lang: 'zh'
        }
    ];

    const mockPages = [
        {
            title: '關於 FPV 飛行員',
            slug: 'about-fpv',
            content: 'FPV 獨立頁面內容',
            lang: 'zh'
        }
    ];

    await t.test('dashboard scripts parse cleanly in V8 JS VM', () => {
        const adminHtml = renderAdminDashboard(mockPosts, mockPages, { role: 'president' });
        for (const match of adminHtml.matchAll(/<script>([\s\S]*?)<\/script>/gi)) {
            if (match[1].trim()) assert.doesNotThrow(() => new vm.Script(match[1]), `Inline script failed V8 syntax check: ${match[1].slice(0, 150)}...`);
        }
        for (const file of ['admin-nav.js', 'admin.js']) {
            assert.match(adminHtml, new RegExp(`<script src="/${file.replace('.', '\\.')}"></script>`));
            const code = readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8');
            assert.doesNotThrow(() => new vm.Script(code), `${file} failed V8 syntax check`);
        }
        assert.match(adminHtml, /<link rel="stylesheet" href="\/admin\.css">/);
    });

    await t.test('dashboard passes the account permissions to admin.js', () => {
        const config = html => JSON.parse(html.match(/<body data-admin="([^"]*)">/)[1].replaceAll('&quot;', '"'));
        assert.deepEqual(config(renderAdminDashboard([], [], { username: 'boss', role: 'president' })),
            { username: 'boss', isPresident: true, viewCms: true, editCms: true, manageMembers: true });
        assert.deepEqual(config(renderAdminDashboard([], [], { username: 'm', role: 'member' })),
            { username: 'm', isPresident: false, viewCms: false, editCms: false, manageMembers: false });
    });

    await t.test('renderLandingPage should render complete homepage HTML with SEO tags', () => {
        const html = renderLandingPage(mockPosts, 'zh', {});
        assert.ok(html.includes('<!DOCTYPE html>'), 'HTML doc type must exist');
        assert.ok(html.includes('<title>'), 'Title tag must exist');
        assert.ok(html.includes('北科無人機社'), 'Target SEO keyword must exist in title');
        assert.ok(html.includes('id="instagram"'), 'Instagram feed section must exist');
        assert.ok(html.includes('test-post-1'), 'Mock post slug must be rendered');
    });

    await t.test('renderLandingPage should support language switching', () => {
        const htmlEn = renderLandingPage(mockPosts, 'en', {});
        assert.ok(htmlEn.includes('lang="en"'), 'HTML lang attribute should be en');
        assert.ok(htmlEn.includes('About Us') || htmlEn.includes('NTUT Drone Club'), 'English nav text should be rendered');
    });

    await t.test('renderAdminDashboard should render login / management interface cleanly without syntax errors', () => {
        const adminHtml = renderAdminDashboard(mockPosts, mockPages, { role: 'president' });
        assert.ok(adminHtml.includes('後台管理面板'), 'Admin title should be present');
        assert.ok(adminHtml.includes('md-editor-container'), 'Rich Markdown editor container should exist');
        assert.ok(adminHtml.includes('insertCodeInlineMD'), 'Rich editor helper function should be present');
        assert.ok(adminHtml.includes('editPost'), 'editPost function must exist in admin template');
        assert.ok(adminHtml.includes('deletePost'), 'deletePost function must exist in admin template');
    });

    await t.test('renderBlogPost should render post content', () => {
        const postHtml = renderBlogPost(mockPosts[0], '測試文章詳細內容', 'zh');
        assert.ok(postHtml.includes('測試文章 1'), 'Post title must be rendered');
        assert.ok(postHtml.includes('測試文章詳細內容'), 'Post content must be rendered');
    });

    await t.test('renderCustomPage should render custom page content', () => {
        const pageHtml = renderCustomPage(mockPages[0], 'FPV 獨立頁面內容', 'zh');
        assert.ok(pageHtml.includes('關於 FPV 飛行員'), 'Custom page title must be rendered');
        assert.ok(pageHtml.includes('FPV 獨立頁面內容'), 'Custom page content must be rendered');
    });

    await t.test('finance and member modules are shown only to finance managers', () => {
        const financeHtml = renderAdminDashboard([], [], { username: 'treasurer', role: 'finance' });
        assert.match(financeHtml, /財務管理/);
        assert.match(financeHtml, /社員管理/);
        assert.match(financeHtml, /網站管理[\s\S]*社務管理[\s\S]*設備管理/);
        assert.match(financeHtml, /待審核/);
        const memberHtml = renderAdminDashboard([], [], { username: 'member', role: 'member' });
        assert.doesNotMatch(memberHtml, /id="panel-finance"|id="panel-members"|id="panel-equipment"/);
        const cadreHtml = renderAdminDashboard([], [], { username: 'cadre', role: 'cadre' });
        assert.doesNotMatch(cadreHtml, /id="panel-finance"|id="panel-members"/);
        assert.match(cadreHtml, /id="panel-equipment"/);
        assert.match(cadreHtml, /標籤尺寸：4 × 2 cm/);
        assert.match(cadreHtml, /標籤尺寸：2 × 1 cm/);
        assert.match(readFileSync(new URL('../public/admin.js', import.meta.url), 'utf8'), /管理人：/);
    });

    await t.test('mobile navigation uses the same open state in script and stylesheet', () => {
        const script = readFileSync(new URL('../public/main.js', import.meta.url), 'utf8');
        const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
        assert.match(script, /mobileDrawer\.classList\.add\('open'\)/);
        assert.match(css, /\.mobile-drawer\.open\s*\{/);
        assert.match(renderLandingPage(mockPosts, 'zh', {}), /aria-controls="mobile-drawer"/);
    });
});
