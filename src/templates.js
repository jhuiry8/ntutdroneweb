// NTUT Drone Club CMS - HTML Templates

// Helper: Common Header
function getHeader(title) {
    return `
    <!DOCTYPE html>
    <html lang="zh-TW">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title} | 北科無人機社 NTUT Drone Club</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@300;400;500;700;900&family=Outfit:wght@300;400;600;800&display=swap" rel="stylesheet">
        <script src="https://unpkg.com/lucide@latest"></script>
        <link rel="stylesheet" href="/style.css">
    </head>
    <body>
        <canvas id="telemetry-bg"></canvas>
        <header class="navbar scrolled">
            <div class="nav-container">
                <a href="/" class="logo">
                    <span class="logo-icon"><i data-lucide="navigation"></i></span>
                    <div class="logo-text">
                        <span class="brand-en">NTUT DRONE</span>
                        <span class="brand-zh">北科無人機社</span>
                    </div>
                </a>
                <nav class="nav-links">
                    <a href="/#about" class="nav-link">關於我們</a>
                    <a href="/#features" class="nav-link">社團特色</a>
                    <a href="/blog" class="nav-link">部落格文章</a>
                    <a href="/#faq" class="nav-link">常見問題</a>
                </nav>
                <div class="nav-socials">
                    <a href="https://www.instagram.com/ntut_drone/" target="_blank" class="social-icon-btn ig"><i data-lucide="instagram"></i></a>
                    <a href="https://lin.ee/s5YJgGI" target="_blank" class="social-icon-btn line"><i data-lucide="message-square"></i></a>
                    <a href="/admin" class="cta-nav-btn"><i data-lucide="user"></i> 後台管理</a>
                </div>
            </div>
        </header>
    `;
}

// Helper: Common Footer
function getFooter() {
    return `
        <footer>
            <div class="footer-container">
                <div class="footer-brand">
                    <a href="#" class="logo">
                        <span class="logo-icon"><i data-lucide="navigation"></i></span>
                        <span class="logo-text">
                            <span class="brand-en">NTUT DRONE</span>
                            <span class="brand-zh">北科無人機社</span>
                        </span>
                    </a>
                    <p class="footer-desc">國立臺北科技大學學生社團 - 提供最專業的無人機飛行體驗、FPV 技術交流與空拍藝術創作平台。</p>
                </div>
                <div class="footer-links-group">
                    <div class="footer-col">
                        <h4>快速導覽</h4>
                        <a href="/">回到首頁</a>
                        <a href="/blog">部落格文章</a>
                        <a href="https://lin.ee/s5YJgGI" target="_blank">LINE 社群</a>
                    </div>
                </div>
            </div>
            <div class="footer-bottom">
                <p>&copy; 2026 北科無人機社 NTUT Drone Club. All rights reserved.</p>
            </div>
        </footer>
        <script src="/main.js"></script>
    </body>
    </html>
    `;
}

