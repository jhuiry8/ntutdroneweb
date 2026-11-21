// The dashboard shell. Its styles and behaviour are static files in public/
// (admin.css, admin-nav.js, admin.js and the admin-*.js modules).
import { canViewCms, canEditCms, canManageFinance, canManageMembers, canManageEquipment } from '../auth.js';
import { escapeHtml } from '../html.js';
import { PWA_HEAD_TAGS } from './layout.js';

// 6. Render Admin Dashboard Page with i18n Post Creation
export function renderAdminDashboard(posts = [], pages = [], user = { username: 'admin', role: 'president' }) {
    const viewCms = canViewCms(user);
    const manageFinance = canManageFinance(user);
    const manageMembers = canManageMembers(user);
    const manageEquipment = canManageEquipment(user);
    if (!viewCms) { posts = []; pages = []; }
    // Read by public/admin.js; the server decides what this account may do.
    const adminConfig = {
        username: String(user?.username || ''),
        isPresident: user?.role === 'president',
        viewCms,
        editCms: canEditCms(user),
        manageMembers
    };
    return `
    <!DOCTYPE html>
    <html lang="zh-TW">
    <head>
        <meta charset="UTF-8">
        ${PWA_HEAD_TAGS}
        <title>後台管理面板 | 北科無人機社</title>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;700&family=Outfit:wght@400;600;800&display=swap" rel="stylesheet">
        <script src="/vendor/lucide-1.65.0.min.js"></script>
        <script src="/theme.js"></script>
        <script src="/admin-nav.js"></script>
        <link rel="stylesheet" href="/admin.css">
        <link rel="stylesheet" href="/glass.css">
        <link rel="stylesheet" href="/admin-theme.css">
    </head>
    <body data-admin="${escapeHtml(JSON.stringify(adminConfig))}">
        <div class="mobile-admin-bar"><button type="button" onclick="toggleAdminMenu()" aria-label="開啟後台選單" aria-controls="admin-sidebar" aria-expanded="false">☰</button><strong id="mobile-admin-title">NTUT DRONE 後台</strong><button type="button" class="theme-btn" data-theme-toggle aria-label="切換外觀"><span class="theme-icon">🌓</span></button><span id="offline-badge" class="offline-badge" hidden role="status">離線中</span></div>
        <div id="install-hint" class="install-hint" hidden><span id="install-hint-text"></span><button type="button" id="install-hint-btn" class="btn btn-primary" hidden>安裝</button><button type="button" id="install-hint-close" aria-label="關閉提示">✕</button></div>
        <div id="admin-backdrop" class="admin-backdrop"></div>
        <div class="sidebar" id="admin-sidebar">
            <div>
                <div class="sidebar-logo">
                    <img src="/assets/images/logo_ntut.jpg" alt="NTUT Drone" style="width: 28px; height: 28px; object-fit: contain; border-radius: 6px; vertical-align: middle; margin-right: 8px;"> NTUT DRONE 後台
                </div>
                <div class="sidebar-nav">
                    ${viewCms ? `<div class="nav-group"><p class="nav-group-label">網站管理</p>
                        <button class="nav-item active" onclick="showPanel('posts')"><i data-lucide="book-open"></i> 文章管理</button>
                        <button class="nav-item" onclick="showPanel('pages')"><i data-lucide="file-text"></i> 頁面管理</button>
                        <button class="nav-item" onclick="showPanel('homepage')"><i data-lucide="home"></i> 首頁設定</button>
                    </div>` : ''}
                    <div class="nav-group"><p class="nav-group-label">社務管理</p>
                        <button class="nav-item" onclick="showPanel('forms'); loadForms()"><i data-lucide="file-pen-line"></i> 表單申請</button>
                        ${manageMembers ? `<button class="nav-item" onclick="showPanel('members'); loadMembers()"><i data-lucide="contact-round"></i> 社員管理</button>` : ''}
                        ${manageFinance ? `<button class="nav-item" onclick="showPanel('finance'); loadFinance()"><i data-lucide="wallet-cards"></i> 財務管理</button>` : ''}
                        ${manageEquipment ? `<button class="nav-item" onclick="showPanel('equipment'); loadEquipment()"><i data-lucide="package-check"></i> 設備管理</button>` : ''}
                        ${viewCms ? `<button class="nav-item" onclick="showPanel('notes'); loadNotes()"><i data-lucide="sticky-note"></i> 社課備忘錄</button>` : ''}
                        <button class="nav-item" onclick="showPanel('regulations'); loadRegulations()"><i data-lucide="scale"></i> 法規查詢</button>
                    </div>
                    <div class="nav-group"><p class="nav-group-label">系統管理</p>
                        <button class="nav-item" onclick="showPanel('settings'); loadMyMember()"><i data-lucide="settings"></i> 系統設定</button>
                        ${user?.role === 'president' ? `<button class="nav-item" onclick="showPanel('users'); loadUsers()"><i data-lucide="users"></i> 帳號與權限</button>` : ''}
                    </div>
                </div>
            </div>
            <div>
                <button type="button" class="nav-item" data-theme-toggle style="margin-bottom: 8px;"><span class="theme-icon">🌓</span> <span class="theme-label">外觀</span></button>
                <a href="/" target="_blank" class="nav-item" style="margin-bottom: 8px;"><i data-lucide="external-link"></i> 前台首頁</a>
                <button class="nav-item" onclick="logout()" style="color: #f87171;"><i data-lucide="log-out"></i> 安全登出</button>
            </div>
        </div>

        <div class="main-content">
            ${viewCms ? `<!-- Posts Panel -->
            <div id="panel-posts" class="panel active">
                <div class="content-header">
                    <h1>文章管理</h1>
                    <button class="btn btn-primary" onclick="openPostForm()"><i data-lucide="plus"></i> 新增文章</button>
                </div>
                
                <div id="posts-list-view">
                    <div class="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>日期</th>
                                    <th>標題</th>
                                    <th>語言</th>
                                    <th>網址路徑 (Slug)</th>
                                    <th style="width: 180px; text-align: right;">動作</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${posts.map(post => `
                                    <tr id="row-post-${escapeHtml(post.slug)}">
                                        <td>${new Date(post.date).toLocaleDateString('zh-TW')}</td>
                                        <td><strong>${escapeHtml(post.title)}</strong></td>
                                        <td><span style="background:rgba(255,255,255,0.06); padding:4px 8px; border-radius:6px; font-size:0.8rem; font-weight:600; color:var(--color-cyan);">${post.lang === 'en' ? 'English' : '中文'}</span></td>
                                        <td><code>/blog/${escapeHtml(post.slug)}</code></td>
                                        <td style="text-align: right; white-space: nowrap;">
                                            <button type="button" class="btn btn-secondary" data-slug="${escapeHtml(post.slug)}" onclick="editPost(this.dataset.slug)" style="padding: 6px 12px; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 4px; cursor: pointer;"><i data-lucide="edit-3" style="width: 14px; height: 14px; pointer-events: none;"></i> <span>編輯</span></button>
                                            <button type="button" class="btn btn-danger" data-slug="${escapeHtml(post.slug)}" onclick="deletePost(this.dataset.slug)" style="padding: 6px 12px; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 4px; cursor: pointer;"><i data-lucide="trash-2" style="width: 14px; height: 14px; pointer-events: none;"></i> <span>刪除</span></button>
                                        </td>
                                    </tr>
                                `).join('')}
                                ${posts.length === 0 ? '<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">尚無文章，點擊上方按鈕開始撰寫。</td></tr>' : ''}
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Post Editor Form (Hidden by default) -->
                <div id="posts-form-view" style="display: none; margin-top: 20px;">
                    <h2 id="post-form-title" style="margin-bottom: 24px;">新增文章</h2>
                    <form id="post-form" onsubmit="savePost(event)">
                        <input type="hidden" id="post-original-slug">
                        <div class="responsive-form-grid" style="display:grid; grid-template-columns: 2fr 1fr; gap:20px;">
                            <div class="form-group">
                                <label for="post-title">文章標題</label>
                                <input type="text" id="post-title" class="form-control" placeholder="輸入文章標題..." required>
                            </div>
                            <div class="form-group">
                                <label for="post-lang">寫作語言 (Language)</label>
                                <select id="post-lang" class="form-control">
                                    <option value="zh">中文 (Chinese)</option>
                                    <option value="en">English (英文)</option>
                                </select>
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="post-slug">網址代稱 (Slug - 只能為英文、數字與底線/橫線)</label>
                            <input type="text" id="post-slug" class="form-control" placeholder="例如: fpv-setup-guide" required>
                        </div>
                        <div class="form-group">
                            <label for="post-summary">精簡摘要</label>
                            <input type="text" id="post-summary" class="form-control" placeholder="簡短說明文章內容，顯示於列表...">
                        </div>
                        <div class="form-group">
                            <label for="post-content">文章內容 (提供可視化編輯工具列與即時預覽)</label>
                            
                            <div class="md-editor-container" id="container-post-content">
                                <div class="md-toolbar">
                                    <div class="md-toolbar-group">
                                        <button type="button" class="tb-btn" onclick="insertMD('post-content', '**', '**', '粗體文字')" title="粗體 (Bold)"><i data-lucide="bold"></i></button>
                                        <button type="button" class="tb-btn" onclick="insertMD('post-content', '*', '*', '斜體文字')" title="斜體 (Italic)"><i data-lucide="italic"></i></button>
                                        <button type="button" class="tb-btn" onclick="insertMD('post-content', '<u>', '</u>', '底線文字')" title="底線 (Underline)"><i data-lucide="underline"></i></button>
                                        <button type="button" class="tb-btn" onclick="insertMD('post-content', '~~', '~~', '刪除線')" title="刪除線 (Strikethrough)"><i data-lucide="strikethrough"></i></button>
                                    </div>
                                    <div class="tb-divider"></div>
                                    <div class="md-toolbar-group">
                                        <button type="button" class="tb-btn" onclick="insertMD('post-content', '# ', '', '大標題 H1')" title="一級標題 (H1)"><span style="font-weight:800; font-size:0.8rem;">H1</span></button>
                                        <button type="button" class="tb-btn" onclick="insertMD('post-content', '## ', '', '二級標題 H2')" title="二級標題 (H2)"><span style="font-weight:800; font-size:0.8rem;">H2</span></button>
                                        <button type="button" class="tb-btn" onclick="insertMD('post-content', '### ', '', '三級標題 H3')" title="三級標題 (H3)"><span style="font-weight:800; font-size:0.8rem;">H3</span></button>
                                    </div>
                                    <div class="tb-divider"></div>
                                    <div class="md-toolbar-group">
                                        <button type="button" class="tb-btn" onclick="insertMD('post-content', '> ', '', '引用文案段落')" title="引用段落 (Quote)"><i data-lucide="quote"></i></button>
                                        <button type="button" class="tb-btn" onclick="insertMD('post-content', '- ', '', '無序清單項目')" title="無序清單 (Bullet List)"><i data-lucide="list"></i></button>
                                        <button type="button" class="tb-btn" onclick="insertMD('post-content', '1. ', '', '第一項清單')" title="有序清單 (Numbered List)"><i data-lucide="list-ordered"></i></button>
                                        <button type="button" class="tb-btn" onclick="insertMD('post-content', '- [ ] ', '', '待辦事項')" title="待辦項目 (Task List)"><i data-lucide="check-square"></i></button>
                                    </div>
                                    <div class="tb-divider"></div>
                                    <div class="md-toolbar-group">
                                        <button type="button" class="tb-btn" onclick="insertCodeInlineMD('post-content')" title="行內程式碼 (Code)"><i data-lucide="code"></i></button>
                                        <button type="button" class="tb-btn" onclick="insertCodeBlockMD('post-content')" title="程式碼區塊 (Code Block)"><i data-lucide="terminal"></i></button>
                                        <button type="button" class="tb-btn" onclick="insertLinkMD('post-content')" title="插入超連結 (Link)"><i data-lucide="link"></i></button>
                                        <button type="button" class="tb-btn" onclick="insertImageMD('post-content')" title="插入圖片 (Image)"><i data-lucide="image"></i></button>
                                        <button type="button" class="tb-btn" onclick="insertTableMD('post-content')" title="插入表格 (Table)"><i data-lucide="table"></i></button>
                                    </div>
                                    <div class="tb-divider"></div>
                                    <div class="md-toolbar-group" style="margin-left: auto;">
                                        <button type="button" class="tb-btn tb-preview-btn active" onclick="togglePreview('post-content')" title="切換 即時渲染預覽 (Live Preview)"><i data-lucide="eye"></i> <span>即時預覽</span></button>
                                    </div>
                                </div>
                                <div class="editor-split-wrapper">
                                    <textarea id="post-content" class="form-control editor-textarea" rows="16" placeholder="點選上方工具列即可自動套用格式，右側即時呈現排版效果..." oninput="updateLivePreview('post-content')" required></textarea>
                                    <div id="preview-post-content" class="editor-preview-pane">
                                        <div class="preview-header">即時渲染預覽 (Live Preview)</div>
                                        <div class="preview-body" id="preview-body-post-content"></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div style="display: flex; gap: 12px; justify-content: flex-end;">
                            <button type="button" class="btn btn-secondary" onclick="closePostForm()">取消</button>
                            <button type="submit" class="btn btn-primary">儲存文章</button>
                        </div>
                    </form>
                </div>
            </div>

            <!-- Pages Panel -->
            <div id="panel-pages" class="panel">
                <div class="content-header">
                    <h1>獨立頁面管理</h1>
                    <button class="btn btn-primary" onclick="openPageForm()"><i data-lucide="plus"></i> 新增頁面</button>
                </div>
                
                <div id="pages-list-view">
                    <div class="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>頁面標題</th>
                                    <th>語言</th>
                                    <th>網址路徑 (Slug)</th>
                                    <th style="width: 180px; text-align: right;">動作</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${pages.map(page => `
                                    <tr id="row-page-${escapeHtml(page.slug)}">
                                        <td><strong>${escapeHtml(page.title)}</strong></td>
                                        <td><span style="background:rgba(255,255,255,0.06); padding:4px 8px; border-radius:6px; font-size:0.8rem; font-weight:600; color:var(--color-cyan);">${page.lang === 'en' ? 'English' : '中文'}</span></td>
                                        <td><code>/page/${escapeHtml(page.slug)}</code></td>
                                        <td style="text-align: right; white-space: nowrap;">
                                            <button type="button" class="btn btn-secondary" data-slug="${escapeHtml(page.slug)}" onclick="editPage(this.dataset.slug)" style="padding: 6px 12px; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 4px; cursor: pointer;"><i data-lucide="edit-3" style="width: 14px; height: 14px; pointer-events: none;"></i> <span>編輯</span></button>
                                            <button type="button" class="btn btn-danger" data-slug="${escapeHtml(page.slug)}" onclick="deletePage(this.dataset.slug)" style="padding: 6px 12px; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 4px; cursor: pointer;"><i data-lucide="trash-2" style="width: 14px; height: 14px; pointer-events: none;"></i> <span>刪除</span></button>
                                        </td>
                                    </tr>
                                `).join('')}
                                ${pages.length === 0 ? '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">尚無自訂頁面。</td></tr>' : ''}
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Page Editor Form (Hidden by default) -->
                <div id="pages-form-view" style="display: none; margin-top: 20px;">
                    <h2 id="page-form-title" style="margin-bottom: 24px;">新增頁面</h2>
                    <form id="page-form" onsubmit="savePage(event)">
                        <input type="hidden" id="page-original-slug">
                        <div class="responsive-form-grid" style="display:grid; grid-template-columns: 2fr 1fr; gap:20px;">
                            <div class="form-group">
                                <label for="page-title">頁面標題</label>
                                <input type="text" id="page-title" class="form-control" placeholder="例如: 2026 入社招生資訊" required>
                            </div>
                            <div class="form-group">
                                <label for="page-lang">頁面語言</label>
                                <select id="page-lang" class="form-control">
                                    <option value="zh">中文 (Chinese)</option>
                                    <option value="en">English (英文)</option>
                                </select>
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="page-slug">網址路徑 (Slug - 例如 about-fpv 則網址為 /page/about-fpv)</label>
                            <input type="text" id="page-slug" class="form-control" placeholder="例如: join-us" required>
                        </div>
                        <div class="form-group">
                            <label for="page-content">頁面內容 (提供可視化編輯工具列與即時預覽)</label>
                            
                            <div class="md-editor-container" id="container-page-content">
                                <div class="md-toolbar">
                                    <div class="md-toolbar-group">
                                        <button type="button" class="tb-btn" onclick="insertMD('page-content', '**', '**', '粗體文字')" title="粗體 (Bold)"><i data-lucide="bold"></i></button>
                                        <button type="button" class="tb-btn" onclick="insertMD('page-content', '*', '*', '斜體文字')" title="斜體 (Italic)"><i data-lucide="italic"></i></button>
                                        <button type="button" class="tb-btn" onclick="insertMD('page-content', '<u>', '</u>', '底線文字')" title="底線 (Underline)"><i data-lucide="underline"></i></button>
                                        <button type="button" class="tb-btn" onclick="insertMD('page-content', '~~', '~~', '刪除線')" title="刪除線 (Strikethrough)"><i data-lucide="strikethrough"></i></button>
                                    </div>
                                    <div class="tb-divider"></div>
                                    <div class="md-toolbar-group">
                                        <button type="button" class="tb-btn" onclick="insertMD('page-content', '# ', '', '大標題 H1')" title="一級標題 (H1)"><span style="font-weight:800; font-size:0.8rem;">H1</span></button>
                                        <button type="button" class="tb-btn" onclick="insertMD('page-content', '## ', '', '二級標題 H2')" title="二級標題 (H2)"><span style="font-weight:800; font-size:0.8rem;">H2</span></button>
                                        <button type="button" class="tb-btn" onclick="insertMD('page-content', '### ', '', '三級標題 H3')" title="三級標題 (H3)"><span style="font-weight:800; font-size:0.8rem;">H3</span></button>
                                    </div>
                                    <div class="tb-divider"></div>
                                    <div class="md-toolbar-group">
                                        <button type="button" class="tb-btn" onclick="insertMD('page-content', '> ', '', '引用文案段落')" title="引用段落 (Quote)"><i data-lucide="quote"></i></button>
                                        <button type="button" class="tb-btn" onclick="insertMD('page-content', '- ', '', '無序清單項目')" title="無序清單 (Bullet List)"><i data-lucide="list"></i></button>
                                        <button type="button" class="tb-btn" onclick="insertMD('page-content', '1. ', '', '第一項清單')" title="有序清單 (Numbered List)"><i data-lucide="list-ordered"></i></button>
                                        <button type="button" class="tb-btn" onclick="insertMD('page-content', '- [ ] ', '', '待辦事項')" title="待辦項目 (Task List)"><i data-lucide="check-square"></i></button>
                                    </div>
                                    <div class="tb-divider"></div>
                                    <div class="md-toolbar-group">
                                        <button type="button" class="tb-btn" onclick="insertCodeInlineMD('page-content')" title="行內程式碼 (Code)"><i data-lucide="code"></i></button>
                                        <button type="button" class="tb-btn" onclick="insertCodeBlockMD('page-content')" title="程式碼區塊 (Code Block)"><i data-lucide="terminal"></i></button>
                                        <button type="button" class="tb-btn" onclick="insertLinkMD('page-content')" title="插入超連結 (Link)"><i data-lucide="link"></i></button>
                                        <button type="button" class="tb-btn" onclick="insertImageMD('page-content')" title="插入圖片 (Image)"><i data-lucide="image"></i></button>
                                        <button type="button" class="tb-btn" onclick="insertTableMD('page-content')" title="插入表格 (Table)"><i data-lucide="table"></i></button>
                                    </div>
                                    <div class="tb-divider"></div>
                                    <div class="md-toolbar-group" style="margin-left: auto;">
                                        <button type="button" class="tb-btn tb-preview-btn active" onclick="togglePreview('page-content')" title="切換 即時渲染預覽 (Live Preview)"><i data-lucide="eye"></i> <span>即時預覽</span></button>
                                    </div>
                                </div>
                                <div class="editor-split-wrapper">
                                    <textarea id="page-content" class="form-control editor-textarea" rows="18" placeholder="點選上方工具列即可自動套用格式，右側即時呈現排版效果..." oninput="updateLivePreview('page-content')" required></textarea>
                                    <div id="preview-page-content" class="editor-preview-pane">
                                        <div class="preview-header">即時渲染預覽 (Live Preview)</div>
                                        <div class="preview-body" id="preview-body-page-content"></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div style="display: flex; gap: 12px; justify-content: flex-end;">
                            <button type="button" class="btn btn-secondary" onclick="closePageForm()">取消</button>
                            <button type="submit" class="btn btn-primary">儲存頁面</button>
                        </div>
                    </form>
                </div>
            </div>

            <!-- Homepage Settings Panel -->
            <div id="panel-homepage" class="panel">
                <div class="content-header">
                    <h1>全首頁內容設定</h1>
                    <button class="btn btn-primary" onclick="saveHomepage()"><i data-lucide="save"></i> 儲存所有首頁設定</button>
                </div>
                <p style="color: var(--text-muted); margin-bottom: 28px; font-size: 0.9rem;">在這裡修改首頁所有區塊的文字與說明，點擊儲存後前台即時生效。</p>

                <!-- Section 1: Hero -->
                <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-glass); border-radius: 12px; padding: 24px; margin-bottom: 24px;">
                    <h2 style="font-size: 1.1rem; color: var(--color-cyan); margin-bottom: 16px; display: flex; align-items: center; gap: 8px;"><i data-lucide="sparkles"></i> 1. 頂部 Hero 展示區</h2>
                    <div class="responsive-form-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                        <div class="form-group" style="grid-column: 1 / -1;">
                            <label for="hp-hero-title">首頁主標題 (H1)</label>
                            <input type="text" id="hp-hero-title" class="form-control" placeholder="北科無人機社">
                        </div>
                        <div class="form-group" style="grid-column: 1 / -1;">
                            <label for="hp-hero-desc">展示區描述文字 (Hero Description)</label>
                            <textarea id="hp-hero-desc" class="form-control" rows="2" placeholder="探索上帝視角的無限精彩…"></textarea>
                        </div>
                        <div class="form-group" style="grid-column: 1 / -1;">
                            <label for="hp-hero-badge">頂部徽章標籤文字 (Hero Badge)</label>
                            <input type="text" id="hp-hero-badge" class="form-control" placeholder="國立臺北科技大學 | 學務處課外活動指導組核可康樂性社團">
                        </div>
                    </div>
                </div>

                <!-- Section 2: About -->
                <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-glass); border-radius: 12px; padding: 24px; margin-bottom: 24px;">
                    <h2 style="font-size: 1.1rem; color: var(--color-purple); margin-bottom: 16px; display: flex; align-items: center; gap: 8px;"><i data-lucide="info"></i> 2. 關於我們 (About Section)</h2>
                    <div class="responsive-form-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                        <div class="form-group">
                            <label for="hp-about-title">區塊標題</label>
                            <input type="text" id="hp-about-title" class="form-control" placeholder="關於北科無人機社">
                        </div>
                        <div class="form-group">
                            <label for="hp-about-subtitle">區塊副標題</label>
                            <input type="text" id="hp-about-subtitle" class="form-control" placeholder="我們不僅僅是在空中飛行…">
                        </div>
                        <div class="form-group">
                            <label for="hp-about-c1-title">卡片 1 標題</label>
                            <input type="text" id="hp-about-c1-title" class="form-control" placeholder="安全第一的飛行教育">
                            <label for="hp-about-c1-desc" style="margin-top: 8px;">卡片 1 內容</label>
                            <textarea id="hp-about-c1-desc" class="form-control" rows="3"></textarea>
                        </div>
                        <div class="form-group">
                            <label for="hp-about-c2-title">卡片 2 標題</label>
                            <input type="text" id="hp-about-c2-title" class="form-control" placeholder="動手實作的創客精神">
                            <label for="hp-about-c2-desc" style="margin-top: 8px;">卡片 2 內容</label>
                            <textarea id="hp-about-c2-desc" class="form-control" rows="3"></textarea>
                        </div>
                        <div class="form-group" style="grid-column: 1 / -1;">
                            <label for="hp-about-c3-title">卡片 3 標題</label>
                            <input type="text" id="hp-about-c3-title" class="form-control" placeholder="緊密的飛友社群">
                            <label for="hp-about-c3-desc" style="margin-top: 8px;">卡片 3 內容</label>
                            <textarea id="hp-about-c3-desc" class="form-control" rows="3"></textarea>
                        </div>
                    </div>
                </div>

                <!-- Section 3: Features -->
                <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-glass); border-radius: 12px; padding: 24px; margin-bottom: 24px;">
                    <h2 style="font-size: 1.1rem; color: #10b981; margin-bottom: 16px; display: flex; align-items: center; gap: 8px;"><i data-lucide="zap"></i> 3. 四大核心特色 (Features Section)</h2>
                    <div class="responsive-form-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                        <div class="form-group">
                            <label for="hp-features-title">區塊標題</label>
                            <input type="text" id="hp-features-title" class="form-control" placeholder="四大核心特色">
                        </div>
                        <div class="form-group">
                            <label for="hp-features-subtitle">區塊副標題</label>
                            <input type="text" id="hp-features-subtitle" class="form-control" placeholder="從模擬訓練到實機操作…">
                        </div>
                        <div class="form-group">
                            <label for="hp-feat1-title">特色 1 標題</label>
                            <input type="text" id="hp-feat1-title" class="form-control" placeholder="模擬器飛行訓練">
                            <label for="hp-feat1-desc" style="margin-top: 8px;">特色 1 描述</label>
                            <textarea id="hp-feat1-desc" class="form-control" rows="3"></textarea>
                        </div>
                        <div class="form-group">
                            <label for="hp-feat2-title">特色 2 標題</label>
                            <input type="text" id="hp-feat2-title" class="form-control" placeholder="FPV 穿越機飛行">
                            <label for="hp-feat2-desc" style="margin-top: 8px;">特色 2 描述</label>
                            <textarea id="hp-feat2-desc" class="form-control" rows="3"></textarea>
                        </div>
                        <div class="form-group">
                            <label for="hp-feat3-title">特色 3 標題</label>
                            <input type="text" id="hp-feat3-title" class="form-control" placeholder="空拍與視覺創作">
                            <label for="hp-feat3-desc" style="margin-top: 8px;">特色 3 描述</label>
                            <textarea id="hp-feat3-desc" class="form-control" rows="3"></textarea>
                        </div>
                        <div class="form-group">
                            <label for="hp-feat4-title">特色 4 標題</label>
                            <input type="text" id="hp-feat4-title" class="form-control" placeholder="考照與組裝特訓">
                            <label for="hp-feat4-desc" style="margin-top: 8px;">特色 4 描述</label>
                            <textarea id="hp-feat4-desc" class="form-control" rows="3"></textarea>
                        </div>
                    </div>
                </div>

                <!-- Section 4: CTA & Links -->
                <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-glass); border-radius: 12px; padding: 24px; margin-bottom: 24px;">
                    <h2 style="font-size: 1.1rem; color: #f59e0b; margin-bottom: 16px; display: flex; align-items: center; gap: 8px;"><i data-lucide="link"></i> 4. 頁尾號召與社群連結</h2>
                    <div class="responsive-form-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                        <div class="form-group">
                            <label for="hp-cta-title">CTA 區塊標題</label>
                            <input type="text" id="hp-cta-title" class="form-control" placeholder="準備好起飛了嗎？">
                        </div>
                        <div class="form-group">
                            <label for="hp-cta-desc">CTA 區塊內文</label>
                            <input type="text" id="hp-cta-desc" class="form-control" placeholder="立即加入北科無人機社 LINE 官方社群…">
                        </div>
                        <div class="form-group">
                            <label for="hp-line-link">LINE 社群網址</label>
                            <input type="url" id="hp-line-link" class="form-control" placeholder="https://lin.ee/...">
                        </div>
                        <div class="form-group">
                            <label for="hp-ig-link">Instagram 網址</label>
                            <input type="url" id="hp-ig-link" class="form-control" placeholder="https://www.instagram.com/ntut_drone/">
                        </div>
                        <div class="form-group" style="grid-column: 1 / -1;">
                            <label for="hp-email">官方信箱</label>
                            <input type="email" id="hp-email" class="form-control" placeholder="ntut.droneclub@gmail.com">
                        </div>
                    </div>
                </div>

                <!-- Section 5: Instagram Feed Cards -->
                <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-glass); border-radius: 12px; padding: 24px; margin-bottom: 24px;">
                    <h2 style="font-size: 1.1rem; color: #e1306c; margin-bottom: 16px; display: flex; align-items: center; gap: 8px;"><i data-lucide="instagram"></i> 5. Instagram 社群實飛動態卡片設定 (4 張卡片)</h2>
                    
                    <!-- IG Card 1 -->
                    <div style="background: rgba(0,0,0,0.2); padding: 16px; border-radius: 8px; margin-bottom: 16px; border: 1px solid rgba(255,255,255,0.05);">
                        <h3 style="font-size: 0.95rem; color: #e1306c; margin-bottom: 12px;">📸 卡片 1 (第 1 張貼文)</h3>
                        <div class="responsive-form-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                            <div class="form-group">
                                <label for="hp-ig1-tag">標籤名稱 (如: FPV 穿越機)</label>
                                <input type="text" id="hp-ig1-tag" class="form-control" placeholder="FPV 穿越機">
                            </div>
                            <div class="form-group">
                                <label for="hp-ig1-img">圖片網址 (https:// 開頭，或留空)</label>
                                <input type="text" id="hp-ig1-img" class="form-control" placeholder="/assets/images/fpv_drone_hero.jpg">
                            </div>
                            <div class="form-group" style="grid-column: 1 / -1;">
                                <label for="hp-ig1-caption">貼文文案與 Hashtags</label>
                                <textarea id="hp-ig1-caption" class="form-control" rows="2"></textarea>
                            </div>
                            <div class="form-group">
                                <label for="hp-ig1-likes">按讚數 (Likes)</label>
                                <input type="text" id="hp-ig1-likes" class="form-control" placeholder="158">
                            </div>
                            <div class="form-group">
                                <label for="hp-ig1-comments">留言數 (Comments)</label>
                                <input type="text" id="hp-ig1-comments" class="form-control" placeholder="24">
                            </div>
                        </div>
                    </div>

                    <!-- IG Card 2 -->
                    <div style="background: rgba(0,0,0,0.2); padding: 16px; border-radius: 8px; margin-bottom: 16px; border: 1px solid rgba(255,255,255,0.05);">
                        <h3 style="font-size: 0.95rem; color: #e1306c; margin-bottom: 12px;">📸 卡片 2 (第 2 張貼文)</h3>
                        <div class="responsive-form-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                            <div class="form-group">
                                <label for="hp-ig2-tag">標籤名稱 (如: 航拍創作)</label>
                                <input type="text" id="hp-ig2-tag" class="form-control" placeholder="航拍創作">
                            </div>
                            <div class="form-group">
                                <label for="hp-ig2-img">圖片網址</label>
                                <input type="text" id="hp-ig2-img" class="form-control" placeholder="/assets/images/logo_drone.png">
                            </div>
                            <div class="form-group" style="grid-column: 1 / -1;">
                                <label for="hp-ig2-caption">貼文文案與 Hashtags</label>
                                <textarea id="hp-ig2-caption" class="form-control" rows="2"></textarea>
                            </div>
                            <div class="form-group">
                                <label for="hp-ig2-likes">按讚數 (Likes)</label>
                                <input type="text" id="hp-ig2-likes" class="form-control" placeholder="210">
                            </div>
                            <div class="form-group">
                                <label for="hp-ig2-comments">留言數 (Comments)</label>
                                <input type="text" id="hp-ig2-comments" class="form-control" placeholder="19">
                            </div>
                        </div>
                    </div>

                    <!-- IG Card 3 -->
                    <div style="background: rgba(0,0,0,0.2); padding: 16px; border-radius: 8px; margin-bottom: 16px; border: 1px solid rgba(255,255,255,0.05);">
                        <h3 style="font-size: 0.95rem; color: #e1306c; margin-bottom: 12px;">📸 卡片 3 (第 3 張貼文)</h3>
                        <div class="responsive-form-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                            <div class="form-group">
                                <label for="hp-ig3-tag">標籤名稱 (如: 創客實作)</label>
                                <input type="text" id="hp-ig3-tag" class="form-control" placeholder="創客實作">
                            </div>
                            <div class="form-group">
                                <label for="hp-ig3-img">圖片網址</label>
                                <input type="text" id="hp-ig3-img" class="form-control" placeholder="留空將顯示科技色圖標圖案">
                            </div>
                            <div class="form-group" style="grid-column: 1 / -1;">
                                <label for="hp-ig3-caption">貼文文案與 Hashtags</label>
                                <textarea id="hp-ig3-caption" class="form-control" rows="2"></textarea>
                            </div>
                            <div class="form-group">
                                <label for="hp-ig3-likes">按讚數 (Likes)</label>
                                <input type="text" id="hp-ig3-likes" class="form-control" placeholder="135">
                            </div>
                            <div class="form-group">
                                <label for="hp-ig3-comments">留言數 (Comments)</label>
                                <input type="text" id="hp-ig3-comments" class="form-control" placeholder="12">
                            </div>
                        </div>
                    </div>

                    <!-- IG Card 4 -->
                    <div style="background: rgba(0,0,0,0.2); padding: 16px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
                        <h3 style="font-size: 0.95rem; color: #e1306c; margin-bottom: 12px;">📸 卡片 4 (第 4 張貼文)</h3>
                        <div class="responsive-form-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                            <div class="form-group">
                                <label for="hp-ig4-tag">標籤名稱 (如: 飛行局日常)</label>
                                <input type="text" id="hp-ig4-tag" class="form-control" placeholder="飛行局日常">
                            </div>
                            <div class="form-group">
                                <label for="hp-ig4-img">圖片網址</label>
                                <input type="text" id="hp-ig4-img" class="form-control" placeholder="留空將顯示綠色飛行圖案">
                            </div>
                            <div class="form-group" style="grid-column: 1 / -1;">
                                <label for="hp-ig4-caption">貼文文案與 Hashtags</label>
                                <textarea id="hp-ig4-caption" class="form-control" rows="2"></textarea>
                            </div>
                            <div class="form-group">
                                <label for="hp-ig4-likes">按讚數 (Likes)</label>
                                <input type="text" id="hp-ig4-likes" class="form-control" placeholder="192">
                            </div>
                            <div class="form-group">
                                <label for="hp-ig4-comments">留言數 (Comments)</label>
                                <input type="text" id="hp-ig4-comments" class="form-control" placeholder="31">
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            ` : ''}
            ${manageFinance ? `<div id="panel-finance" class="panel">
                <div class="content-header"><div><h1>財務管理</h1><p style="color:var(--text-muted); margin-top:6px;">收支送審後，只有社長核准才會計入餘額。</p></div><button type="button" class="btn btn-secondary" onclick="exportFinanceCsv()">匯出 CSV</button></div>
                <div class="finance-summary" id="finance-summary"></div>
                <div class="responsive-form-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:20px; margin:24px 0;">
                    <form onsubmit="saveFinanceTransaction(event)" style="display:grid; gap:12px; padding:18px; border:1px solid var(--border-glass); border-radius:12px;">
                        <h2 style="font-size:1.1rem;">新增收支</h2>
                        <input id="finance-date" class="form-control" type="date" required>
                        <input id="finance-item" class="form-control" placeholder="事由，例如：社員社費" maxlength="120" required>
                        <div class="responsive-form-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:12px;"><select id="finance-kind" class="form-control"><option value="income">收入</option><option value="expense">支出</option><option value="transfer">現金／郵局轉帳</option></select><select id="finance-account" class="form-control"><option value="cash">現金帳戶</option><option value="postal">郵局帳戶</option></select></div>
                        <input id="finance-amount" class="form-control" type="number" min="1" step="1" placeholder="金額（新台幣）" required>
                        <select id="finance-budget" class="form-control"><option value="">不歸入預算分類</option></select>
                        <button class="btn btn-primary" type="submit">送交審核</button>
                    </form>
                    <div style="display:grid; gap:12px; padding:18px; border:1px solid var(--border-glass); border-radius:12px;">
                        <h2 style="font-size:1.1rem;">匯入既有帳本</h2>
                        <p style="font-size:.88rem; color:var(--text-muted); line-height:1.6;">支援 CSV 或 TSV（從 Google 試算表／Excel 下載或貼上）。欄位名稱可使用：日期、事宜、收入、支出、現金餘額、郵局餘額、總計。資料會先列為待審核，不會立刻改變餘額。</p>
                        <input id="finance-import-file" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" class="form-control">
                        <textarea id="finance-import-text" class="form-control" rows="4" placeholder="或直接貼上試算表資料（包含第一列標題）"></textarea>
                        <button type="button" class="btn btn-secondary" onclick="importFinanceLedger()">驗證並匯入待審核帳目</button>
                    </div>
                </div>
                <div class="responsive-form-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:24px;">
                    <div style="padding:18px; border:1px solid var(--border-glass); border-radius:12px;"><div style="display:flex; justify-content:space-between; gap:12px; align-items:center;"><h2 style="font-size:1.1rem;">預算分類</h2><button type="button" class="btn btn-secondary" onclick="addBudgetRow()">新增分類</button></div><div id="finance-budgets" style="display:grid; gap:8px; margin-top:14px;"></div><button type="button" class="btn btn-primary" style="margin-top:14px;" onclick="saveBudgets()">儲存預算</button></div>
                    <div style="padding:18px; border:1px solid var(--border-glass); border-radius:12px;"><h2 style="font-size:1.1rem;">匯入既有預算</h2><p style="font-size:.88rem; color:var(--text-muted);">貼上或上傳兩欄資料：<code>分類,預算</code>。例如 <code>器材,20000</code>。</p><input id="budget-import-file" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" class="form-control"><textarea id="budget-import-text" class="form-control" rows="4" placeholder="分類,預算\n器材,20000"></textarea><button type="button" class="btn btn-secondary" style="margin-top:12px;" onclick="importBudgets()">匯入預算分類</button></div>
                </div>
                <h2 style="font-size:1.1rem; margin-bottom:12px;">帳目與審核</h2><div class="table-container"><table><thead><tr><th>日期</th><th>事由</th><th>收入</th><th>支出</th><th>現金變動</th><th>郵局變動</th><th>狀態</th><th>操作</th></tr></thead><tbody id="finance-transactions"></tbody></table></div>
            </div>` : ''}
            ${manageMembers ? `<div id="panel-members" class="panel">
                <div class="content-header"><div><h1>社員管理</h1><p style="color:var(--text-muted); margin-top:6px;">快速匯入、搜尋與維護社員名冊。僅社長與財務可存取。身分與社費依《社員與幹部四級分級細則》及《社費細則》（115.09.01 修訂）判定。</p></div></div>
                <div id="member-summary" class="finance-summary" style="margin-bottom:18px;"></div>
                <div style="margin-bottom:18px; padding:18px; border:1px solid var(--border-glass); border-radius:12px;"><h2 style="font-size:1.05rem; margin-bottom:6px;">大量新增</h2><p style="color:var(--text-muted); font-size:.88rem; margin-bottom:12px;">可匯入社員名冊 CSV／TSV，也能直接貼上社費帳本；系統會辨識欄位、從「事宜」擷取社費繳費者，並提供逐筆修改。重複學號會自動跳過；無學號資料以姓名比對。單次最多 500 筆。</p><div class="responsive-form-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:12px;"><input id="member-import-file" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" class="form-control" onchange="invalidateMemberImport()"><textarea id="member-import-text" class="form-control" rows="4" oninput="invalidateMemberImport()" placeholder="貼上 CSV／TSV，或選擇社費帳本檔案"></textarea></div><div style="display:flex; gap:10px; margin-top:12px;"><button type="button" class="btn btn-secondary" onclick="previewMemberImport()">自動辨識並預覽</button><button id="member-import-submit" type="button" class="btn btn-primary" onclick="submitMemberImport()" disabled>確認新增</button></div><div id="member-import-preview" aria-live="polite" style="margin-top:12px;"></div></div>
                <details style="margin-bottom:18px; padding:16px; border:1px solid var(--border-glass); border-radius:12px;"><summary style="cursor:pointer; font-weight:600;">單筆新增／編輯社員（預設為未繳費的正式社員）</summary><p id="member-editing" style="display:none; margin-top:10px; padding:8px 12px; border-radius:8px; background:rgba(96,165,250,.12); color:#93c5fd;"></p><p style="color:var(--text-muted); font-size:.85rem; margin-top:10px;">先登記、之後再繳費的社員，選「未繳費」即可；記錄社費簽收時會自動更新為已繳費。一年會籍從繳費學期起連續兩學期有效（例如 115-1 繳費，用到 115-2），在學會籍持續有效。正式幹部在任期間具表決權；未繳費的籌備幹部不具表決權。</p><form id="member-form" onsubmit="saveMember(event)" class="responsive-form-grid" style="display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin-top:14px;"><input id="member-edit-id" type="hidden"><input id="member-name" class="form-control" placeholder="姓名（姓名或學號至少填一項）" maxlength="50"><input id="member-student-id" class="form-control" placeholder="學號" maxlength="30"><label style="display:grid; gap:4px; font-size:.85rem; color:var(--text-muted);">社員身分<select id="member-level" class="form-control" onchange="syncMemberForm()"><option value="trial">非正式社員（體驗學員）</option><option value="member" selected>正式社員</option><option value="prep">籌備幹部</option><option value="officer">正式幹部</option></select></label><label style="display:grid; gap:4px; font-size:.85rem; color:var(--text-muted);">社費狀態<select id="member-fee-status" class="form-control" onchange="syncMemberForm()"><option value="unpaid" selected>未繳費</option><option value="semester">一年會籍（500 元）</option><option value="lifetime">在學會籍（1,000 元）</option></select></label><label id="member-fee-semester-wrap" style="display:none; gap:4px; font-size:.85rem; color:var(--text-muted);">會籍學期<input id="member-fee-semester" class="form-control" placeholder="例如 115-1" maxlength="6" pattern="\\d{2,3}-[12]"></label><label id="member-trial-wrap" style="display:none; gap:4px; font-size:.85rem; color:var(--text-muted);">已使用免費體驗社課（本學年，上限 2 次）<input id="member-trial-uses" class="form-control" type="number" min="0" max="99" step="1" value="0"></label><input id="member-position" class="form-control" placeholder="幹部職務（選填，例如 教學技術組-器材）" maxlength="60" list="member-position-options"><datalist id="member-position-options"><option value="社長"><option value="副社長"><option value="活動公關組-活動"><option value="活動公關組-公關"><option value="活動公關組-宣傳"><option value="教學技術組-教學"><option value="教學技術組-器材"><option value="行政庶務組-執秘"><option value="行政庶務組-總務"><option value="行政庶務組-場地"><option value="法規監察委員"></datalist><input id="member-email" class="form-control" type="email" placeholder="Email（選填）" maxlength="100"><input id="member-phone" class="form-control" placeholder="電話（選填）" maxlength="30"><input id="member-joined-at" class="form-control" type="date"><textarea id="member-note" class="form-control" rows="2" maxlength="1000" placeholder="備註（選填）"></textarea><button id="member-submit" class="btn btn-primary" type="submit">新增社員</button><button id="member-reset" class="btn btn-secondary" type="button" onclick="resetMemberForm()">清除表單</button></form></details>
                <div class="responsive-form-grid" style="display:grid; grid-template-columns:minmax(0,2fr) minmax(0,1fr) auto; gap:12px; margin-bottom:14px;"><input id="member-search" class="form-control" placeholder="依姓名、學號、Email、電話或綁定帳號搜尋" oninput="loadMembers()"><select id="member-filter" class="form-control" onchange="loadMembers()" aria-label="篩選社員"><option value="">全部社員</option><option value="unpaid">未繳費社員</option><option value="paid">已繳費</option><option value="voting">具表決權（社員總額）</option><option value="trial">非正式社員</option><option value="member">正式社員</option><option value="prep">籌備幹部</option><option value="officer">正式幹部</option><option value="unbound">未綁定帳號</option></select><button type="button" class="btn btn-secondary" onclick="loadMembers()">查詢</button></div>
                <div id="member-bulk-bar" style="display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-bottom:12px; padding:12px 14px; border:1px solid var(--border-glass); border-radius:12px;"><label style="display:flex; align-items:center; gap:6px; font-weight:600;"><input id="member-select-all" type="checkbox" onchange="toggleAllMembers(this.checked)"> 全選</label><span id="member-selected-count" style="color:var(--text-muted);">尚未選取</span><span style="flex:1 1 auto;"></span><select id="bulk-level" class="form-control" style="width:auto;" aria-label="批次設定身分"><option value="">身分不變</option><option value="trial">非正式社員</option><option value="member">正式社員</option><option value="prep">籌備幹部</option><option value="officer">正式幹部</option></select><select id="bulk-fee-status" class="form-control" style="width:auto;" aria-label="批次設定社費狀態" onchange="document.getElementById('bulk-fee-semester').style.display=this.value==='semester'?'':'none'"><option value="">社費不變</option><option value="unpaid">未繳費</option><option value="semester">一年會籍</option><option value="lifetime">在學會籍</option></select><input id="bulk-fee-semester" class="form-control" style="width:110px; display:none;" placeholder="例 115-1" maxlength="6" aria-label="會籍學期"><button type="button" class="btn btn-primary" onclick="applyBulkMembers()">套用到已選</button><button type="button" class="btn btn-danger" onclick="deleteBulkMembers()">刪除已選</button></div>
                <div class="table-container"><table><thead><tr><th style="width:36px;" aria-label="選取"></th><th>姓名／學號</th><th>身分</th><th>社費</th><th>表決權</th><th>綁定帳號</th><th>幹部職務</th><th>Email／電話</th><th>備註</th><th>加入日期</th><th>操作</th></tr></thead><tbody id="members-list"></tbody></table></div>
                <div style="margin-top:32px; padding:18px; border:1px solid var(--border-glass); border-radius:12px;">
                    <h2 style="font-size:1.15rem;">社費簽收</h2><p style="color:var(--text-muted); margin:6px 0 16px;">記錄繳費者、收款人與收據線索；此簽收紀錄獨立保存，不會自動登成已核准財務帳目。選擇已造冊社員（或填寫名冊中的學號）時，會依繳費方案把該社員更新為已繳費，非正式社員同時轉為正式社員。刪除簽收紀錄不會改回社費狀態，請到社員資料手動調整。</p>
                    <form id="fee-form" onsubmit="createFeeReceipt(event)" class="responsive-form-grid" style="display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin-bottom:20px;"><select id="fee-member" class="form-control" onchange="fillFeePayer()"><option value="">選社員或手動填寫</option></select><input id="fee-payer-name" class="form-control" placeholder="繳費者姓名（或只填學號）" maxlength="50"><input id="fee-student-id" class="form-control" placeholder="繳費者學號" maxlength="30"><input id="fee-amount" class="form-control" type="number" min="1" step="1" placeholder="收取金額（元）" required><select id="fee-type" class="form-control" aria-label="繳費方案" onchange="fillFeeAmount()"><option value="">繳費方案：依金額判斷（500 一年／1,000 在學）</option><option value="semester">一年會籍（500 元）</option><option value="lifetime">在學會籍（1,000 元）</option><option value="other">其他（不更新社費狀態）</option></select><input id="fee-date" class="form-control" type="date" required><input id="fee-receiver" class="form-control" placeholder="收款人姓名（必填）" maxlength="50" required><input id="fee-receipt-number" class="form-control" placeholder="收據編號／收據線索（選填）" maxlength="80"><input id="fee-note" class="form-control" placeholder="備註（選填）" maxlength="500"><button class="btn btn-primary" type="submit">記錄社費簽收</button></form>
                    <div class="table-container"><table><thead><tr><th>日期</th><th>繳費者</th><th>金額／方案</th><th>收款人</th><th>收據資訊</th><th>紀錄人</th><th>操作</th></tr></thead><tbody id="fee-receipts-list"></tbody></table></div>
                </div>
            </div>` : ''}
            ${manageEquipment ? `<div id="panel-equipment" class="panel">
                <div class="content-header"><div><h1>設備管理</h1><p style="color:var(--text-muted); margin-top:6px;">集中列管社團設備、保管狀態與財產編號；可選取多件設備列印標籤。</p></div><button type="button" class="btn btn-secondary" onclick="loadEquipment()">重新載入</button></div>
                <div id="equipment-summary" class="finance-summary" style="margin-bottom:22px;"></div>
                <details id="equipment-form-details" style="margin-bottom:22px; padding:18px; border:1px solid var(--border-glass); border-radius:12px;"><summary style="cursor:pointer; font-weight:600;">新增設備</summary><form id="equipment-form" onsubmit="saveEquipment(event)" class="responsive-form-grid" style="display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin-top:14px;"><input id="equipment-edit-id" type="hidden"><input id="equipment-name" class="form-control" placeholder="設備名稱（必填）" maxlength="100" required><input id="equipment-category" class="form-control" placeholder="分類，例如：空拍機、電池" maxlength="60"><input id="equipment-serial" class="form-control" placeholder="原廠序號（選填）" maxlength="100"><input id="equipment-purchase-date" class="form-control" type="date" aria-label="購入日期"><input id="equipment-price" class="form-control" type="number" min="0" max="1000000000" step="1" placeholder="購入金額（元）"><select id="equipment-condition" class="form-control"><option value="good">狀況良好</option><option value="fair">尚可</option><option value="poor">待維修</option></select><select id="equipment-status" class="form-control"><option value="storage">庫存保管</option><option value="in_use">使用中</option><option value="repair">維修中</option><option value="retired">已除列</option></select><input id="equipment-location" class="form-control" placeholder="存放位置" maxlength="100"><input id="equipment-custodian" class="form-control" placeholder="保管人" maxlength="50"><textarea id="equipment-note" class="form-control" rows="2" placeholder="備註（型號、配件等）" maxlength="1000"></textarea><button id="equipment-save-button" class="btn btn-primary" type="submit">建立列管資料</button><button class="btn btn-secondary" type="button" onclick="resetEquipmentForm()">清除表單</button></form></details>
                <div style="display:flex; gap:10px; align-items:center; margin-bottom:14px; flex-wrap:wrap;"><input id="equipment-search" class="form-control" style="max-width:480px;" placeholder="搜尋編號、名稱、序號、分類、保管人或位置" oninput="loadEquipment()"><select id="equipment-label-size" class="form-control" aria-label="財產標籤尺寸" style="max-width:180px;"><option value="40x20">標籤尺寸：4 × 2 cm</option><option value="20x10">標籤尺寸：2 × 1 cm</option></select><button type="button" class="btn btn-primary" onclick="printSelectedEquipmentLabels()">列印已選標籤 <span id="equipment-selected-count">0</span></button></div>
                <div class="table-container"><table><thead><tr><th><input type="checkbox" aria-label="全選目前設備" onchange="toggleAllEquipment(this.checked)"></th><th>財產編號</th><th>設備／分類</th><th>狀態／狀況</th><th>存放位置／保管人</th><th>購入日期／金額</th><th>操作</th></tr></thead><tbody id="equipment-list"></tbody></table></div>
            </div>` : ''}
            ${viewCms ? `<div id="panel-notes" class="panel">
                <div class="content-header"><div><h1>社課備忘錄</h1><p style="color:var(--text-muted); margin-top:6px;">記錄每次社課重點，集中保存簡報、教材與相關網址。</p></div></div>
                ${user?.role === 'president' || user?.role === 'cadre' ? `<form onsubmit="createNote(event)" style="display:grid; gap:12px; max-width:900px; padding:18px; margin-bottom:24px; border:1px solid var(--border-glass); border-radius:12px;">
                    <h2 style="font-size:1.1rem;">新增社課紀錄</h2>
                    <div class="responsive-form-grid" style="display:grid; grid-template-columns:2fr 1fr; gap:12px;"><input id="note-title" class="form-control" placeholder="社課名稱，例如：焊接與電路基礎" maxlength="120" required><input id="note-date" class="form-control" type="date" required></div>
                    <textarea id="note-content" class="form-control" rows="4" maxlength="5000" placeholder="課程重點、作業或下次社課提醒"></textarea>
                    <div id="note-links" style="display:grid; gap:8px;"><div class="note-link-row responsive-form-grid" style="display:grid; grid-template-columns:1fr 2fr auto; gap:8px;"><input class="form-control note-link-label" placeholder="網址說明，例如：課程投影片" maxlength="100"><input class="form-control note-link-url" type="url" placeholder="https://..." maxlength="2048"><button type="button" class="btn btn-danger" onclick="this.parentElement.remove()" aria-label="移除此網址">移除</button></div></div>
                    <div style="display:flex; gap:10px; flex-wrap:wrap;"><button type="button" class="btn btn-secondary" onclick="addNoteLink()">新增網址欄位</button><button class="btn btn-primary" type="submit">儲存社課紀錄</button></div>
                </form>` : ''}
                <div id="notes-list" style="display:grid; gap:14px;"><p style="color:var(--text-muted);">載入社課紀錄中…</p></div>
            </div>` : ''}
            <div id="panel-forms" class="panel" data-username="${escapeHtml(user?.username || '')}" data-role="${escapeHtml(user?.role || 'member')}">
                <div class="content-header"><div><h1>表單申請</h1><p style="color:var(--text-muted); margin-top:6px;">線上填寫並自動帶入資料，列印成紙本後交由財務長、社長及學校單位簽核；審核以紙本為準。</p><p id="forms-ai-status" class="forms-muted"></p><p class="forms-muted">非社團帳號也能用公開頁面填寫設備借據（不需登入、不提供 AI）：<a href="/forms/equipment-loan" target="_blank" rel="noopener" style="color:var(--color-cyan);">/forms/equipment-loan</a>；送出的借據會出現在下方紀錄並標示「外部填寫」。</p></div></div>
                <div class="forms-tabs" role="tablist" aria-label="表單類型">
                    <button type="button" class="forms-type-tab active" data-type="expense-request">社費事前申請</button>
                    <button type="button" class="forms-type-tab" data-type="expense-report">社費事後報銷</button>
                    <button type="button" class="forms-type-tab" data-type="equipment-loan">設備借據</button>
                    <button type="button" class="forms-type-tab" data-type="activity-application">學生活動申請表</button>
                    <button type="button" class="forms-type-tab" data-type="activity-report">學生活動報告表</button>
                    <button type="button" class="forms-type-tab" data-type="official-letter">公文${viewCms ? '（AI）' : ''}</button>
                </div>
                <form id="forms-editor" class="forms-card" novalidate>
                    <div class="forms-editor-head"><div><h2 id="forms-editor-title" style="font-size:1.15rem;">新增表單</h2><p id="forms-hint" class="forms-muted"></p></div><a id="forms-blank-link" class="btn btn-secondary" href="/admin/forms/blank/expense-request" target="_blank" rel="noopener">列印空白表單</a></div>
                    <div id="forms-tools" class="forms-grid"></div>
                    <div id="forms-fields" class="forms-grid"></div>
                    <div class="forms-buttons"><button id="forms-save-print" type="button" class="btn btn-primary">儲存並列印</button><button id="forms-save" type="button" class="btn btn-secondary">只儲存</button><button id="forms-reset" type="button" class="btn btn-secondary">清空重填</button><button id="forms-cancel-edit" type="button" class="btn btn-secondary" hidden>取消編輯</button></div>
                    <p class="forms-muted" style="margin-top:10px;">填表人、學號、系級、職稱與電話會記在這台裝置，下次自動帶入。列印時請選 A4、縮放 100%，並取消「頁首及頁尾」。</p>
                </form>
                <div class="forms-editor-head" style="margin-top:28px;"><h2 style="font-size:1.15rem;">${viewCms ? '表單紀錄' : '我的表單'}</h2><select id="forms-filter" class="form-control" style="max-width:220px;" aria-label="依表單類型篩選"><option value="">全部類型</option><option value="expense-request">社費事前申請</option><option value="expense-report">社費事後報銷</option><option value="equipment-loan">設備借據</option><option value="activity-application">學生活動申請表</option><option value="activity-report">學生活動報告表</option><option value="official-letter">公文</option></select></div>
                <div class="table-container"><table><thead><tr><th>編號</th><th>表單</th><th>內容</th><th>填表人</th><th>更新日期</th><th>操作</th></tr></thead><tbody id="forms-records"><tr><td colspan="6" style="text-align:center; color:var(--text-muted)">載入中…</td></tr></tbody></table></div>
                ${user?.role === 'president' ? `<details class="forms-card" style="margin-top:24px;"><summary style="cursor:pointer; font-weight:600;">表單設定（列印抬頭與簽核人姓名）</summary><form id="forms-settings" class="forms-grid" style="margin-top:14px;">
                    <label class="forms-field"><span>表單抬頭</span><input class="form-control" name="clubName" maxlength="50" placeholder="國立臺北科技大學 無人機社"></label>
                    <label class="forms-field"><span>社團簡稱（學校表單用）</span><input class="form-control" name="clubShortName" maxlength="50" placeholder="無人機社"></label>
                    <label class="forms-field"><span>社長姓名（借據、公文署名）</span><input class="form-control" name="presidentName" maxlength="50"></label>
                    <label class="forms-field"><span>財產管理人姓名</span><input class="form-control" name="propertyManager" maxlength="50"></label>
                    <label class="forms-field"><span>指導老師</span><input class="form-control" name="advisorName" maxlength="50"></label>
                    <div class="forms-field" style="justify-content:flex-end;"><button class="btn btn-primary" type="submit">儲存設定</button></div>
                </form></details>` : ''}
            </div>
            <!-- Settings Panel -->
            <div id="panel-settings" class="panel ${!viewCms ? 'active' : ''}">
                <div class="content-header">
                    <h1>系統帳號設定</h1>
                </div>
                <div class="forms-card" style="max-width:640px; margin-bottom:24px; padding:18px; border:1px solid var(--border-glass); border-radius:12px;"><h2 style="font-size:1.05rem; margin-bottom:10px;">我的社員資料</h2><div id="my-member" aria-live="polite" style="color:var(--text-muted);">載入中…</div></div>
                
                <form onsubmit="changePassword(event)" style="max-width: 450px;">
                    <div class="form-group">
                        <label for="old-password">目前密碼</label>
                        <input type="password" id="old-password" class="form-control" required>
                    </div>
                    <div class="form-group">
                        <label for="new-password">設定新密碼</label>
                        <input type="password" id="new-password" class="form-control" placeholder="至少 8 位字元" required>
                    </div>
                    <div class="form-group">
                        <label for="new-password-confirm">再次輸入新密碼</label>
                        <input type="password" id="new-password-confirm" class="form-control" required>
                    </div>
                    <button type="submit" class="btn btn-primary" style="margin-top: 10px;">儲存新密碼</button>
                </form>
            </div>
            <div id="panel-regulations" class="panel">
                <div class="content-header"><div><h1>法規查詢</h1><p style="color:var(--text-muted); margin-top:6px;">本社組織章程、三項施行細則（115.09.01 修訂）及學校《學生社團組織及活動實施辦法》。輸入關鍵字可找出相關條文。條文不能直接修改：須提出修正案，依章程或細則規定的會議程序登錄通過後才會更新，並保留修正沿革。</p></div>${viewCms ? '<button type="button" class="btn btn-primary" onclick="openAmendmentForm()">提出修正案</button>' : ''}</div>
                <div class="responsive-form-grid" style="display:grid; grid-template-columns:minmax(0,2fr) minmax(0,1fr); gap:12px; margin-bottom:16px;"><input id="regulation-search" class="form-control" type="search" placeholder="搜尋條文關鍵字" oninput="renderRegulations()"><select id="regulation-doc" class="form-control" onchange="renderRegulations()" aria-label="選擇法規"><option value="">全部法規</option></select></div>
                <div style="display:flex; flex-wrap:wrap; gap:8px; margin:-6px 0 16px;" aria-label="常用關鍵字"><span style="color:var(--text-muted); font-size:.85rem; align-self:center;">常用：</span><button type="button" class="btn btn-secondary" style="padding:4px 12px; font-size:.85rem;" onclick="searchRegulation(this.textContent)">表決權</button><button type="button" class="btn btn-secondary" style="padding:4px 12px; font-size:.85rem;" onclick="searchRegulation(this.textContent)">社費</button><button type="button" class="btn btn-secondary" style="padding:4px 12px; font-size:.85rem;" onclick="searchRegulation(this.textContent)">退費</button><button type="button" class="btn btn-secondary" style="padding:4px 12px; font-size:.85rem;" onclick="searchRegulation(this.textContent)">體驗</button><button type="button" class="btn btn-secondary" style="padding:4px 12px; font-size:.85rem;" onclick="searchRegulation(this.textContent)">社服</button><button type="button" class="btn btn-secondary" style="padding:4px 12px; font-size:.85rem;" onclick="searchRegulation(this.textContent)">幹部</button><button type="button" class="btn btn-secondary" style="padding:4px 12px; font-size:.85rem;" onclick="searchRegulation(this.textContent)">解任</button><button type="button" class="btn btn-secondary" style="padding:4px 12px; font-size:.85rem;" onclick="searchRegulation(this.textContent)">器材</button><button type="button" class="btn btn-secondary" style="padding:4px 12px; font-size:.85rem;" onclick="searchRegulation(this.textContent)">事故</button><button type="button" class="btn btn-secondary" style="padding:4px 12px; font-size:.85rem;" onclick="searchRegulation(this.textContent)">空拍</button><button type="button" class="btn btn-secondary" style="padding:4px 12px; font-size:.85rem;" onclick="searchRegulation('')">清除</button></div>
                ${viewCms ? `<form id="amendment-form" onsubmit="submitAmendment(event)" style="display:none; gap:12px; margin-bottom:20px; padding:16px; border:1px solid var(--border-glass); border-radius:12px;">
                    <h2 style="font-size:1.05rem;">提出修正案</h2>
                    <p style="color:var(--text-muted); font-size:.85rem; margin:0;">送出後只是「提案中」，條文不會改變。要等社長依規定登錄會議表決（章程另需學校核備）後才會生效。</p>
                    <div class="responsive-form-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                        <label style="display:grid; gap:4px; font-size:.85rem; color:var(--text-muted);">要做什麼<select id="amendment-action" class="form-control" onchange="syncAmendmentForm(true)"><option value="amend">修正現有法規</option><option value="create">制定新的施行細則／登錄學校法規</option><option value="repeal">廢止現有細則</option></select></label>
                        <label id="amendment-regulation-wrap" style="display:grid; gap:4px; font-size:.85rem; color:var(--text-muted);">法規<select id="amendment-regulation" class="form-control" onchange="syncAmendmentForm(true)"></select></label>
                        <label id="amendment-kind-wrap" style="display:none; gap:4px; font-size:.85rem; color:var(--text-muted);">類別<select id="amendment-kind" class="form-control" onchange="syncAmendmentForm(false)"><option value="bylaw">施行細則（幹部會議通過、社長核定）</option><option value="school">學校法規（照學校公告登錄）</option></select></label>
                    </div>
                    <div id="amendment-procedure" style="padding:10px 12px; border-radius:8px; background:rgba(96,165,250,.1); color:#bfdbfe; font-size:.88rem; line-height:1.6;"></div>
                    <div id="amendment-source-wrap" class="responsive-form-grid" style="display:none; grid-template-columns:1fr 1fr; gap:12px;"><label style="display:grid; gap:4px; font-size:.85rem; color:var(--text-muted);">提案來源（章程第十三條）<select id="amendment-source" class="form-control" onchange="syncAmendmentForm(false)"><option value="committee">法規監察委員會提出</option><option value="petition">正式社員連署提出</option></select></label><label id="amendment-signers-wrap" style="display:none; gap:4px; font-size:.85rem; color:var(--text-muted);">連署人數（至少 5 人）<input id="amendment-signers" class="form-control" type="number" min="0" step="1"></label></div>
                    <label id="amendment-assembly-wrap" style="display:none; align-items:center; gap:8px; font-size:.9rem;"><input id="amendment-needs-assembly" type="checkbox" onchange="syncAmendmentForm(false)"> 涉及社員權利義務之重大變更或社費標準，需提社員大會</label>
                    <input id="amendment-title" class="form-control" placeholder="法規名稱" maxlength="120">
                    <textarea id="amendment-content" class="form-control" rows="14" maxlength="50000" placeholder="修正後的完整條文。每條以「第一條」或「壹、」開頭另起一行。" oninput="renderAmendmentDiff()"></textarea>
                    <details id="amendment-diff-wrap"><summary style="cursor:pointer;">預覽與現行條文的差異</summary><div id="amendment-diff" style="margin-top:8px;"></div></details>
                    <textarea id="amendment-reason" class="form-control" rows="3" maxlength="2000" placeholder="修正理由（必填）：為什麼要改、改了什麼" required></textarea>
                    <div style="display:flex; gap:10px; flex-wrap:wrap;"><button class="btn btn-primary" type="submit">送出提案</button><button class="btn btn-secondary" type="button" onclick="closeAmendmentForm()">取消</button></div>
                </form>` : ''}
                <div id="amendment-list" style="margin-bottom:20px;"></div>
                <div id="regulation-results" aria-live="polite"></div>
            </div>
            ${user?.role === 'president' ? `<div id="panel-users" class="panel">
                <div class="content-header"><h1>帳號與權限</h1></div>
                <form onsubmit="createUser(event)" style="display:grid; gap:12px; max-width:520px; margin-bottom:24px;">
                    <input id="account-username" class="form-control" placeholder="帳號（英數字，至少 3 位）" required>
                    <input id="account-password" type="password" class="form-control" placeholder="初始密碼（至少 8 位）" minlength="8" required>
                    <select id="account-role" class="form-control"><option value="president">社長</option><option value="finance">財務</option><option value="cadre">一般幹部</option><option value="member">社員</option></select>
                    <select id="account-member" class="form-control" aria-label="綁定社員"><option value="">不綁定社員（之後可再綁定）</option></select>
                    <button class="btn btn-primary" type="submit">新增帳號</button>
                </form>
                <p style="color:var(--text-muted); font-size:.88rem; margin-bottom:12px;">每個帳號可綁定一位社員名冊資料，綁定後該帳號可在「系統設定」查看自己的身分、社費與表決權狀態。一位社員只能綁定一個帳號；刪除社員會自動解除綁定。變更綁定不會讓對方登出。</p>
                <div class="table-container"><table><thead><tr><th>帳號</th><th>角色</th><th>狀態</th><th>綁定社員</th><th>操作</th></tr></thead><tbody id="users-list"></tbody></table></div>
            </div>` : ''}
        </div>

        <nav class="mobile-tabbar" aria-label="後台快捷導覽">
            ${viewCms ? `<button type="button" class="mobile-tab" data-panel="posts"><i data-lucide="book-open"></i><span>文章</span></button>` : ''}
            <button type="button" class="mobile-tab" data-panel="forms" data-loader="loadForms"><i data-lucide="file-pen-line"></i><span>表單</span></button>
            ${manageEquipment ? `<button type="button" class="mobile-tab" data-panel="equipment" data-loader="loadEquipment"><i data-lucide="package-check"></i><span>設備</span></button>` : ''}
            ${manageMembers ? `<button type="button" class="mobile-tab" data-panel="members" data-loader="loadMembers"><i data-lucide="contact-round"></i><span>社員</span></button>` : ''}
            <button type="button" class="mobile-tab" data-panel="settings" data-loader="loadMyMember"><i data-lucide="settings"></i><span>設定</span></button>
            <button type="button" class="mobile-tab" onclick="toggleAdminMenu()" aria-label="更多選單"><i data-lucide="menu"></i><span>更多</span></button>
        </nav>

        <!-- Toast Notice -->
        <div id="toast">
            <i data-lucide="check-circle" style="color: var(--color-cyan); width: 20px; height: 20px;"></i>
            <span id="toast-text">操作成功</span>
        </div>

        <script src="/admin.js"></script>
        <script src="/admin-forms.js" defer></script>
        <script src="/admin-meetings.js" defer></script>
        <script src="/admin-ai.js" defer></script>
        <script src="/admin-messages.js" defer></script>
        <script src="/admin-notifications.js" defer></script>
        <script src="/admin-mobile.js" defer></script>
    </body>
    </html>
    `;
}
