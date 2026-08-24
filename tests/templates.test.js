import test from 'node:test';
import assert from 'node:assert/strict';
import { renderLandingPage, renderAdminDashboard, renderPostPage, renderCustomPage, renderNotFoundPage } from '../src/templates.js';

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
            title: '關於 FP V 飛行員',
            slug: 'about-fpv',
            content: 'FPV 獨立頁面內容',
            lang: 'zh'
        }
    ];

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
        const adminHtml = renderAdminDashboard(mockPosts, mockPages, null);
        assert.ok(adminHtml.includes('後台管理面板'), 'Admin title should be present');
        assert.ok(adminHtml.includes('md-editor-container'), 'Rich Markdown editor container should exist');
        assert.ok(adminHtml.includes('insertCodeInlineMD'), 'Rich editor helper function should be present');
        assert.ok(adminHtml.includes('editPost'), 'editPost function must exist in admin template');
        assert.ok(adminHtml.includes('deletePost'), 'deletePost function must exist in admin template');
        
        // Assert no raw unescaped regex comments (/**) that crash JS script block
        assert.equal(adminHtml.includes('.replace(/**'), false, 'HTML script must not contain unescaped regex comments');
    });

    await t.test('renderPostPage should render post content', () => {
        const postHtml = renderPostPage(mockPosts[0], 'zh');
        assert.ok(postHtml.includes('測試文章 1'), 'Post title must be rendered');
        assert.ok(postHtml.includes('測試文章詳細內容'), 'Post content must be rendered');
    });

    await t.test('renderCustomPage should render custom page content', () => {
        const pageHtml = renderCustomPage(mockPages[0], 'zh');
        assert.ok(pageHtml.includes('關於 FP V 飛行員'), 'Custom page title must be rendered');
        assert.ok(pageHtml.includes('FPV 獨立頁面內容'), 'Custom page content must be rendered');
    });

    await t.test('renderNotFoundPage should render 404 page', () => {
        const notFoundHtml = renderNotFoundPage('zh');
        assert.ok(notFoundHtml.includes('404'), '404 page must display 404');
    });
});