// 1. Render Landing Page with Dynamic Blog Posts
export function renderLandingPage(latestPosts = []) {
    let postsHtml = '';
    
    if (latestPosts.length === 0) {
        postsHtml = `
            <div class="about-card text-center" style="grid-column: span 3; padding: 40px;">
                <i data-lucide="book-open" style="width: 48px; height: 48px; color: var(--color-cyan); margin-bottom: 16px;"></i>
                <p>目前尚無發佈的文章，敬請期待！</p>
            </div>
        `;
    } else {
        latestPosts.forEach(post => {
            const dateStr = new Date(post.date).toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });
            postsHtml += `
                <div class="about-card" style="display: flex; flex-direction: column; justify-content: space-between;">
                    <div>
                        <span style="font-size: 0.8rem; color: var(--color-cyan); font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">${dateStr}</span>
                        <h3 style="margin-top: 8px; margin-bottom: 12px; font-size: 1.25rem;">${post.title}</h3>
                        <p style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 20px;">${post.summary || ''}</p>
                    </div>
                    <a href="/blog/${post.slug}" class="cta-nav-btn" style="text-align: center; display: block; width: 100%;">閱讀全文 <i data-lucide="arrow-right" style="width: 14px; height: 14px; display: inline; vertical-align: middle;"></i></a>
                </div>
            `;
        });
    }

    return `
    <!DOCTYPE html>
    <html lang="zh-TW">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta name="description" content="北科無人機社 (NTUT Drone Club) - 探索天空的無限可能。我們提供模擬器練習、FPV 穿越機飛行、空拍體驗與專業組裝考照課程，歡迎對無人機有興趣的北科同學加入！">
        <meta name="keywords" content="北科無人機社, NTUT Drone Club, 無人機, FPV, 穿越機, 空拍, 模擬器, 台北科技大學, 社團">
        <meta property="og:title" content="北科無人機社 | NTUT Drone Club">
        <meta property="og:description" content="探索天空的無限可能，啟動你的飛行夢想！北科無人機社提供模擬飛行、FPV 穿越機、空拍創作與證照輔導。">
        <meta property="og:image" content="/assets/images/fpv_drone_hero.jpg">
        <meta property="og:type" content="website">
        <title>北科無人機社 | NTUT Drone Club</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@300;400;500;700;900&family=Outfit:wght@300;400;600;800&display=swap" rel="stylesheet">
        <script src="https://unpkg.com/lucide@latest"></script>
        <link rel="stylesheet" href="/style.css">
    </head>
    <body>
        <canvas id="telemetry-bg"></canvas>

        <header class="navbar">
            <div class="nav-container">
                <a href="#" class="logo">
                    <span class="logo-icon"><i data-lucide="navigation"></i></span>
                    <div class="logo-text">
                        <span class="brand-en">NTUT DRONE</span>
                        <span class="brand-zh">北科無人機社</span>
                    </div>
                </a>
                
                <nav class="nav-links">
                    <a href="#about" class="nav-link">關於我們</a>
                    <a href="#features" class="nav-link">社團特色</a>
                    <a href="#dynamic-blog" class="nav-link">最新文章</a>
                    <a href="#faq" class="nav-link">常見問題</a>
                </nav>

                <div class="nav-socials">
                    <a href="https://www.instagram.com/ntut_drone/" target="_blank" aria-label="Instagram" class="social-icon-btn ig">
                        <i data-lucide="instagram"></i>
                    </a>
                    <a href="https://lin.ee/s5YJgGI" target="_blank" aria-label="LINE" class="social-icon-btn line">
                        <i data-lucide="message-square"></i>
                    </a>
                    <a href="https://lin.ee/s5YJgGI" target="_blank" class="cta-nav-btn">加入我們</a>
                    <button class="mobile-menu-toggle" aria-label="Toggle menu">
                        <i data-lucide="menu"></i>
                    </button>
                </div>
            </div>
        </header>

        <div class="mobile-drawer">
            <div class="drawer-header">
                <span class="drawer-logo"><i data-lucide="navigation"></i> NTUT DRONE</span>
                <button class="drawer-close"><i data-lucide="x"></i></button>
            </div>
            <nav class="drawer-links">
                <a href="#about" class="drawer-link">關於我們</a>
                <a href="#features" class="drawer-link">社團特色</a>
                <a href="#dynamic-blog" class="drawer-link">最新文章</a>
                <a href="#faq" class="drawer-link">常見問題</a>
                <hr class="drawer-divider">
                <a href="https://lin.ee/s5YJgGI" target="_blank" class="drawer-cta-btn"><i data-lucide="message-square"></i> LINE 聯絡加入</a>
                <a href="https://www.instagram.com/ntut_drone/" target="_blank" class="drawer-cta-btn secondary"><i data-lucide="instagram"></i> 追蹤 Instagram</a>
            </nav>
        </div>

        <section class="hero-section" id="home">
            <div class="hero-container">
                <div class="hero-content">
                    <div class="badge glow-pulse">
                        <span class="badge-dot"></span> 2026 新生招生中
                    </div>
                    <h1 class="hero-title">
                        <span class="gradient-text">NTUT DRONE</span>
                        <span class="sub-title">北科無人機社</span>
                    </h1>
                    <p class="hero-description">
                        探索上帝視角的無限精彩，啟動你的飛翔夢想！我們是一群對無人機、FPV 穿越機、模擬器練習與空拍創作充滿熱情的北科人。無論你是零基礎的飛行小白，還是喜愛電控調參的技術極客，這裡都有你的藍天！
                    </p>
                    <div class="hero-actions">
                        <a href="https://lin.ee/s5YJgGI" target="_blank" class="btn btn-primary">
                            <i data-lucide="user-plus"></i> 立即加入 LINE 群
                        </a>
                        <a href="https://www.instagram.com/ntut_drone/" target="_blank" class="btn btn-secondary">
                            <i data-lucide="instagram"></i> 追蹤 Instagram
                        </a>
                    </div>
                </div>
                
                <div class="hero-image-wrapper">
                    <div class="drone-glowing-ring"></div>
                    <img src="/assets/images/fpv_drone_hero.jpg" alt="FPV Racing Drone" class="hero-drone-img" id="hero-drone">
                    <div class="drone-stats-card">
                        <div class="stats-icon"><i data-lucide="cpu"></i></div>
                        <div class="stats-info">
                            <span class="stats-label">Telemetry Status</span>
                            <span class="stats-value">CONNECTED (100%)</span>
                        </div>
                    </div>
                </div>
            </div>
        </section>

        <!-- Stats Bar -->
        <section class="stats-bar-section">
            <div class="stats-bar-container">
                <div class="stat-item">
                    <span class="stat-num" data-val="100">0</span><span class="stat-plus">+</span>
                    <span class="stat-label">累積模擬飛行時數</span>
                </div>
                <div class="stat-item">
                    <span class="stat-num" data-val="30">0</span><span class="stat-plus">+</span>
                    <span class="stat-label">戶外實飛活動</span>
                </div>
                <div class="stat-item">
                    <span class="stat-num" data-val="25">0</span><span class="stat-plus">+</span>
                    <span class="stat-label">現役活躍社員</span>
                </div>
                <div class="stat-item">
                    <span class="stat-num" data-val="4">0</span><span class="stat-plus"></span>
                    <span class="stat-label">核心專業培訓領域</span>
                </div>
            </div>
        </section>

        <!-- About Section -->
        <section class="about-section" id="about">
            <div class="section-container">
                <div class="section-header text-center">
                    <h2 class="section-title">關於北科無人機社</h2>
                    <p class="section-subtitle">我們不僅僅是在空中飛行，更是將科技、美學與極限運動完美融合。</p>
                </div>
                
                <div class="about-grid">
                    <div class="about-card">
                        <div class="about-card-icon"><i data-lucide="shield-check"></i></div>
                        <h3>安全第一的飛行教育</h3>
                        <p>社團擁有完備的初學者安全防護指引，並從電競級電腦模擬器開始，協助社員熟悉遙控器操縱桿手感與氣流反應，大幅降低實機飛行時的「摔機」率與風險。</p>
                    </div>
                    
                    <div class="about-card">
                        <div class="about-card-icon"><i data-lucide="wrench"></i></div>
                        <h3>動手實作的創客精神</h3>
                        <p>我們鼓勵社員探索無人機內部的奧秘。從碳纖維機架安裝、無刷馬達配線焊接，到 Betaflight 與 ArduPilot 的 PID 調參，親手組裝專屬於你獨一無二的無人機。</p>
                    </div>
                    
                    <div class="about-card">
                        <div class="about-card-icon"><i data-lucide="users"></i></div>
                        <h3>緊密的飛友社群</h3>
                        <p>社團不定期發起戶外「飛行局」，在符合民航局法規的安全合法飛場進行實地切磋交流，不論是休閒空拍還是高速穿越，大家都是你最可靠的僚機。</p>
                    </div>
                </div>
            </div>
        </section>

        <!-- Features Section -->
        <section class="features-section" id="features">
            <div class="section-container">
                <div class="section-header text-center">
                    <h2 class="section-title">四大核心特色</h2>
                    <p class="section-subtitle">從模擬訓練到實機操作，從娛樂航拍到專業考照，提供最全方位的無人機學習地圖。</p>
                </div>

                <div class="features-grid">
                    <!-- Feature 1 -->
                    <div class="feature-item-card">
                        <div class="feature-visual">
                            <div class="feature-icon-wrapper cyan">
                                <i data-lucide="monitor-play"></i>
                            </div>
                        </div>
                        <div class="feature-info">
                            <h3 class="feature-name">模擬器飛行訓練</h3>
                            <p class="feature-desc">使用 Liftoff、Velocidrone 等專業飛行模擬軟體，配合真實航模遙控器。在零成本、零摔機風險的環境下，迅速建立大腦與手指的肌肉記憶，掌握 3D 空間姿態控制。</p>
                        </div>
                    </div>

                    <!-- Feature 2 -->
                    <div class="feature-item-card">
                        <div class="feature-visual">
                            <div class="feature-icon-wrapper purple">
                                <i data-lucide="eye"></i>
                            </div>
                        </div>
                        <div class="feature-info">
                            <h3 class="feature-name">FPV 穿越機飛行</h3>
                            <p class="feature-desc">戴上 FPV 飛行眼鏡，以第一人稱視角賽車般操控飛行！以超過時速 100 公里的極速穿梭於障礙物之間，體驗翻滾、俯衝等高難度花式特技，感受絕對的自由與速度感。</p>
                        </div>
                    </div>

                    <!-- Feature 3 -->
                    <div class="feature-item-card">
                        <div class="feature-visual">
                            <div class="feature-icon-wrapper green">
                                <i data-lucide="aperture"></i>
                            </div>
                        </div>
                        <div class="feature-info">
                            <h3 class="feature-name">空拍與視覺創作</h3>
                            <p class="feature-desc">教授 DJI 等多軸航拍機的操作、智能飛行模式應用與安全空域申報。結合鏡頭語言與運鏡技巧，帶領大家捕捉壯麗的山海與校園美景，並分享影片後製與 Vlog 剪輯工作流。</p>
                        </div>
                    </div>

                    <!-- Feature 4 -->
                    <div class="feature-item-card">
                        <div class="feature-visual">
                            <div class="feature-icon-wrapper yellow">
                                <i data-lucide="award"></i>
                            </div>
                        </div>
                        <div class="feature-info">
                            <h3 class="feature-name">機體組裝與證照輔導</h3>
                            <p class="feature-desc">從零教學無人機電路結構、馬達、電調（ESC）與圖傳系統的原理與焊接組裝。同時輔導民航局 CAA 遙控無人機操作證照（學科與術科），協助社員取得專業執照。</p>
                        </div>
                    </div>
                </div>
            </div>
        </section>

        <!-- Dynamic Blog Section -->
        <section class="about-section" id="dynamic-blog" style="background: var(--bg-darker);">
            <div class="section-container">
                <div class="section-header text-center">
                    <h2 class="section-title">最新公告與文章</h2>
                    <p class="section-subtitle">閱讀我們最新的社團公告、學習筆記與飛行花絮。</p>
                </div>
                <div class="about-grid">
                    ${postsHtml}
                </div>
                <div class="text-center" style="margin-top: 40px;">
                    <a href="/blog" class="btn btn-secondary">查看所有文章 <i data-lucide="arrow-right"></i></a>
                </div>
            </div>
        </section>

        <!-- FAQ Section -->
        <section class="faq-section" id="faq">
            <div class="section-container">
                <div class="section-header text-center">
                    <h2 class="section-title">常見問題 FAQ</h2>
                    <p class="section-subtitle">為你解答關於加入社團的所有疑惑。</p>
                </div>

                <div class="faq-accordion-wrapper">
                    <div class="faq-card">
                        <button class="faq-question">
                            <span>Q1. 加入社團需要自己購買無人機或昂貴設備嗎？</span>
                            <span class="faq-icon"><i data-lucide="chevron-down"></i></span>
                        </button>
                        <div class="faq-answer">
                            <p>不需要！社團內備有專業的多軸無人機、FPV 穿越機、模擬器練習專用遙控器以及飛行眼鏡等設備，供社員在課堂與飛行局中練習使用。建議等熟悉各種機種後，再根據個人興趣在學長姐協助下購買合適的設備。</p>
                        </div>
                    </div>

                    <div class="faq-card">
                        <button class="faq-question">
                            <span>Q2. 完全沒有飛行經驗的「零基礎小白」可以加入嗎？</span>
                            <span class="faq-icon"><i data-lucide="chevron-down"></i></span>
                        </button>
                        <div class="faq-answer">
                            <p>非常歡迎！社團大部分的新社員都是從零開始。我們有一套完善的「新手培訓流程」：先在電腦模擬器上累積足夠的安全操作時數，學會修正航向與起降技巧後，才會在幹部的陪同指導下進行實機操作，安全又好上手！</p>
                        </div>
                    </div>

                    <div class="faq-card">
                        <button class="faq-question">
                            <span>Q3. 無人機社的課表跟時間通常怎麼安排？</span>
                            <span class="faq-icon"><i data-lucide="chevron-down"></i></span>
                        </button>
                        <div class="faq-answer">
                            <p>我們的室內社課（包含模擬器特訓、組裝教學、法規與學科知識）通常安排在每週三的晚上。而戶外實飛活動（飛行局）則多選在週末白天，帶大家前往新北或桃園等合法合規的綠地飛場進行實地空拍與穿越機飛行。</p>
                        </div>
                    </div>

                    <div class="faq-card">
                        <button class="faq-question">
                            <span>Q4. 社團會輔導民航局 CAA 證照嗎？</span>
                            <span class="faq-icon"><i data-lucide="chevron-down"></i></span>
                        </button>
                        <div class="faq-answer">
                            <p>是的！針對想要將無人機技能專業化的社員，社團會提供民航局無人機操作證照（學科與術科）的考試指南與練習指導，幫助大家合法合規地在專業領域進行空拍與飛行業務。</p>
                        </div>
                    </div>
                </div>
            </div>
        </section>

        <!-- Call to Action Banner -->
        <section class="cta-section">
            <div class="cta-glow-bg"></div>
            <div class="cta-container">
                <h2 class="cta-title">準備好與我們一起起飛了嗎？</h2>
                <p class="cta-text">不論你想成為空拍導演、賽道穿越機車手，還是無人機工程師，北科無人機社都是你的起點！現在就加入我們的官方 LINE 社群，第一時間獲取期初大會與體驗課訊息！</p>
                <div class="cta-buttons">
                    <a href="https://lin.ee/s5YJgGI" target="_blank" class="btn btn-line btn-large glow-pulse">
                        <i data-lucide="message-square"></i> 點我加入官方 LINE 社群
                    </a>
                    <a href="https://www.instagram.com/ntut_drone/" target="_blank" class="btn btn-secondary btn-large">
                        <i data-lucide="instagram"></i> 追蹤社團 Instagram
                    </a>
                </div>
            </div>
        </section>

        <footer>
            <div class="footer-container">
                <div class="footer-brand">
                    <a href="#" class="logo">
                        <span class="logo-icon"><i data-lucide="navigation"></i></span>
                        <span class="logo-text">
                            <span class="brand-en">NTUT DRONE</span>
                            <span class="brand-zh">北科無人機社</span>
                        </span>
                    </a>
                    <p class="footer-desc">國立臺北科技大學學生社團 - 提供最專業的無人機飛行體驗、FPV 技術交流與空拍藝術創作平台。</p>
                    <div class="footer-socials">
                        <a href="https://www.instagram.com/ntut_drone/" target="_blank" aria-label="Instagram"><i data-lucide="instagram"></i></a>
                        <a href="https://lin.ee/s5YJgGI" target="_blank" aria-label="LINE"><i data-lucide="message-square"></i></a>
                    </div>
                </div>
                
                <div class="footer-links-group">
                    <div class="footer-col">
                        <h4>快速導覽</h4>
                        <a href="#home">回到首頁</a>
                        <a href="#about">關於我們</a>
                        <a href="#features">社團特色</a>
                        <a href="#dynamic-blog">最新文章</a>
                    </div>
                    <div class="footer-col">
                        <h4>聯絡資訊</h4>
                        <span>社辦地點：活動中心 (學生活動大樓)</span>
                        <span>聯絡信箱：ntutdrone@gmail.com</span>
                        <a href="https://lin.ee/s5YJgGI" target="_blank" class="footer-highlight-link">官方 LINE 諮詢 <i data-lucide="arrow-up-right"></i></a>
                        <a href="/admin" class="footer-highlight-link" style="color: var(--color-purple) !important; margin-top: 10px;">管理後台 <i data-lucide="lock"></i></a>
                    </div>
                </div>
            </div>
            <div class="footer-bottom">
                <p>&copy; 2026 國立臺北科技大學無人機社 NTUT Drone Club. All rights reserved.</p>
                <p class="developer-tag">Designed with <i data-lucide="heart" class="heart-icon"></i> for NTUT</p>
            </div>
        </footer>

        <script src="/main.js"></script>
    </body>
    </html>
    `;
}

// 2. Render Blog List Page
export function renderBlogList(posts = []) {
    let postsListHtml = '';
    
    if (posts.length === 0) {
        postsListHtml = `
            <div class="about-card text-center" style="grid-column: span 3; padding: 80px 40px;">
                <i data-lucide="book-open" style="width: 64px; height: 64px; color: var(--color-cyan); margin-bottom: 24px; opacity: 0.5;"></i>
                <h3>尚無文章</h3>
                <p style="color: var(--text-muted); margin-top: 8px;">社團小編正在積極準備文章中，敬請期待！</p>
            </div>
        `;
    } else {
        posts.forEach(post => {
            const dateStr = new Date(post.date).toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });
            postsListHtml += `
                <article class="about-card" style="display: flex; flex-direction: column; justify-content: space-between;">
                    <div>
                        <span style="font-size: 0.85rem; color: var(--color-cyan); font-weight: 600;">${dateStr}</span>
                        <h3 style="margin-top: 10px; margin-bottom: 14px; font-size: 1.4rem; line-height: 1.3;">${post.title}</h3>
                        <p style="color: var(--text-secondary); font-size: 0.95rem; margin-bottom: 24px; line-height: 1.6;">${post.summary || ''}</p>
                    </div>
                    <a href="/blog/${post.slug}" class="btn btn-secondary" style="width: 100%; text-align: center; padding: 10px;">閱讀文章 <i data-lucide="arrow-right"></i></a>
                </article>
            `;
        });
    }

    return `
        ${getHeader('所有文章')}
        <main style="padding-top: 140px; min-height: 80vh;">
            <div class="section-container">
                <div class="section-header text-center">
                    <h1 class="section-title">部落格與公告</h1>
                    <p class="section-subtitle">探索無人機飛行心得、穿越機組裝技術分享與最新社團活動記錄。</p>
                </div>
                <div class="about-grid" style="grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 30px;">
                    ${postsListHtml}
                </div>
            </div>
        </main>
        ${getFooter()}
    `;
}

// 3. Render Blog Post Detail Page (supports markdown content rendering)
export function renderBlogPost(post, parsedContentHtml) {
    const dateStr = new Date(post.date).toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });
    return `
        ${getHeader(post.title)}
        <main style="padding-top: 140px; min-height: 80vh;">
            <article class="section-container" style="max-width: 800px; padding: 40px 24px;">
                <div style="margin-bottom: 40px; border-bottom: 1px solid var(--border-glass); padding-bottom: 30px;">
                    <a href="/blog" style="color: var(--color-cyan); display: inline-flex; align-items: center; gap: 6px; font-weight: 500; margin-bottom: 20px; font-size: 0.95rem;">
                        <i data-lucide="arrow-left" style="width: 16px; height: 16px;"></i> 回文章列表
                    </a>
                    <h1 style="font-size: 2.75rem; font-weight: 800; line-height: 1.25; margin-bottom: 16px; background: linear-gradient(135deg, #fff, var(--text-secondary)); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">${post.title}</h1>
                    <div style="display: flex; gap: 20px; color: var(--text-muted); font-size: 0.9rem;">
                        <span><i data-lucide="calendar" style="width: 14px; height: 14px; display: inline; vertical-align: middle; margin-right: 4px;"></i> ${dateStr}</span>
                    </div>
                </div>
                
                <div class="markdown-body" style="font-size: 1.05rem; line-height: 1.8; color: var(--text-secondary);">
                    ${parsedContentHtml}
                </div>
            </article>
        </main>
        
        <style>
            /* Custom markdown styles fitting the dark template */
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
            .markdown-body p {
                margin-bottom: 20px;
            }
            .markdown-body ul, .markdown-body ol {
                margin-bottom: 20px;
                padding-left: 24px;
            }
            .markdown-body ul {
                list-style-type: disc;
            }
            .markdown-body ol {
                list-style-type: decimal;
            }
            .markdown-body li {
                margin-bottom: 6px;
            }
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
            .markdown-body a {
                color: var(--color-cyan);
                text-decoration: underline;
            }
            .markdown-body a:hover {
                color: var(--color-purple);
            }
        </style>
        ${getFooter()}
    `;
}

// 4. Render Dynamic Custom Page Page
export function renderCustomPage(page, parsedContentHtml) {
    return `
        ${getHeader(page.title)}
        <main style="padding-top: 140px; min-height: 80vh;">
            <article class="section-container" style="max-width: 900px; padding: 40px 24px;">
                <h1 style="font-size: 3rem; font-weight: 900; margin-bottom: 40px; border-bottom: 1px solid var(--border-glass); padding-bottom: 20px; background: linear-gradient(135deg, #fff, var(--color-cyan)); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">${page.title}</h1>
                <div class="markdown-body" style="font-size: 1.05rem; line-height: 1.8; color: var(--text-secondary);">
                    ${parsedContentHtml}
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
            .markdown-body p {
                margin-bottom: 20px;
            }
            .markdown-body img {
                max-width: 100%;
                border-radius: 16px;
                border: 1px solid var(--border-glass);
                margin: 30px 0;
            }
            .markdown-body a {
                color: var(--color-cyan);
                text-decoration: underline;
            }
        </style>
        ${getFooter()}
    `;
}

// 5. Render Admin Login Page
export function renderLogin(errorMessage = '') {
    return `
    <!DOCTYPE html>
    <html lang="zh-TW">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>後台登入 | 北科無人機社</title>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;700&family=Outfit:wght@400;600;800&display=swap" rel="stylesheet">
        <script src="https://unpkg.com/lucide@latest"></script>
        <link rel="stylesheet" href="/style.css">
        <style>
            body {
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                background: #07090e;
            }
            .login-container {
                width: 100%;
                max-width: 400px;
                padding: 40px 30px;
                background: rgba(18, 24, 38, 0.65);
                border: 1px solid var(--border-glass);
                border-radius: 24px;
                backdrop-filter: blur(16px);
                box-shadow: 0 20px 50px rgba(0,0,0,0.5), 0 0 30px rgba(0, 240, 255, 0.05);
            }
            .form-group {
                margin-bottom: 20px;
            }
            .form-group label {
                display: block;
                font-size: 0.85rem;
                color: var(--text-secondary);
                margin-bottom: 8px;
                font-weight: 500;
            }
            .form-control {
                width: 100%;
                padding: 12px 16px;
                background: rgba(255,255,255,0.03);
                border: 1px solid var(--border-glass);
                border-radius: 12px;
                color: #fff;
                font-family: inherit;
                font-size: 1rem;
                transition: var(--transition-fast);
            }
            .form-control:focus {
                outline: none;
                border-color: var(--color-cyan);
                box-shadow: 0 0 10px rgba(0, 240, 255, 0.2);
            }
        </style>
    </head>
    <body>
        <canvas id="telemetry-bg"></canvas>
        <div class="login-container">
            <div class="text-center" style="margin-bottom: 30px;">
                <div class="logo-icon" style="margin: 0 auto 16px auto; width: 50px; height: 50px; border-radius: 12px;">
                    <i data-lucide="lock" style="width: 24px; height: 24px;"></i>
                </div>
                <h2 style="font-size: 1.5rem; font-weight: 800; letter-spacing: 0.5px;">系統後台登入</h2>
                <p style="color: var(--text-muted); font-size: 0.85rem; margin-top: 4px;">北科無人機社網頁管理系統</p>
            </div>
            
            ${errorMessage ? `<div style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; padding: 12px; border-radius: 12px; font-size: 0.875rem; margin-bottom: 20px; text-align: center;"><i data-lucide="alert-circle" style="width: 16px; height: 16px; display: inline; vertical-align: middle; margin-right: 6px;"></i> ${errorMessage}</div>` : ''}
            
            <form action="/api/login" method="POST">
                <div class="form-group">
                    <label for="password">管理密碼</label>
                    <input type="password" name="password" id="password" class="form-control" placeholder="請輸入後台存取密碼" required autofocus>
                </div>
                <button type="submit" class="btn btn-primary" style="width: 100%; border-radius: 12px; padding: 14px; margin-top: 10px;">安全登入</button>
            </form>
            <div class="text-center" style="margin-top: 24px;">
                <a href="/" style="font-size: 0.85rem; color: var(--text-muted);"><i data-lucide="arrow-left" style="width: 12px; height: 12px; display: inline; vertical-align: middle;"></i> 回網站首頁</a>
            </div>
        </div>
        <script>
            lucide.createIcons();
            // Background grid telemetry drawing
            const canvas = document.getElementById('telemetry-bg');
            if (canvas) {
                const ctx = canvas.getContext('2d');
                function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; draw(); }
                function draw() {
                    ctx.clearRect(0,0,canvas.width,canvas.height);
                    ctx.strokeStyle = 'rgba(0, 240, 255, 0.015)';
                    ctx.lineWidth = 1;
                    for (let x = 0; x < canvas.width; x += 80) {
                        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
                    }
                    for (let y = 0; y < canvas.height; y += 80) {
                        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
                    }
                }
                window.addEventListener('resize', resize);
                resize();
            }
        </script>
    </body>
    </html>
    `;
}

// 6. Render Admin Dashboard Page
export function renderAdminDashboard(posts = [], pages = []) {
    return `
    <!DOCTYPE html>
    <html lang="zh-TW">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>後台管理面板 | 北科無人機社</title>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;700&family=Outfit:wght@400;600;800&display=swap" rel="stylesheet">
        <script src="https://unpkg.com/lucide@latest"></script>
        <style>
            :root {
                --bg-deep: #07090e;
                --bg-darker: #0c0e17;
                --bg-card: rgba(18, 24, 38, 0.8);
                --color-cyan: #00f0ff;
                --color-purple: #9d4edf;
                --text-primary: #f8fafc;
                --text-secondary: #cbd5e1;
                --text-muted: #64748b;
                --border-glass: rgba(255, 255, 255, 0.08);
            }
            * { margin:0; padding:0; box-sizing:border-box; }
            body {
                background-color: var(--bg-deep);
                color: var(--text-primary);
                font-family: 'Outfit', 'Noto Sans TC', sans-serif;
                display: flex;
                min-height: 100vh;
                overflow-x: hidden;
            }
            
            /* Sidebar */
            .sidebar {
                width: 260px;
                background: var(--bg-darker);
                border-right: 1px solid var(--border-glass);
                padding: 30px 20px;
                display: flex;
                flex-direction: column;
                justify-content: space-between;
                flex-shrink: 0;
            }
            .sidebar-logo {
                display: flex;
                align-items: center;
                gap: 10px;
                font-weight: 800;
                font-size: 1.25rem;
                color: var(--color-cyan);
                margin-bottom: 40px;
            }
            .sidebar-nav {
                display: flex;
                flex-direction: column;
                gap: 8px;
                flex-grow: 1;
            }
            .nav-item {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 12px 16px;
                border-radius: 12px;
                color: var(--text-secondary);
                font-weight: 600;
                cursor: pointer;
                transition: 0.2s ease;
                background: none;
                border: none;
                width: 100%;
                text-align: left;
                font-family: inherit;
                font-size: 0.95rem;
            }
            .nav-item:hover, .nav-item.active {
                color: #fff;
                background: rgba(255, 255, 255, 0.05);
            }
            .nav-item.active {
                border-left: 3px solid var(--color-cyan);
                border-radius: 0 12px 12px 0;
                background: rgba(0, 240, 255, 0.06);
                color: var(--color-cyan);
            }
            
            /* Main Content Area */
            .main-content {
                flex-grow: 1;
                padding: 40px;
                overflow-y: auto;
                max-height: 100vh;
            }
            .content-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 30px;
            }
            .content-header h1 {
                font-size: 1.85rem;
                font-weight: 800;
            }
            
            /* Panels */
            .panel {
                display: none;
                background: var(--bg-card);
                border: 1px solid var(--border-glass);
                border-radius: 20px;
                padding: 30px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.3);
            }
            .panel.active {
                display: block;
            }
            
            /* Buttons */
            .btn {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                padding: 10px 20px;
                border-radius: 10px;
                font-weight: 600;
                cursor: pointer;
                border: none;
                transition: 0.2s;
                font-family: inherit;
                font-size: 0.9rem;
            }
            .btn-primary {
                background: linear-gradient(135deg, var(--color-cyan), var(--color-purple));
                color: #000;
                font-weight: 700;
            }
            .btn-primary:hover {
                transform: translateY(-2px);
                box-shadow: 0 0 15px rgba(0, 240, 255, 0.3);
            }
            .btn-secondary {
                background: rgba(255,255,255,0.05);
                color: #fff;
                border: 1px solid var(--border-glass);
            }
            .btn-secondary:hover {
                background: rgba(255,255,255,0.1);
            }
            .btn-danger {
                background: rgba(239, 68, 68, 0.15);
                color: #f87171;
                border: 1px solid rgba(239, 68, 68, 0.3);
            }
            .btn-danger:hover {
                background: rgba(239, 68, 68, 0.3);
            }
            
            /* Tables */
            .table-container {
                overflow-x: auto;
                margin-top: 20px;
            }
            table {
                width: 100%;
                border-collapse: collapse;
                text-align: left;
            }
            th, td {
                padding: 16px;
                border-bottom: 1px solid var(--border-glass);
            }
            th {
                color: var(--text-muted);
                font-weight: 600;
                font-size: 0.85rem;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            td {
                font-size: 0.95rem;
            }
            tr:hover td {
                background: rgba(255,255,255,0.01);
            }
            
            /* Forms */
            .form-group {
                margin-bottom: 20px;
            }
            .form-group label {
                display: block;
                font-size: 0.85rem;
                color: var(--text-secondary);
                margin-bottom: 8px;
                font-weight: 600;
            }
            .form-control {
                width: 100%;
                padding: 12px;
                background: rgba(0,0,0,0.2);
                border: 1px solid var(--border-glass);
                border-radius: 8px;
                color: #fff;
                font-family: inherit;
                font-size: 0.95rem;
            }
            .form-control:focus {
                outline: none;
                border-color: var(--color-cyan);
            }
            
            /* Toast Message */
            #toast {
                position: fixed;
                bottom: 30px;
                right: 30px;
                background: rgba(18, 24, 38, 0.95);
                border: 1px solid var(--color-cyan);
                padding: 16px 24px;
                border-radius: 12px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.5);
                display: flex;
                align-items: center;
                gap: 12px;
                z-index: 1000;
                transform: translateY(100px);
                opacity: 0;
                transition: 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            }
            #toast.show {
                transform: translateY(0);
                opacity: 1;
            }
            
            /* Uploader */
            .upload-dropzone {
                border: 2px dashed var(--border-glass);
                border-radius: 12px;
                padding: 30px;
                text-align: center;
                cursor: pointer;
                transition: 0.2s;
                background: rgba(0,0,0,0.1);
            }
            .upload-dropzone:hover {
                border-color: var(--color-cyan);
                background: rgba(0, 240, 255, 0.02);
            }
        </style>
    </head>
    <body>
        <div class="sidebar">
            <div>
                <div class="sidebar-logo">
                    <i data-lucide="navigation" style="transform: rotate(45deg);"></i> NTUT DRONE 後台
                </div>
                <div class="sidebar-nav">
                    <button class="nav-item active" onclick="showPanel('posts')"><i data-lucide="book-open"></i> 文章管理</button>
                    <button class="nav-item" onclick="showPanel('pages')"><i data-lucide="file-text"></i> 頁面管理</button>
                    <button class="nav-item" onclick="showPanel('media')"><i data-lucide="image"></i> 媒體庫上傳</button>
                    <button class="nav-item" onclick="showPanel('settings')"><i data-lucide="settings"></i> 系統設定</button>
                </div>
            </div>
            <div>
                <a href="/" target="_blank" class="nav-item" style="margin-bottom: 8px;"><i data-lucide="external-link"></i> 前台首頁</a>
                <button class="nav-item" onclick="logout()" style="color: #f87171;"><i data-lucide="log-out"></i> 安全登出</button>
            </div>
        </div>

        <div class="main-content">
            <!-- Posts Panel -->
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
                                    <th>網址路徑 (Slug)</th>
                                    <th style="width: 180px; text-align: right;">動作</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${posts.map(post => `
                                    <tr id="row-post-${post.slug}">
                                        <td>${new Date(post.date).toLocaleDateString('zh-TW')}</td>
                                        <td><strong>${post.title}</strong></td>
                                        <td><code>/blog/${post.slug}</code></td>
                                        <td style="text-align: right;">
                                            <button class="btn btn-secondary" onclick="editPost('${post.slug}')" style="padding: 6px 12px; font-size: 0.8rem;"><i data-lucide="edit-3" style="width: 12px; height: 12px;"></i></button>
                                            <button class="btn btn-danger" onclick="deletePost('${post.slug}')" style="padding: 6px 12px; font-size: 0.8rem;"><i data-lucide="trash-2" style="width: 12px; height: 12px;"></i></button>
                                        </td>
                                    </tr>
                                `).join('')}
                                ${posts.length === 0 ? '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">尚無文章，點擊上方按鈕開始撰寫。</td></tr>' : ''}
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Post Editor Form (Hidden by default) -->
                <div id="posts-form-view" style="display: none; margin-top: 20px;">
                    <h2 id="post-form-title" style="margin-bottom: 24px;">新增文章</h2>
                    <form id="post-form" onsubmit="savePost(event)">
                        <input type="hidden" id="post-original-slug">
                        <div class="form-group">
                            <label for="post-title">文章標題</label>
                            <input type="text" id="post-title" class="form-control" placeholder="輸入文章標題..." required>
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
                            <label for="post-content">文章內容 (支援 Markdown 語法)</label>
                            <textarea id="post-content" class="form-control" rows="15" placeholder="開始用 Markdown 寫作你的大作..." style="font-family: monospace; line-height: 1.5;" required></textarea>
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
                                    <th>網址路徑 (Slug)</th>
                                    <th style="width: 180px; text-align: right;">動作</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${pages.map(page => `
                                    <tr id="row-page-${page.slug}">
                                        <td><strong>${page.title}</strong></td>
                                        <td><code>/page/${page.slug}</code></td>
                                        <td style="text-align: right;">
                                            <button class="btn btn-secondary" onclick="editPage('${page.slug}')" style="padding: 6px 12px; font-size: 0.8rem;"><i data-lucide="edit-3" style="width: 12px; height: 12px;"></i></button>
                                            <button class="btn btn-danger" onclick="deletePage('${page.slug}')" style="padding: 6px 12px; font-size: 0.8rem;"><i data-lucide="trash-2" style="width: 12px; height: 12px;"></i></button>
                                        </td>
                                    </tr>
                                `).join('')}
                                ${pages.length === 0 ? '<tr><td colspan="3" style="text-align:center; color:var(--text-muted);">尚無自訂頁面。</td></tr>' : ''}
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Page Editor Form (Hidden by default) -->
                <div id="pages-form-view" style="display: none; margin-top: 20px;">
                    <h2 id="page-form-title" style="margin-bottom: 24px;">新增頁面</h2>
                    <form id="page-form" onsubmit="savePage(event)">
                        <input type="hidden" id="page-original-slug">
                        <div class="form-group">
                            <label for="page-title">頁面標題</label>
                            <input type="text" id="page-title" class="form-control" placeholder="例如: 2026 入社招生資訊" required>
                        </div>
                        <div class="form-group">
                            <label for="page-slug">網址路徑 (Slug - 例如 about-fpv 則網址為 /page/about-fpv)</label>
                            <input type="text" id="page-slug" class="form-control" placeholder="例如: join-us" required>
                        </div>
                        <div class="form-group">
                            <label for="page-content">頁面內容 (支援 Markdown/HTML 語法)</label>
                            <textarea id="page-content" class="form-control" rows="18" placeholder="使用 Markdown 或是純 HTML 語法撰寫整頁內容..." style="font-family: monospace;" required></textarea>
                        </div>
                        <div style="display: flex; gap: 12px; justify-content: flex-end;">
                            <button type="button" class="btn btn-secondary" onclick="closePageForm()">取消</button>
                            <button type="submit" class="btn btn-primary">儲存頁面</button>
                        </div>
                    </form>
                </div>
            </div>

            <!-- Media Panel -->
            <div id="panel-media" class="panel">
                <div class="content-header">
                    <h1>媒體庫上傳 (GitHub 儲存庫)</h1>
                </div>
                
                <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 20px;">
                    在這裡上傳的圖片會直接利用 GitHub API 提交到您的 <code>assets/uploads/</code> 專案目錄下。完成上傳後，您可以複製 Markdown 代碼，直接貼上到文章或頁面的內容編輯器中。
                </p>
                
                <div class="form-group">
                    <div class="upload-dropzone" onclick="document.getElementById('file-upload-input').click()">
                        <i data-lucide="cloud-upload" style="width: 48px; height: 48px; color: var(--color-cyan); margin-bottom: 12px;"></i>
                        <p>點擊此處選擇圖片進行上傳</p>
                        <span style="color: var(--text-muted); font-size: 0.75rem; display: block; margin-top: 4px;">支援 JPG, PNG, GIF, WEBP</span>
                        <input type="file" id="file-upload-input" style="display: none;" onchange="handleFileUpload(event)">
                    </div>
                </div>

                <div id="uploaded-files-title" style="margin-top: 40px; margin-bottom: 16px; font-weight: 700; font-size: 1.1rem; display: none;">近期上傳的圖片</div>
                <div id="uploaded-files-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 20px;">
                    <!-- Dynamically populated uploads -->
                </div>
            </div>

            <!-- Settings Panel -->
            <div id="panel-settings" class="panel">
                <div class="content-header">
                    <h1>系統帳號設定</h1>
                </div>
                
                <form onsubmit="changePassword(event)" style="max-width: 450px;">
                    <div class="form-group">
                        <label for="old-password">目前管理密碼</label>
                        <input type="password" id="old-password" class="form-control" required>
                    </div>
                    <div class="form-group">
                        <label for="new-password">設定新密碼</label>
                        <input type="password" id="new-password" class="form-control" placeholder="至少 6 位字元" required>
                    </div>
                    <div class="form-group">
                        <label for="new-password-confirm">再次輸入新密碼</label>
                        <input type="password" id="new-password-confirm" class="form-control" required>
                    </div>
                    <button type="submit" class="btn btn-primary" style="margin-top: 10px;">儲存新密碼</button>
                </form>
            </div>
        </div>

        <!-- Toast Notice -->
        <div id="toast">
            <i data-lucide="check-circle" style="color: var(--color-cyan); width: 20px; height: 20px;"></i>
            <span id="toast-text">操作成功</span>
        </div>

        <script>
            lucide.createIcons();

            // 1. Navigation Panel Switching
            function showPanel(panelName) {
                document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
                document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
                
                document.getElementById('panel-' + panelName).classList.add('active');
                
                // Find corresponding nav button to activate
                const buttons = document.querySelectorAll('.sidebar-nav .nav-item');
                buttons.forEach(btn => {
                    if (btn.outerHTML.includes(panelName)) {
                        btn.classList.add('active');
                    }
                });

                // Reset forms when switching tabs
                closePostForm();
                closePageForm();
            }

            // 2. Notification Toast
            function showToast(text, isError = false) {
                const toast = document.getElementById('toast');
                const toastText = document.getElementById('toast-text');
                toastText.innerText = text;
                
                if (isError) {
                    toast.style.borderColor = '#ef4444';
                    toast.innerHTML = '<i data-lucide="alert-circle" style="color:#ef4444; width:20px; height:20px;"></i> <span>' + text + '</span>';
                } else {
                    toast.style.borderColor = 'var(--color-cyan)';
                    toast.innerHTML = '<i data-lucide="check-circle" style="color:var(--color-cyan); width:20px; height:20px;"></i> <span>' + text + '</span>';
                }
                lucide.createIcons();
                
                toast.classList.add('show');
                setTimeout(() => {
                    toast.classList.remove('show');
                }, 3000);
            }

            // 3. Post Manage
            function openPostForm() {
                document.getElementById('posts-list-view').style.display = 'none';
                document.getElementById('posts-form-view').style.display = 'block';
                document.getElementById('post-form-title').innerText = '新增文章';
                document.getElementById('post-form').reset();
                document.getElementById('post-original-slug').value = '';
                document.getElementById('post-slug').disabled = false;
            }

            function closePostForm() {
                document.getElementById('posts-list-view').style.display = 'block';
                document.getElementById('posts-form-view').style.display = 'none';
            }

            async function savePost(e) {
                e.preventDefault();
                const title = document.getElementById('post-title').value;
                const slug = document.getElementById('post-slug').value.trim();
                const summary = document.getElementById('post-summary').value;
                const content = document.getElementById('post-content').value;
                const originalSlug = document.getElementById('post-original-slug').value;

                if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
                    showToast('網址代稱只能包含英文、數字與底線或橫槓！', true);
                    return;
                }

                try {
                    const res = await fetch('/api/posts', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ title, slug, summary, content, originalSlug })
                    });
                    
                    const data = await res.json();
                    if (res.ok) {
                        showToast(originalSlug ? '文章更新成功！' : '文章發佈成功！');
                        setTimeout(() => location.reload(), 1000);
                    } else {
                        showToast(data.error || '儲存失敗', true);
                    }
                } catch (err) {
                    showToast('與伺服器連線失敗', true);
                }
            }

            async function editPost(slug) {
                try {
                    const res = await fetch('/api/posts/' + slug);
                    if (!res.ok) throw new Error();
                    const post = await res.json();
                    
                    openPostForm();
                    document.getElementById('post-form-title').innerText = '編輯文章';
                    document.getElementById('post-title').value = post.title;
                    document.getElementById('post-slug').value = post.slug;
                    document.getElementById('post-slug').disabled = true; // Avoid accidental slug changes
                    document.getElementById('post-summary').value = post.summary || '';
                    document.getElementById('post-content').value = post.content;
                    document.getElementById('post-original-slug').value = post.slug;
                } catch (err) {
                    showToast('無法取得文章內容', true);
                }
            }

            async function deletePost(slug) {
                if (!confirm('確定要刪除此文章嗎？刪除後無法恢復。')) return;
                try {
                    const res = await fetch('/api/posts/' + slug, { method: 'DELETE' });
                    if (res.ok) {
                        showToast('文章已刪除');
                        document.getElementById('row-post-' + slug).remove();
                    } else {
                        showToast('刪除失敗', true);
                    }
                } catch (err) {
                    showToast('網路連線失敗', true);
                }
            }

            // 4. Page Manage
            function openPageForm() {
                document.getElementById('pages-list-view').style.display = 'none';
                document.getElementById('pages-form-view').style.display = 'block';
                document.getElementById('page-form-title').innerText = '新增頁面';
                document.getElementById('page-form').reset();
                document.getElementById('page-original-slug').value = '';
                document.getElementById('page-slug').disabled = false;
            }

            function closePageForm() {
                document.getElementById('pages-list-view').style.display = 'block';
                document.getElementById('pages-form-view').style.display = 'none';
            }

            async function savePage(e) {
                e.preventDefault();
                const title = document.getElementById('page-title').value;
                const slug = document.getElementById('page-slug').value.trim();
                const content = document.getElementById('page-content').value;
                const originalSlug = document.getElementById('page-original-slug').value;

                if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
                    showToast('網址路徑只能包含英文、數字與底線或橫槓！', true);
                    return;
                }

                try {
                    const res = await fetch('/api/pages', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ title, slug, content, originalSlug })
                    });
                    
                    const data = await res.json();
                    if (res.ok) {
                        showToast(originalSlug ? '頁面更新成功！' : '頁面建立成功！');
                        setTimeout(() => location.reload(), 1000);
                    } else {
                        showToast(data.error || '儲存失敗', true);
                    }
                } catch (err) {
                    showToast('與伺服器連線失敗', true);
                }
            }

            async function editPage(slug) {
                try {
                    const res = await fetch('/api/pages/' + slug);
                    if (!res.ok) throw new Error();
                    const page = await res.json();
                    
                    openPageForm();
                    document.getElementById('page-form-title').innerText = '編輯頁面';
                    document.getElementById('page-title').value = page.title;
                    document.getElementById('page-slug').value = page.slug;
                    document.getElementById('page-slug').disabled = true;
                    document.getElementById('page-content').value = page.content;
                    document.getElementById('page-original-slug').value = page.slug;
                } catch (err) {
                    showToast('無法取得頁面內容', true);
                }
            }

            async function deletePage(slug) {
                if (!confirm('確定要刪除此自訂頁面嗎？')) return;
                try {
                    const res = await fetch('/api/pages/' + slug, { method: 'DELETE' });
                    if (res.ok) {
                        showToast('頁面已刪除');
                        document.getElementById('row-page-' + slug).remove();
                    } else {
                        showToast('刪除失敗', true);
                    }
                } catch (err) {
                    showToast('網路連線失敗', true);
                }
            }

            // 5. Image File Upload (commits to GitHub)
            async function handleFileUpload(e) {
                const file = e.target.files[0];
                if (!file) return;

                const formData = new FormData();
                formData.append('image', file);

                showToast('正在上傳圖片到 GitHub...', false);

                try {
                    const res = await fetch('/api/upload', {
                        method: 'POST',
                        body: formData
                    });
                    
                    const data = await res.json();
                    if (res.ok) {
                        showToast('圖片上傳並成功提交到 GitHub！');
                        addUploadedImageToGrid(data.filename, data.url);
                    } else {
                        showToast(data.error || '上傳失敗', true);
                    }
                } catch (err) {
                    showToast('圖片上傳連線失敗', true);
                }
            }

            function addUploadedImageToGrid(filename, url) {
                document.getElementById('uploaded-files-title').style.display = 'block';
                const grid = document.getElementById('uploaded-files-grid');
                const card = document.createElement('div');
                card.style.background = 'rgba(255,255,255,0.03)';
                card.style.border = '1px solid var(--border-glass)';
                card.style.borderRadius = '12px';
                card.style.padding = '12px';
                card.style.textAlign = 'center';
                
                const markdownText = '![' + filename + '](' + url + ')';

                card.innerHTML = `
                    <img src="${url}" style="max-width:100%; height:120px; object-fit:cover; border-radius:8px; margin-bottom:10px;">
                    <div style="font-size:0.75rem; text-overflow:ellipsis; overflow:hidden; white-space:nowrap; color:var(--text-muted); margin-bottom:8px;">${filename}</div>
                    <button class="btn btn-secondary" onclick="copyText('${markdownText}')" style="width:100%; padding:6px; font-size:0.75rem; justify-content:center;"><i data-lucide="copy" style="width:12px; height:12px;"></i> 複製 MD</button>
                `;
                
                grid.insertBefore(card, grid.firstChild);
                lucide.createIcons();
            }

            function copyText(text) {
                navigator.clipboard.writeText(text);
                showToast('已複製 Markdown 圖片代碼！');
            }

            // 6. Security settings
            async function changePassword(e) {
                e.preventDefault();
                const oldPassword = document.getElementById('old-password').value;
                const newPassword = document.getElementById('new-password').value;
                const confirmPass = document.getElementById('new-password-confirm').value;

                if (newPassword !== confirmPass) {
                    showToast('兩次輸入的新密碼不一致！', true);
                    return;
                }
                if (newPassword.length < 6) {
                    showToast('新密碼必須至少為 6 個字元！', true);
                    return;
                }

                try {
                    const res = await fetch('/api/change-password', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ oldPassword, newPassword })
                    });
                    
                    const data = await res.json();
                    if (res.ok) {
                        showToast('密碼變更成功！請重新登入。');
                        setTimeout(() => logout(), 1500);
                    } else {
                        showToast(data.error || '變更密碼失敗', true);
                    }
                } catch (err) {
                    showToast('伺服器連線失敗', true);
                }
            }

            async function logout() {
                await fetch('/api/logout', { method: 'POST' });
                location.href = '/admin';
            }
        </script>
    </body>
    </html>
    `;
}
