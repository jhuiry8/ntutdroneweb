// NTUT Drone Club CMS - HTML Templates with i18n support
import { locales } from './locales.js';

// Helper: Common Header
function getHeader(title, lang = 'zh') {
    const t = locales[lang] || locales.zh;
    return `
    <!DOCTYPE html>
    <html lang="${lang}">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title} | 北科無人機社 NTUT Drone Club - 台北科技大學無人機平台</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@300;400;500;700;900&family=Outfit:wght@300;400;600;800&display=swap" rel="stylesheet">
        <script src="https://cdn.jsdelivr.net/npm/lucide@latest/dist/umd/lucide.js"></script>
        <link rel="stylesheet" href="/style.css">
        <script>(function(){var t=localStorage.getItem('ntut-theme')||'dark';document.documentElement.setAttribute('data-theme',t);})();</script>
    </head>
    <body>
        <header class="navbar scrolled">
            <div class="nav-container">
                <a href="/?lang=${lang}" class="logo">
                    <img src="/assets/images/logo_ntut.jpg" alt="NTUT Drone Logo" style="height: 40px; width: 40px; object-fit: contain; border-radius: 6px; margin-right: 8px;">
                    <div class="logo-text">
                        <span class="brand-en">NTUT DRONE</span>
                        <span class="brand-zh">北科無人機社</span>
                    </div>
                </a>
                <nav class="nav-links">
                    <a href="/?lang=${lang}#about" class="nav-link">${t.navAbout}</a>
                    <a href="/?lang=${lang}#features" class="nav-link">${t.navFeatures}</a>
                    <a href="/blog?lang=${lang}" class="nav-link">${t.navBlog}</a>
                    <a href="/?lang=${lang}#faq" class="nav-link">${t.navFaq}</a>
                </nav>
                <div class="nav-socials">
                    <!-- Language Toggle -->
                    <a href="?lang=${t.langToggleQuery}" class="cta-nav-btn" style="background:none; border: 1px solid var(--border-color); color:var(--text-primary); margin-right:4px; padding: 6px 12px;">
                        <span style="font-size: 1.1rem; margin-right: 4px;">🌐</span> ${t.langToggleText}
                    </a>
                    <!-- Theme Toggle -->
                    <button id="theme-toggle-btn" class="theme-toggle-btn" onclick="toggleTheme()" title="切換深色/淺色模式">☀️</button>
                    <a href="mailto:ntut.droneclub@gmail.com" class="social-icon-btn email" title="官方信箱"><i data-lucide="mail"></i><span class="fallback-text">✉️</span></a>
                    <a href="https://www.instagram.com/ntut_drone/" target="_blank" class="social-icon-btn ig" title="Instagram"><i data-lucide="instagram"></i><span class="fallback-text">IG</span></a>
                    <a href="https://lin.ee/s5YJgGI" target="_blank" class="social-icon-btn line" title="LINE 官方社群"><i data-lucide="message-square"></i><span class="fallback-text">LINE</span></a>
                </div>
            </div>
        </header>
    `;
}


// Helper: Common Footer
function getFooter(lang = 'zh') {
    const t = locales[lang] || locales.zh;
    return `
        <footer>
            <div class="footer-container">
                <div class="footer-brand">
                    <a href="#" class="logo">
                        <img src="/assets/images/logo_ntut.jpg" alt="NTUT Drone Logo" style="height: 38px; width: 38px; object-fit: contain; border-radius: 6px; margin-right: 8px;">
                        <span class="logo-text">
                            <span class="brand-en">NTUT DRONE</span>
                            <span class="brand-zh">北科無人機社</span>
                        </span>
                    </a>
                    <p class="footer-desc">${t.footerDesc}</p>
                </div>
                <div class="footer-links-group">
                    <div class="footer-col">
                        <h4>快速導覽</h4>
                        <a href="/?lang=${lang}">回到首頁</a>
                        <a href="/blog?lang=${lang}">${t.navBlog}</a>
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
export function renderLandingPage(latestPosts = [], lang = 'zh', override = {}) {
    const t = locales[lang] || locales.zh;
    const o = override;
    
    // ── 1. Hero ──────────────────────────────────────────
    const heroTitle  = o.heroTitle  || t.heroTitleZh;
    const heroDesc   = o.heroDesc   || t.heroDesc;
    const heroBadge  = o.heroBadge  || (lang === 'zh' ? '國立臺北科技大學 | 學務處課外活動指導組核可康樂性社團' : 'NTUT | Recreational Club • Student Affairs Approved');
    
    // ── 2. About ─────────────────────────────────────────
    const aboutTitle      = o.aboutTitle      || t.aboutTitle;
    const aboutSubtitle   = o.aboutSubtitle   || t.aboutSubtitle;
    const aboutCard1Title = o.aboutCard1Title || t.aboutCard1Title;
    const aboutCard1Desc  = o.aboutCard1Desc  || t.aboutCard1Desc;
    const aboutCard2Title = o.aboutCard2Title || t.aboutCard2Title;
    const aboutCard2Desc  = o.aboutCard2Desc  || t.aboutCard2Desc;
    const aboutCard3Title = o.aboutCard3Title || t.aboutCard3Title;
    const aboutCard3Desc  = o.aboutCard3Desc  || t.aboutCard3Desc;
    
    // ── 3. Features ──────────────────────────────────────
    const featuresTitle    = o.featuresTitle    || t.featuresTitle;
    const featuresSubtitle = o.featuresSubtitle || t.featuresSubtitle;
    const feat1Title       = o.feat1Title       || t.feat1Title;
    const feat1Desc        = o.feat1Desc        || t.feat1Desc;
    const feat2Title       = o.feat2Title       || t.feat2Title;
    const feat2Desc        = o.feat2Desc        || t.feat2Desc;
    const feat3Title       = o.feat3Title       || t.feat3Title;
    const feat3Desc        = o.feat3Desc        || t.feat3Desc;
    const feat4Title       = o.feat4Title       || t.feat4Title;
    const feat4Desc        = o.feat4Desc        || t.feat4Desc;

    // ── 4. CTA ───────────────────────────────────────────
    const ctaTitle = o.ctaTitle || t.ctaTitle;
    const ctaDesc  = o.ctaDesc  || t.ctaDesc;

    // ── 5. Social Links & Contact ────────────────────────
    const lineLink   = o.lineLink   || 'https://lin.ee/s5YJgGI';
    const igLink     = o.igLink     || 'https://www.instagram.com/ntut_drone/';
    const emailLink  = o.emailLink  || 'ntut.droneclub@gmail.com';

    // ── 6. Instagram Cards Overrides ─────────────────────
    const igCard1Tag      = o.igCard1Tag      || 'FPV 穿越機';
    const igCard1Caption  = o.igCard1Caption  || '⚡ 手動檔極速穿梭特技！第一人稱視角 (FPV) 以時速超過 100km/h 俯衝過彎，享受絕對的速度與空間掌控感 🚀🔥 #ntutdrone #FPVRacing #穿越機 #北科大';
    const igCard1Img      = o.igCard1Img      || '/assets/images/fpv_drone_hero.jpg';
    const igCard1Likes    = o.igCard1Likes    || '158';
    const igCard1Comments = o.igCard1Comments || '24';

    const igCard2Tag      = o.igCard2Tag      || '航拍創作';
    const igCard2Caption  = o.igCard2Caption  || '🌇 上帝視角的北科校園夕陽！用 DJI 航拍機捕捉壯麗的光影律動與校園景致，歡迎加入空拍視覺組一起創作大片 📸✨ #空拍創作 #北科無人機社 #DJI';
    const igCard2Img      = o.igCard2Img      || '/assets/images/logo_drone.png';
    const igCard2Likes    = o.igCard2Likes    || '210';
    const igCard2Comments = o.igCard2Comments || '19';

    const igCard3Tag      = o.igCard3Tag      || '創客實作';
    const igCard3Caption  = o.igCard3Caption  || '🛠️ 社課現場實況！手把手帶領新社員進行無刷馬達配線焊接、電調安裝與 Betaflight PID 馬達校正。組裝屬於自己的無人機！ 💪🔧 #機體組裝 #調參 #創客';
    const igCard3Img      = o.igCard3Img      || '';
    const igCard3Likes    = o.igCard3Likes    || '135';
    const igCard3Comments = o.igCard3Comments || '12';

    const igCard4Tag      = o.igCard4Tag      || '飛行局日常';
    const igCard4Caption  = o.igCard4Caption  || '☀️ 週末飛行局成功！齊聚北部合法飛場，大夥一起交流高畫質圖傳、拉距測試與暢快試飛，歡迎對無人機有興趣的朋友隨時加入！ 🛸🌿 #飛行局 #合法飛場 #北科';
    const igCard4Img      = o.igCard4Img      || '';
    const igCard4Likes    = o.igCard4Likes    || '192';
    const igCard4Comments = o.igCard4Comments || '31';

    let postsHtml = '';
    
    if (latestPosts.length === 0) {
        postsHtml = `
            <div class="about-card text-center" style="grid-column: span 3; padding: 40px;">
                <i data-lucide="book-open" style="width: 48px; height: 48px; color: var(--color-cyan); margin-bottom: 16px;"></i>
                <p>${t.blogEmpty}</p>
            </div>
        `;
    } else {
        latestPosts.forEach(post => {
            const dateStr = new Date(post.date).toLocaleDateString(lang === 'zh' ? 'zh-TW' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' });
            postsHtml += `
                <div class="about-card" style="display: flex; flex-direction: column; justify-content: space-between;">
                    <div>
                        <span style="font-size: 0.8rem; color: var(--color-cyan); font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">${dateStr}</span>
                        <h3 style="margin-top: 8px; margin-bottom: 12px; font-size: 1.25rem;">${post.title}</h3>
                        <p style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 20px;">${post.summary || ''}</p>
                    </div>
                    <a href="/blog/${post.slug}?lang=${lang}" class="cta-nav-btn" style="text-align: center; display: block; width: 100%;">閱讀全文 <i data-lucide="arrow-right" style="width: 14px; height: 14px; display: inline; vertical-align: middle;"></i></a>
                </div>
            `;
        });
    }

    return `
    <!DOCTYPE html>
    <html lang="${lang}">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta name="description" content="歡迎加入北科無人機社！我們提供最專業的多軸空拍機創作、FPV 穿越機飛行特技、機體組裝調參教學，並輔導民航局 CAA 無人機操作證照。無論是零基礎小白還是熱血極客，這裡都有你的藍天！">
        <meta name="keywords" content="北科無人機社, 北科大無人機社, NTUT Drone, 北科大無人機社團, 北科 FPV 穿越機, 北科 空拍機 課程, 北科無人機組裝教學, 台北無人機模擬器練習, 北科校園飛行空域申請, 民航局無人機考照題庫練習, Liftoff 模擬飛行新手訓練, 台北合法無人機飛場推薦, 台北科技大學">
        <meta property="og:title" content="北科無人機社 | NTUT Drone Club - 台北科技大學無人機、FPV 與空拍交流平台">
        <meta property="og:description" content="歡迎加入北科無人機社！我們提供最專業的多軸空拍機創作、FPV 穿越機飛行特技、機體組裝調參教學，並輔導民航局 CAA 無人機操作證照。無論是零基礎小白還是熱血極客，這裡都有你的藍天！">
        <meta property="og:image" content="/assets/images/fpv_drone_hero.jpg">
        <meta property="og:type" content="website">
        <title>北科無人機社 | NTUT Drone Club - 台北科技大學無人機、FPV 與空拍交流平台</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@300;400;500;700;900&family=Outfit:wght@300;400;600;800&display=swap" rel="stylesheet">
        <script src="https://cdn.jsdelivr.net/npm/lucide@latest/dist/umd/lucide.js"></script>
        <link rel="stylesheet" href="/style.css">
        <script>(function(){var t=localStorage.getItem('ntut-theme')||'dark';document.documentElement.setAttribute('data-theme',t);})();</script>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "EducationalOrganization",
          "name": "北科無人機社 (NTUT Drone Club)",
          "alternateName": ["北科大無人機社", "NTUT Drone", "北科大無人機社團"],
          "description": "歡迎加入北科無人機社！我們提供最專業的多軸空拍機創作、FPV 穿越機飛行特技、機體組裝調參教學，並輔導民航局 CAA 無人機操作證照。",
          "email": "ntut.droneclub@gmail.com",
          "sameAs": [
            "https://www.instagram.com/ntut_drone/",
            "https://lin.ee/s5YJgGI"
          ]
        }
        </script>
    </head>
    <body>


        <header class="navbar">
            <div class="nav-container">
                <a href="/?lang=${lang}" class="logo">
                    <img src="/assets/images/logo_ntut.jpg" alt="NTUT Drone Logo" style="height: 40px; width: 40px; object-fit: contain; border-radius: 6px; margin-right: 8px;">
                    <div class="logo-text">
                        <span class="brand-en">NTUT DRONE</span>
                        <span class="brand-zh">北科無人機社</span>
                    </div>
                </a>
                
                <nav class="nav-links">
                    <a href="#about" class="nav-link">${t.navAbout}</a>
                    <a href="#features" class="nav-link">${t.navFeatures}</a>
                    <a href="#instagram" class="nav-link" style="color:#e1306c; font-weight:700;"><i data-lucide="instagram" style="width:14px; height:14px; display:inline; vertical-align:middle; margin-right:2px;"></i> ${lang === 'zh' ? 'IG 動態' : 'IG Feed'}</a>
                    <a href="#dynamic-blog" class="nav-link">${lang === 'zh' ? '最新文章' : 'Latest Posts'}</a>
                    <a href="#faq" class="nav-link">${t.navFaq}</a>
                </nav>

                <div class="nav-socials">
                    <!-- Language Toggle -->
                    <a href="?lang=${t.langToggleQuery}" class="cta-nav-btn" style="background:none; border: 1px solid var(--border-color); color:var(--text-primary); margin-right:4px; padding: 6px 12px;">
                        <span style="font-size: 1.1rem; margin-right: 4px;">🌐</span> ${t.langToggleText}
                    </a>
                    <!-- Theme Toggle -->
                    <button id="theme-toggle-btn" class="theme-toggle-btn" onclick="toggleTheme()" title="切換深色/淺色模式">☀️</button>
                    <a href="mailto:${emailLink}" class="social-icon-btn email" title="官方信箱: ${emailLink}" aria-label="Email">
                        <i data-lucide="mail"></i><span class="fallback-text">✉️</span>
                    </a>
                    <a href="${igLink}" target="_blank" aria-label="Instagram" class="social-icon-btn ig" title="Instagram">
                        <i data-lucide="instagram"></i><span class="fallback-text">IG</span>
                    </a>
                    <a href="${lineLink}" target="_blank" aria-label="LINE" class="social-icon-btn line" title="LINE 官方社群">
                        <i data-lucide="message-square"></i><span class="fallback-text">LINE</span>
                    </a>
                    <a href="${lineLink}" target="_blank" class="cta-nav-btn" style="margin-left: 4px;">${t.navJoin}</a>
                    <button class="mobile-menu-toggle" aria-label="Toggle menu">
                        <i data-lucide="menu"></i>
                    </button>
                </div>
            </div>
        </header>

        <div class="mobile-drawer">
            <div class="drawer-header">
                <span class="drawer-logo"><img src="/assets/images/logo_ntut.jpg" alt="NTUT Drone Logo" style="height: 28px; width: 28px; object-fit: contain; border-radius: 4px; vertical-align: middle; margin-right: 6px;"> NTUT DRONE</span>
                <button class="drawer-close"><i data-lucide="x"></i></button>
            </div>
            <nav class="drawer-links">
                <a href="#about" class="drawer-link">${t.navAbout}</a>
                <a href="#features" class="drawer-link">${t.navFeatures}</a>
                <a href="#instagram" class="drawer-link" style="color:#e1306c; font-weight:700;">📸 ${lang === 'zh' ? 'IG 實飛動態' : 'IG Feed'}</a>
                <a href="#dynamic-blog" class="drawer-link">${lang === 'zh' ? '最新文章' : 'Latest Posts'}</a>
                <a href="#faq" class="drawer-link">${t.navFaq}</a>
                <a href="?lang=${t.langToggleQuery}" class="drawer-link" style="color: var(--color-primary);"><span style="margin-right: 6px;">🌐</span> ${t.langToggleText}</a>
                <hr class="drawer-divider">
                <a href="mailto:${emailLink}" class="drawer-cta-btn" style="background: #3b82f6;"><i data-lucide="mail"></i> ${emailLink}</a>
                <a href="${lineLink}" target="_blank" class="drawer-cta-btn"><i data-lucide="message-square"></i> ${t.heroBtnLine}</a>
                <a href="${igLink}" target="_blank" class="drawer-cta-btn secondary"><i data-lucide="instagram"></i> Instagram</a>
            </nav>
        </div>

        <section class="hero-section" id="home">
            <div class="hero-container" style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 40px;">
                <div class="hero-content-left" style="flex: 1; min-width: 300px;">
                    <div class="hero-badge-top">
                        ${heroBadge}
                    </div>
                    <h1 class="hero-title">${heroTitle}</h1>
                    <p class="hero-description">${heroDesc}</p>
                    
                    <div class="hero-search-box">
                        <input type="text" class="hero-search-input" placeholder="搜尋飛行教學、考照題庫、器材出借與社團活動..." id="hero-search-input" onkeydown="if(event.key==='Enter'){ window.location.href='/blog?lang=${lang}'; }">
                        <button class="hero-search-btn" onclick="window.location.href='/blog?lang=${lang}';"><i data-lucide="search"></i> ${lang === 'zh' ? '搜尋' : 'Search'}</button>
                    </div>
                </div>
                <div class="hero-logo-right" style="flex: 0 0 auto; display: flex; justify-content: center; align-items: center;">
                    <div style="background: #ffffff; padding: 24px 32px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.12); border: 1px solid #e0e4e8; max-width: 380px; text-align: center;">
                        <img src="/assets/images/logo_drone.png" alt="NTUT Drone Official Emblem" style="max-width: 100%; height: auto; display: block; margin: 0 auto;">
                    </div>
                </div>
            </div>
        </section>

        <!-- GOV.UK Style Popular Services Section -->
        <section class="popular-section">
            <div class="section-container">
                <h2 class="popular-header">${lang === 'zh' ? '常用服務與快速導覽 (Popular Services & Resources)' : 'Popular Services & Resources'}</h2>
                <div class="popular-grid">
                    <div class="popular-item">
                        <div class="popular-icon">→</div>
                        <div class="popular-text">
                            <a href="${lineLink}" target="_blank" class="popular-link">${lang === 'zh' ? '無人機飛行場地預約與使用規範' : 'Drone Flight Field Reservation & Rules'}</a>
                            <span class="popular-desc">${lang === 'zh' ? '校園飛行空域申請手續與安全指引' : 'Campus airspace application and safety guidelines'}</span>
                        </div>
                    </div>
                    <div class="popular-item">
                        <div class="popular-icon">→</div>
                        <div class="popular-text">
                            <a href="#about" class="popular-link">${lang === 'zh' ? '民航局遙控無人機操作證題庫與學科準備' : 'CAA Drone Pilot License Exam Prep'}</a>
                            <span class="popular-desc">${lang === 'zh' ? '普通與專業操作證考試衝刺重點' : 'Key study materials for CAA drone licensing'}</span>
                        </div>
                    </div>
                    <div class="popular-item">
                        <div class="popular-icon">→</div>
                        <div class="popular-text">
                            <a href="#features" class="popular-link">${lang === 'zh' ? '社團專屬飛行模擬器新手訓練教學' : 'Flight Simulator Training for Beginners'}</a>
                            <span class="popular-desc">${lang === 'zh' ? '從零開始的 Liftoff / DCL 模擬飛行培訓' : 'Step-by-step FPV simulator training program'}</span>
                        </div>
                    </div>
                    <div class="popular-item">
                        <div class="popular-icon">→</div>
                        <div class="popular-text">
                            <a href="${lineLink}" target="_blank" class="popular-link">${lang === 'zh' ? 'LINE 官方社群與 2026 年度入社報名' : 'Official LINE Community & 2026 Registration'}</a>
                            <span class="popular-desc">${lang === 'zh' ? '加入官方社群群組，獲取最新社課通知' : 'Join our LINE group for workshop updates'}</span>
                        </div>
                    </div>
                    <div class="popular-item">
                        <div class="popular-icon">→</div>
                        <div class="popular-text">
                            <a href="#features" class="popular-link">${lang === 'zh' ? '無人機零件出借與航拍器材設備清單' : 'Drone Parts Loan & Aerial Equipment List'}</a>
                            <span class="popular-desc">${lang === 'zh' ? '社員專屬 FPV 穿越機與空拍機租借服務' : 'Equipment loan services for club members'}</span>
                        </div>
                    </div>
                    <div class="popular-item">
                        <div class="popular-icon">→</div>
                        <div class="popular-text">
                            <a href="/blog?lang=${lang}" class="popular-link">${lang === 'zh' ? '最新社團技術專欄與賽事紀錄報導' : 'Latest Technical Articles & Event Reports'}</a>
                            <span class="popular-desc">${lang === 'zh' ? '探索飛行技術、航拍創作與比賽心得' : 'Explore flight techniques and competition reviews'}</span>
                        </div>
                    </div>
                </div>
            </div>
        </section>

        <!-- About Section -->
        <section class="about-section" id="about">
            <div class="section-container">
                <div class="section-header text-center">
                    <h2 class="section-title">${aboutTitle}</h2>
                    <p class="section-subtitle">${aboutSubtitle}</p>
                </div>
                
                <div class="about-grid">
                    <div class="about-card">
                        <div class="about-card-icon"><i data-lucide="shield-check"></i></div>
                        <h3>${aboutCard1Title}</h3>
                        <p>${aboutCard1Desc}</p>
                    </div>
                    
                    <div class="about-card">
                        <div class="about-card-icon"><i data-lucide="wrench"></i></div>
                        <h3>${aboutCard2Title}</h3>
                        <p>${aboutCard2Desc}</p>
                    </div>
                    
                    <div class="about-card">
                        <div class="about-card-icon"><i data-lucide="users"></i></div>
                        <h3>${aboutCard3Title}</h3>
                        <p>${aboutCard3Desc}</p>
                    </div>
                </div>
            </div>
        </section>

        <!-- Features Section -->
        <section class="features-section" id="features">
            <div class="section-container">
                <div class="section-header text-center">
                    <h2 class="section-title">${featuresTitle}</h2>
                    <p class="section-subtitle">${featuresSubtitle}</p>
                </div>

                <div class="features-grid">
                    <div class="feature-item-card">
                        <div class="feature-visual">
                            <div class="feature-icon-wrapper cyan">
                                <i data-lucide="monitor-play"></i>
                            </div>
                        </div>
                        <div class="feature-info">
                            <h3 class="feature-name">${feat1Title}</h3>
                            <p class="feature-desc">${feat1Desc}</p>
                        </div>
                    </div>

                    <div class="feature-item-card">
                        <div class="feature-visual">
                            <div class="feature-icon-wrapper purple">
                                <i data-lucide="eye"></i>
                            </div>
                        </div>
                        <div class="feature-info">
                            <h3 class="feature-name">${feat2Title}</h3>
                            <p class="feature-desc">${feat2Desc}</p>
                        </div>
                    </div>

                    <div class="feature-item-card">
                        <div class="feature-visual">
                            <div class="feature-icon-wrapper green">
                                <i data-lucide="aperture"></i>
                            </div>
                        </div>
                        <div class="feature-info">
                            <h3 class="feature-name">${feat3Title}</h3>
                            <p class="feature-desc">${feat3Desc}</p>
                        </div>
                    </div>

                    <div class="feature-item-card">
                        <div class="feature-visual">
                            <div class="feature-icon-wrapper yellow">
                                <i data-lucide="award"></i>
                            </div>
                        </div>
                        <div class="feature-info">
                            <h3 class="feature-name">${t.feat4Title}</h3>
                            <p class="feature-desc">${t.feat4Desc}</p>
                        </div>
                    </div>
                </div>
            </div>
        </section>

        <!-- Instagram Feed Showcase Section -->
        <section class="instagram-section" id="instagram">
            <div class="section-container">
                <div class="section-header text-center">
                    <div style="display: inline-flex; align-items: center; gap: 8px; background: rgba(225,48,108,0.12); color: #e1306c; padding: 6px 16px; border-radius: 20px; font-weight: 700; font-size: 0.85rem; margin-bottom: 16px;">
                        <i data-lucide="instagram" style="width: 16px; height: 16px;"></i> @ntut_drone 實飛與社團動態
                    </div>
                    <h2 class="section-title">社團動態 (Instagram @ntut_drone)</h2>
                    <p class="section-subtitle">追蹤我們的官方 IG @ntut_drone，第一手探索精彩 FPV 穿越機競速、極速翻滾特技、空拍視角與實作社課現場！</p>
                    <div style="margin-top: 20px;">
                        <a href="${igLink}" target="_blank" class="btn ig-btn-gradient" style="padding: 12px 28px; border-radius: 30px; font-size: 1rem;">
                            <i data-lucide="instagram"></i> 關注 Instagram @ntut_drone
                        </a>
                    </div>
                </div>

                <div class="ig-cards-grid">
                    <!-- IG Card 1 -->
                    <div class="ig-card">
                        <div class="ig-card-header">
                            <div class="ig-user-info">
                                <div class="ig-avatar"><img src="/assets/images/logo_ntut.jpg" alt="ntut_drone"></div>
                                <span class="ig-username">ntut_drone</span>
                            </div>
                            <span class="ig-tag">${igCard1Tag}</span>
                        </div>
                        <div class="ig-card-media">
                            ${igCard1Img ? `<img src="${igCard1Img}" alt="Instagram post">` : `
                                <div style="background: linear-gradient(135deg, #1e293b, #0f172a); width:100%; height:100%; display:flex; align-items:center; justify-content:center; flex-direction:column; color:#3b82f6; gap:10px;">
                                    <i data-lucide="video" style="width: 48px; height: 48px;"></i>
                                    <span style="font-weight: 700; color: #f8fafc; font-size: 0.9rem;">${igCard1Tag}</span>
                                </div>
                            `}
                            <div class="ig-media-badge"><i data-lucide="video" style="width: 12px; height: 12px;"></i> REEL</div>
                        </div>
                        <div class="ig-card-body">
                            <p class="ig-caption">${igCard1Caption}</p>
                            <div class="ig-card-footer">
                                <div class="ig-stats"><span>❤️ ${igCard1Likes}</span> <span>💬 ${igCard1Comments}</span></div>
                                <a href="${igLink}" target="_blank" class="ig-link-action">IG 觀看 →</a>
                            </div>
                        </div>
                    </div>

                    <!-- IG Card 2 -->
                    <div class="ig-card">
                        <div class="ig-card-header">
                            <div class="ig-user-info">
                                <div class="ig-avatar"><img src="/assets/images/logo_ntut.jpg" alt="ntut_drone"></div>
                                <span class="ig-username">ntut_drone</span>
                            </div>
                            <span class="ig-tag">${igCard2Tag}</span>
                        </div>
                        <div class="ig-card-media">
                            ${igCard2Img ? `<img src="${igCard2Img}" alt="Instagram post" style="object-fit: contain; padding: 20px; background: #0b0f19;">` : `
                                <div style="background: linear-gradient(135deg, #1e293b, #0f172a); width:100%; height:100%; display:flex; align-items:center; justify-content:center; flex-direction:column; color:#3b82f6; gap:10px;">
                                    <i data-lucide="camera" style="width: 48px; height: 48px;"></i>
                                    <span style="font-weight: 700; color: #f8fafc; font-size: 0.9rem;">${igCard2Tag}</span>
                                </div>
                            `}
                            <div class="ig-media-badge"><i data-lucide="camera" style="width: 12px; height: 12px;"></i> PHOTO</div>
                        </div>
                        <div class="ig-card-body">
                            <p class="ig-caption">${igCard2Caption}</p>
                            <div class="ig-card-footer">
                                <div class="ig-stats"><span>❤️ ${igCard2Likes}</span> <span>💬 ${igCard2Comments}</span></div>
                                <a href="${igLink}" target="_blank" class="ig-link-action">IG 觀看 →</a>
                            </div>
                        </div>
                    </div>

                    <!-- IG Card 3 -->
                    <div class="ig-card">
                        <div class="ig-card-header">
                            <div class="ig-user-info">
                                <div class="ig-avatar"><img src="/assets/images/logo_ntut.jpg" alt="ntut_drone"></div>
                                <span class="ig-username">ntut_drone</span>
                            </div>
                            <span class="ig-tag">${igCard3Tag}</span>
                        </div>
                        <div class="ig-card-media">
                            ${igCard3Img ? `<img src="${igCard3Img}" alt="Instagram post">` : `
                                <div style="background: linear-gradient(135deg, #1e293b, #0f172a); width:100%; height:100%; display:flex; align-items:center; justify-content:center; flex-direction:column; color:#3b82f6; gap:10px;">
                                    <i data-lucide="cpu" style="width: 48px; height: 48px;"></i>
                                    <span style="font-weight: 700; color: #f8fafc; font-size: 0.9rem;">${igCard3Tag}</span>
                                </div>
                            `}
                            <div class="ig-media-badge"><i data-lucide="image" style="width: 12px; height: 12px;"></i> ALBUM</div>
                        </div>
                        <div class="ig-card-body">
                            <p class="ig-caption">${igCard3Caption}</p>
                            <div class="ig-card-footer">
                                <div class="ig-stats"><span>❤️ ${igCard3Likes}</span> <span>💬 ${igCard3Comments}</span></div>
                                <a href="${igLink}" target="_blank" class="ig-link-action">IG 觀看 →</a>
                            </div>
                        </div>
                    </div>

                    <!-- IG Card 4 -->
                    <div class="ig-card">
                        <div class="ig-card-header">
                            <div class="ig-user-info">
                                <div class="ig-avatar"><img src="/assets/images/logo_ntut.jpg" alt="ntut_drone"></div>
                                <span class="ig-username">ntut_drone</span>
                            </div>
                            <span class="ig-tag">${igCard4Tag}</span>
                        </div>
                        <div class="ig-card-media">
                            ${igCard4Img ? `<img src="${igCard4Img}" alt="Instagram post">` : `
                                <div style="background: linear-gradient(135deg, #065f46, #064e3b); width:100%; height:100%; display:flex; align-items:center; justify-content:center; flex-direction:column; color:#10b981; gap:10px;">
                                    <i data-lucide="plane-takeoff" style="width: 48px; height: 48px;"></i>
                                    <span style="font-weight: 700; color: #f8fafc; font-size: 0.9rem;">${igCard4Tag}</span>
                                </div>
                            `}
                            <div class="ig-media-badge"><i data-lucide="users" style="width: 12px; height: 12px;"></i> EVENT</div>
                        </div>
                        <div class="ig-card-body">
                            <p class="ig-caption">${igCard4Caption}</p>
                            <div class="ig-card-footer">
                                <div class="ig-stats"><span>❤️ ${igCard4Likes}</span> <span>💬 ${igCard4Comments}</span></div>
                                <a href="${igLink}" target="_blank" class="ig-link-action">IG 觀看 →</a>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>

        <!-- Dynamic Blog Section -->
        <section class="about-section" id="dynamic-blog" style="background: var(--bg-darker);">
            <div class="section-container">
                <div class="section-header text-center">
                    <h2 class="section-title">${t.blogTitle}</h2>
                    <p class="section-subtitle">${t.blogSubtitle}</p>
                </div>
                <div class="about-grid">
                    ${postsHtml}
                </div>
                <div class="text-center" style="margin-top: 40px;">
                    <a href="/blog?lang=${lang}" class="btn btn-secondary">${t.blogMore} <i data-lucide="arrow-right"></i></a>
                </div>
            </div>
        </section>

        <!-- FAQ Section -->
        <section class="faq-section" id="faq">
            <div class="section-container">
                <div class="section-header text-center">
                    <h2 class="section-title">${t.faqTitle}</h2>
                    <p class="section-subtitle">${t.faqSubtitle}</p>
                </div>

                <div class="faq-accordion-wrapper">
                    <div class="faq-card">
                        <button class="faq-question">
                            <span>${t.faqQ1}</span>
                            <span class="faq-icon"><i data-lucide="chevron-down"></i></span>
                        </button>
                        <div class="faq-answer">
                            <p>${t.faqA1}</p>
                        </div>
                    </div>

                    <div class="faq-card">
                        <button class="faq-question">
                            <span>${t.faqQ2}</span>
                            <span class="faq-icon"><i data-lucide="chevron-down"></i></span>
                        </button>
                        <div class="faq-answer">
                            <p>${t.faqA2}</p>
                        </div>
                    </div>

                    <div class="faq-card">
                        <button class="faq-question">
                            <span>${t.faqQ3}</span>
                            <span class="faq-icon"><i data-lucide="chevron-down"></i></span>
                        </button>
                        <div class="faq-answer">
                            <p>${t.faqA3}</p>
                        </div>
                    </div>

                    <div class="faq-card">
                        <button class="faq-question">
                            <span>${t.faqQ4}</span>
                            <span class="faq-icon"><i data-lucide="chevron-down"></i></span>
                        </button>
                        <div class="faq-answer">
                            <p>${t.faqA4}</p>
                        </div>
                    </div>
                </div>
            </div>
        </section>

        <!-- Call to Action Banner -->
        <section class="cta-section">
            <div class="cta-glow-bg"></div>
            <div class="cta-container">
                <h2 class="cta-title">${t.ctaTitle}</h2>
                <p class="cta-text">${t.ctaDesc}</p>
                <div class="cta-buttons">
                    <a href="https://lin.ee/s5YJgGI" target="_blank" class="btn btn-line btn-large glow-pulse">
                        <i data-lucide="message-square"></i> ${t.ctaBtnLine}
                    </a>
                    <a href="https://www.instagram.com/ntut_drone/" target="_blank" class="btn btn-secondary btn-large">
                        <i data-lucide="instagram"></i> ${t.ctaBtnIg}
                    </a>
                </div>
            </div>
        </section>

        <footer>
            <div class="footer-container">
                <div class="footer-brand">
                    <a href="#" class="logo">
                        <img src="/assets/images/logo_ntut.jpg" alt="NTUT Drone Logo" style="height: 38px; width: 38px; object-fit: contain; border-radius: 6px; margin-right: 8px;">
                        <span class="logo-text">
                            <span class="brand-en">NTUT DRONE</span>
                            <span class="brand-zh">北科無人機社</span>
                        </span>
                    </a>
                    <p class="footer-desc">${t.footerDesc}</p>
                    <div class="footer-socials" style="display: flex; gap: 10px; margin-top: 12px;">
                        <a href="mailto:ntut.droneclub@gmail.com" class="social-icon-btn" title="ntut.droneclub@gmail.com" aria-label="Email"><i data-lucide="mail"></i><span class="fallback-text">✉️</span></a>
                        <a href="https://www.instagram.com/ntut_drone/" target="_blank" class="social-icon-btn" aria-label="Instagram"><i data-lucide="instagram"></i><span class="fallback-text">IG</span></a>
                        <a href="https://lin.ee/s5YJgGI" target="_blank" class="social-icon-btn" aria-label="LINE"><i data-lucide="message-square"></i><span class="fallback-text">LINE</span></a>
                    </div>
                </div>
                
                <div class="footer-links-group">
                    <div class="footer-col">
                        <h4>快速導覽</h4>
                        <a href="/?lang=${lang}">回到首頁</a>
                        <a href="#about">${t.navAbout}</a>
                        <a href="#features">${t.navFeatures}</a>
                        <a href="/blog?lang=${lang}">${t.navBlog}</a>
                    </div>
                    <div class="footer-col">
                        <h4>聯絡資訊</h4>
                        <span>${t.footerLocation}</span>
                        <a href="mailto:ntut.droneclub@gmail.com" style="color: var(--color-primary); font-weight: 700; margin-bottom: 8px;">${t.footerMail}</a>
                        <a href="https://lin.ee/s5YJgGI" target="_blank" class="footer-highlight-link">${t.footerLineChat} <i data-lucide="arrow-up-right"></i></a>
                        <a href="/admin" class="footer-highlight-link" style="color: var(--color-purple) !important; margin-top: 10px;">${t.footerAdmin} <i data-lucide="lock"></i></a>
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
export function renderBlogList(posts = [], lang = 'zh') {
    const t = locales[lang] || locales.zh;
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
                        <h3 style="margin-top: 10px; margin-bottom: 14px; font-size: 1.4rem; line-height: 1.3;">${post.title}</h3>
                        <p style="color: var(--text-secondary); font-size: 0.95rem; margin-bottom: 24px; line-height: 1.6;">${post.summary || ''}</p>
                    </div>
                    <a href="/blog/${post.slug}?lang=${lang}" class="btn btn-secondary" style="width: 100%; text-align: center; padding: 10px;">${lang === 'zh' ? '閱讀文章' : 'Read Article'} <i data-lucide="arrow-right"></i></a>
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
                <div class="about-grid" style="grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 30px;">
                    ${postsListHtml}
                </div>
            </div>
        </main>
        ${getFooter(lang)}
    `;
}

// 3. Render Blog Post Detail Page
export function renderBlogPost(post, parsedContentHtml, lang = 'zh') {
    const t = locales[lang] || locales.zh;
    const dateStr = new Date(post.date).toLocaleDateString(lang === 'zh' ? 'zh-TW' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    return `
        ${getHeader(post.title, lang)}
        <main style="padding-top: 140px; min-height: 80vh;">
            <article class="section-container" style="max-width: 800px; padding: 40px 24px;">
                <div style="margin-bottom: 40px; border-bottom: 1px solid var(--border-glass); padding-bottom: 30px;">
                    <a href="/blog?lang=${lang}" style="color: var(--color-cyan); display: inline-flex; align-items: center; gap: 6px; font-weight: 500; margin-bottom: 20px; font-size: 0.95rem;">
                        <i data-lucide="arrow-left" style="width: 16px; height: 16px;"></i> ${t.blogBack}
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
        ${getFooter(lang)}
    `;
}

// 4. Render Dynamic Custom Page
export function renderCustomPage(page, parsedContentHtml, lang = 'zh') {
    return `
        ${getHeader(page.title, lang)}
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
            .markdown-body p { margin-bottom: 20px; }
            .markdown-body img { max-width: 100%; border-radius: 16px; border: 1px solid var(--border-glass); margin: 30px 0; }
            .markdown-body a { color: var(--color-cyan); text-decoration: underline; }
        </style>
        ${getFooter(lang)}
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
        <script src="https://cdn.jsdelivr.net/npm/lucide@latest/dist/umd/lucide.js"></script>
        <link rel="stylesheet" href="/style.css">
        <style>
            body {
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                background: #f3f2f1;
            }
            .login-container {
                width: 100%;
                max-width: 420px;
                padding: 40px 32px;
                background: #ffffff;
                border: 1px solid #b1b4b6;
                border-radius: 4px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.08);
            }
            .form-group {
                margin-bottom: 20px;
            }
            .form-group label {
                display: block;
                font-size: 0.9rem;
                color: #0b0c10;
                margin-bottom: 8px;
                font-weight: 700;
            }
            .form-control {
                width: 100%;
                padding: 12px 16px;
                background: #ffffff;
                border: 1px solid #b1b4b6;
                border-radius: 4px;
                color: #0b0c10;
                font-family: inherit;
                font-size: 1rem;
                transition: var(--transition-fast);
            }
            .form-control:focus {
                outline: none;
                border-color: #000;
                box-shadow: 0 0 0 3px #ffdd00;
            }
        </style>
    </head>
    <body>
        <div class="login-container">
            <div class="text-center" style="margin-bottom: 30px;">
                <div style="margin: 0 auto 16px auto; width: 64px; height: 64px;">
                    <img src="/assets/images/logo_ntut.jpg" alt="NTUT Drone Logo" style="width: 100%; height: 100%; object-fit: contain; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                </div>
                <h2 style="font-size: 1.5rem; font-weight: 800; letter-spacing: 0.5px;">系統後台登入</h2>
                <p style="color: var(--text-muted); font-size: 0.85rem; margin-top: 4px;">北科無人機社官方網站後台</p>
            </div>
            
            ${errorMessage ? `<div style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; padding: 12px; border-radius: 12px; font-size: 0.875rem; margin-bottom: 20px; text-align: center;"><i data-lucide="alert-circle" style="width: 16px; height: 16px; display: inline; vertical-align: middle; margin-right: 6px;"></i> ${errorMessage}</div>` : ''}
            
            <form action="/api/login" method="POST">
                <div class="form-group">
                    <label for="password">管理員密碼</label>
                    <input type="password" name="password" id="password" class="form-control" placeholder="請輸入後台密碼" required autofocus>
                </div>
                <button type="submit" class="btn btn-primary" style="width: 100%; border-radius: 12px; padding: 14px; margin-top: 10px;">安全登入</button>
            </form>
            <div class="text-center" style="margin-top: 24px;">
                <a href="/" style="font-size: 0.85rem; color: var(--text-muted);"><i data-lucide="arrow-left" style="width: 12px; height: 12px; display: inline; vertical-align: middle;"></i> 返回網站首頁</a>
            </div>
        </div>
        <script>
            if (typeof lucide !== 'undefined' && lucide.createIcons) { lucide.createIcons(); }
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

// 6. Render Admin Dashboard Page with i18n Post Creation
export function renderAdminDashboard(posts = [], pages = []) {
    return `
    <!DOCTYPE html>
    <html lang="zh-TW">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>後台管理面板 | 北科無人機社</title>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;700&family=Outfit:wght@400;600;800&display=swap" rel="stylesheet">
        <script src="https://cdn.jsdelivr.net/npm/lucide@latest/dist/umd/lucide.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/marked@latest/marked.min.js"></script>
        <script>
            // Pre-define panel navigation so onclick handlers never get ReferenceError
            // even if the bottom <script> hasn't parsed yet.
            function showPanel(panelName) {
                document.querySelectorAll('.panel').forEach(function(p) { p.classList.remove('active'); });
                document.querySelectorAll('.nav-item').forEach(function(btn) { btn.classList.remove('active'); });
                var panel = document.getElementById('panel-' + panelName);
                if (panel) panel.classList.add('active');
                document.querySelectorAll('.sidebar-nav .nav-item').forEach(function(btn) {
                    if (btn.getAttribute('onclick') && btn.getAttribute('onclick').indexOf(panelName) !== -1) {
                        btn.classList.add('active');
                    }
                });
                if (typeof closePostForm === 'function') closePostForm();
                if (typeof closePageForm === 'function') closePageForm();
            }
            function logout() {
                fetch('/api/logout', { method: 'POST' }).then(function() { location.href = '/admin'; });
            }
            function openPostForm() {
                var listView = document.getElementById('posts-list-view');
                var formView = document.getElementById('posts-form-view');
                if (listView) listView.style.display = 'none';
                if (formView) formView.style.display = 'block';
                var title = document.getElementById('post-form-title');
                if (title) title.innerText = '新增文章';
                var form = document.getElementById('post-form');
                if (form) form.reset();
                var origSlug = document.getElementById('post-original-slug');
                if (origSlug) origSlug.value = '';
                var slug = document.getElementById('post-slug');
                if (slug) slug.disabled = false;
            }
            function openPageForm() {
                var listView = document.getElementById('pages-list-view');
                var formView = document.getElementById('pages-form-view');
                if (listView) listView.style.display = 'none';
                if (formView) formView.style.display = 'block';
                var title = document.getElementById('page-form-title');
                if (title) title.innerText = '新增頁面';
                var form = document.getElementById('page-form');
                if (form) form.reset();
                var origSlug = document.getElementById('page-original-slug');
                if (origSlug) origSlug.value = '';
                var slug = document.getElementById('page-slug');
                if (slug) slug.disabled = false;
            }
        </script>
        <style>
            :root {
                --bg-deep: #0b0f19;
                --bg-darker: #0f172a;
                --bg-card: #1e293b;
                --color-cyan: #3b82f6;
                --color-purple: #a78bfa;
                --text-primary: #f8fafc;
                --text-secondary: #94a3b8;
                --text-muted: #64748b;
                --border-glass: rgba(255, 255, 255, 0.12);
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
                color: #ffffff;
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
                border-radius: 4px;
                color: #cbd5e1;
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
                color: #ffffff;
                background: rgba(255, 255, 255, 0.1);
            }
            .nav-item.active {
                border-left: 4px solid #ffdd00;
                border-radius: 0 4px 4px 0;
                background: #1d70b8;
                color: #ffffff;
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
                background: #1e293b;
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 12px;
                padding: 30px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
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
                background: #3b82f6;
                color: #fff;
                font-weight: 700;
            }
            .btn-primary:hover {
                background: #60a5fa;
            }
            .btn-secondary {
                background: #334155;
                color: #f8fafc;
                border: 1px solid rgba(255, 255, 255, 0.12);
            }
            .btn-secondary:hover {
                background: #475569;
            }
            .btn-danger {
                background: #ef4444;
                color: #fff;
                border: 1px solid #ef4444;
            }
            .btn-danger:hover {
                background: #dc2626;
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
                background: rgba(255,255,255,0.04);
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
                background: #0f172a;
                border: 1px solid rgba(255, 255, 255, 0.15);
                border-radius: 8px;
                color: #f8fafc;
                font-family: inherit;
                font-size: 0.95rem;
            }
            .form-control:focus {
                outline: none;
                border-color: #3b82f6;
                box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.25);
            }
            
            /* Toast Message */
            #toast {
                position: fixed;
                pointer-events: none;
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
                pointer-events: auto;
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

            /* --- Rich Markdown Visual Editor Toolbar & Preview --- */
            .md-editor-container {
                border: 1px solid rgba(255, 255, 255, 0.15);
                border-radius: 10px;
                overflow: hidden;
                background: #0f172a;
                margin-top: 8px;
            }
            .md-toolbar {
                display: flex;
                align-items: center;
                flex-wrap: wrap;
                gap: 4px;
                padding: 8px 12px;
                background: #1e293b;
                border-bottom: 1px solid rgba(255, 255, 255, 0.12);
            }
            .md-toolbar-group {
                display: flex;
                align-items: center;
                gap: 3px;
            }
            .tb-divider {
                width: 1px;
                height: 20px;
                background: rgba(255,255,255,0.15);
                margin: 0 6px;
            }
            .tb-btn {
                background: transparent;
                border: 1px solid transparent;
                color: #cbd5e1;
                border-radius: 6px;
                padding: 6px 10px;
                font-size: 0.85rem;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 4px;
                transition: all 0.15s ease;
                font-family: inherit;
            }
            .tb-btn:hover {
                background: rgba(255, 255, 255, 0.12);
                color: #ffffff;
                border-color: rgba(255, 255, 255, 0.2);
            }
            .tb-btn i {
                width: 15px;
                height: 15px;
            }
            .tb-preview-btn.active {
                background: #3b82f6 !important;
                color: #ffffff !important;
                font-weight: 700;
            }
            .editor-split-wrapper {
                display: flex;
                min-height: 380px;
            }
            .editor-textarea {
                flex: 1;
                border: none !important;
                border-radius: 0 !important;
                background: #0b0f19 !important;
                padding: 16px !important;
                resize: vertical;
                font-family: 'Outfit', monospace;
                font-size: 0.95rem;
                line-height: 1.6;
                color: #f8fafc;
                min-height: 380px;
            }
            .editor-preview-pane {
                flex: 1;
                border-left: 1px solid rgba(255, 255, 255, 0.12);
                background: #0f172a;
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }
            .preview-header {
                background: rgba(255,255,255,0.04);
                padding: 8px 16px;
                font-size: 0.78rem;
                font-weight: 700;
                color: #3b82f6;
                border-bottom: 1px solid rgba(255, 255, 255, 0.12);
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .preview-body {
                padding: 20px;
                overflow-y: auto;
                flex-grow: 1;
                max-height: 450px;
                color: #e2e8f0;
                line-height: 1.7;
                font-size: 0.95rem;
            }
            .preview-body h1, .preview-body h2, .preview-body h3 {
                color: #ffffff;
                margin-top: 16px;
                margin-bottom: 10px;
                font-weight: 800;
            }
            .preview-body h1 { font-size: 1.5rem; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 6px; }
            .preview-body h2 { font-size: 1.25rem; }
            .preview-body h3 { font-size: 1.1rem; }
            .preview-body p { margin-bottom: 12px; }
            .preview-body img { max-width: 100%; border-radius: 8px; margin: 12px 0; border: 1px solid rgba(255,255,255,0.1); }
            .preview-body blockquote {
                border-left: 4px solid #3b82f6;
                padding-left: 14px;
                color: #94a3b8;
                margin: 12px 0;
                font-style: italic;
                background: rgba(59,130,246,0.05);
                padding-top: 6px; padding-bottom: 6px;
            }
            .preview-body code {
                background: rgba(255,255,255,0.1);
                padding: 2px 6px;
                border-radius: 4px;
                font-family: monospace;
                color: #38bdf8;
            }
            .preview-body pre {
                background: #020617;
                padding: 14px;
                border-radius: 8px;
                overflow-x: auto;
                margin: 12px 0;
                border: 1px solid rgba(255,255,255,0.1);
            }
            .preview-body pre code { background: none; padding: 0; }
            .preview-body ul, .preview-body ol { margin-left: 24px; margin-bottom: 12px; }
            .preview-body table { width: 100%; border-collapse: collapse; margin: 16px 0; }
            .preview-body th, .preview-body td { border: 1px solid rgba(255,255,255,0.15); padding: 8px 12px; }
            .preview-body th { background: rgba(255,255,255,0.06); text-align: left; }
        </style>
    </head>
    <body>
        <div class="sidebar">
            <div>
                <div class="sidebar-logo">
                    <img src="/assets/images/logo_ntut.jpg" alt="NTUT Drone" style="width: 28px; height: 28px; object-fit: contain; border-radius: 6px; vertical-align: middle; margin-right: 8px;"> NTUT DRONE 後台
                </div>
                <div class="sidebar-nav">
                    <button class="nav-item active" onclick="showPanel('posts')"><i data-lucide="book-open"></i> 文章管理</button>
                    <button class="nav-item" onclick="showPanel('pages')"><i data-lucide="file-text"></i> 頁面管理</button>
                    <button class="nav-item" onclick="showPanel('media')"><i data-lucide="image"></i> 媒體庫上傳</button>
                    <button class="nav-item" onclick="showPanel('homepage')"><i data-lucide="home"></i> 首頁設定</button>
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
                                    <th>語言</th>
                                    <th>網址路徑 (Slug)</th>
                                    <th style="width: 180px; text-align: right;">動作</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${posts.map(post => `
                                    <tr id="row-post-${post.slug}">
                                        <td>${new Date(post.date).toLocaleDateString('zh-TW')}</td>
                                        <td><strong>${post.title}</strong></td>
                                        <td><span style="background:rgba(255,255,255,0.06); padding:4px 8px; border-radius:6px; font-size:0.8rem; font-weight:600; color:var(--color-cyan);">${post.lang === 'en' ? 'English' : '中文'}</span></td>
                                        <td><code>/blog/${post.slug}</code></td>
                                        <td style="text-align: right;">
                                            <button class="btn btn-secondary" onclick="editPost('${post.slug}')" style="padding: 6px 12px; font-size: 0.8rem;"><i data-lucide="edit-3" style="width: 12px; height: 12px;"></i></button>
                                            <button class="btn btn-danger" onclick="deletePost('${post.slug}')" style="padding: 6px 12px; font-size: 0.8rem;"><i data-lucide="trash-2" style="width: 12px; height: 12px;"></i></button>
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
                        <div style="display:grid; grid-template-columns: 2fr 1fr; gap:20px;">
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
                                        <button type="button" class="tb-btn" onclick="insertMD('post-content', '`', '`', '程式碼')" title="行內程式碼 (Code)"><i data-lucide="code"></i></button>
                                        <button type="button" class="tb-btn" onclick="insertMD('post-content', '\n```javascript\n', '\n```\n', '// 在此寫入程式碼')" title="程式碼區塊 (Code Block)"><i data-lucide="terminal"></i></button>
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
                                    <tr id="row-page-${page.slug}">
                                        <td><strong>${page.title}</strong></td>
                                        <td><span style="background:rgba(255,255,255,0.06); padding:4px 8px; border-radius:6px; font-size:0.8rem; font-weight:600; color:var(--color-cyan);">${page.lang === 'en' ? 'English' : '中文'}</span></td>
                                        <td><code>/page/${page.slug}</code></td>
                                        <td style="text-align: right;">
                                            <button class="btn btn-secondary" onclick="editPage('${page.slug}')" style="padding: 6px 12px; font-size: 0.8rem;"><i data-lucide="edit-3" style="width: 12px; height: 12px;"></i></button>
                                            <button class="btn btn-danger" onclick="deletePage('${page.slug}')" style="padding: 6px 12px; font-size: 0.8rem;"><i data-lucide="trash-2" style="width: 12px; height: 12px;"></i></button>
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
                        <div style="display:grid; grid-template-columns: 2fr 1fr; gap:20px;">
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
                                        <button type="button" class="tb-btn" onclick="insertMD('page-content', '`', '`', '程式碼')" title="行內程式碼 (Code)"><i data-lucide="code"></i></button>
                                        <button type="button" class="tb-btn" onclick="insertMD('page-content', '\n```javascript\n', '\n```\n', '// 在此寫入程式碼')" title="程式碼區塊 (Code Block)"><i data-lucide="terminal"></i></button>
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
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
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
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
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
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
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
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
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
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                            <div class="form-group">
                                <label for="hp-ig1-tag">標籤名稱 (如: FPV 穿越機)</label>
                                <input type="text" id="hp-ig1-tag" class="form-control" placeholder="FPV 穿越機">
                            </div>
                            <div class="form-group">
                                <label for="hp-ig1-img">圖片網址 (可用媒體庫上傳連結，或留空)</label>
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
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
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
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
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
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
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
            if (typeof lucide !== 'undefined' && lucide.createIcons) { lucide.createIcons(); }

            // showPanel, openPostForm, openPageForm, logout are defined in <head> script


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
                if (typeof lucide !== 'undefined' && lucide.createIcons) { lucide.createIcons(); }
                
                toast.classList.add('show');
                setTimeout(() => {
                    toast.classList.remove('show');
                }, 3000);
            }

            // ── Rich Markdown Visual Editor & Preview Helpers ───────────────
            function simpleMarkdownParse(src) {
                if (typeof marked !== 'undefined' && marked.parse) {
                    return marked.parse(src);
                }
                var html = src
                    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
                    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
                    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
                    .replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>')
                    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                    .replace(/\*(.*?)\*/g, '<em>$1</em>')
                    .replace(/~~(.*?)~~/g, '<del>$1</del>')
                    .replace(/`([^`]+)`/g, '<code>$1</code>')
                    .replace(/!\[(.*?)\]\((.*?)\)/g, '<img src="$2" alt="$1">')
                    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank">$1</a>')
                    .replace(/\n/g, '<br>');
                return html;
            }

            function insertMD(targetId, prefix, suffix, defaultText) {
                var textarea = document.getElementById(targetId);
                if (!textarea) return;
                textarea.focus();

                var start = textarea.selectionStart;
                var end = textarea.selectionEnd;
                var selected = textarea.value.substring(start, end);
                var textToWrap = selected || defaultText;

                var replacement = prefix + textToWrap + suffix;
                textarea.value = textarea.value.substring(0, start) + replacement + textarea.value.substring(end);
                
                var newStart = start + prefix.length;
                var newEnd = newStart + textToWrap.length;
                textarea.setSelectionRange(newStart, newEnd);
                
                updateLivePreview(targetId);
            }

            function insertLinkMD(targetId) {
                var url = prompt('請輸入超連結網址 (例如 https://example.com):', 'https://');
                if (!url) return;
                var text = prompt('請輸入顯示的連結文字:', '點此造訪網址');
                insertMD(targetId, '[' + (text || '連結文字') + '](' + url + ')', '', '');
            }

            function insertImageMD(targetId) {
                var url = prompt('請輸入圖片網址 (可用後台「媒體庫」複製的網址):', '/assets/uploads/');
                if (!url) return;
                var alt = prompt('請輸入圖片說明文字 (Alt text):', '圖片說明');
                insertMD(targetId, '![' + (alt || '圖片說明') + '](' + url + ')', '', '');
            }

            function insertTableMD(targetId) {
                var tableTemplate = '\n| 欄位標題 1 | 欄位標題 2 | 欄位標題 3 |\n| --- | --- | --- |\n| 內容資料 A | 內容資料 B | 內容資料 C |\n| 內容資料 D | 內容資料 E | 內容資料 F |\n';
                insertMD(targetId, tableTemplate, '', '');
            }

            function togglePreview(targetId) {
                var pane = document.getElementById('preview-' + targetId);
                var container = document.getElementById('container-' + targetId);
                var btn = container ? container.querySelector('.tb-preview-btn') : null;

                if (!pane) return;
                if (pane.style.display === 'none' || !pane.style.display) {
                    pane.style.display = 'flex';
                    if (btn) btn.classList.add('active');
                    updateLivePreview(targetId);
                } else {
                    pane.style.display = 'none';
                    if (btn) btn.classList.remove('active');
                }
            }

            function updateLivePreview(targetId) {
                var textarea = document.getElementById(targetId);
                var body = document.getElementById('preview-body-' + targetId);
                if (!textarea || !body) return;
                body.innerHTML = simpleMarkdownParse(textarea.value || '*(尚未輸入任何內容)*');
                if (typeof lucide !== 'undefined' && lucide.createIcons) { lucide.createIcons(); }
            }

            function openPostForm() {
                var listView = document.getElementById('posts-list-view');
                var formView = document.getElementById('posts-form-view');
                if (listView) listView.style.display = 'none';
                if (formView) formView.style.display = 'block';
                var title = document.getElementById('post-form-title');
                if (title) title.innerText = '新增文章';
                var form = document.getElementById('post-form');
                if (form) form.reset();
                var origSlug = document.getElementById('post-original-slug');
                if (origSlug) origSlug.value = '';
                var slug = document.getElementById('post-slug');
                if (slug) slug.disabled = false;
                updateLivePreview('post-content');
            }

            function closePostForm() {
                document.getElementById('posts-list-view').style.display = 'block';
                document.getElementById('posts-form-view').style.display = 'none';
            }

            async function savePost(e) {
                e.preventDefault();
                const title = document.getElementById('post-title').value;
                const lang = document.getElementById('post-lang').value;
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
                        body: JSON.stringify({ title, lang, slug, summary, content, originalSlug })
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
                    document.getElementById('post-lang').value = post.lang || 'zh';
                    document.getElementById('post-slug').value = post.slug;
                    document.getElementById('post-slug').disabled = true;
                    document.getElementById('post-summary').value = post.summary || '';
                    document.getElementById('post-content').value = post.content;
                    document.getElementById('post-original-slug').value = post.slug;
                    updateLivePreview('post-content');
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

            function openPageForm() {
                var listView = document.getElementById('pages-list-view');
                var formView = document.getElementById('pages-form-view');
                if (listView) listView.style.display = 'none';
                if (formView) formView.style.display = 'block';
                var title = document.getElementById('page-form-title');
                if (title) title.innerText = '新增頁面';
                var form = document.getElementById('page-form');
                if (form) form.reset();
                var origSlug = document.getElementById('page-original-slug');
                if (origSlug) origSlug.value = '';
                var slug = document.getElementById('page-slug');
                if (slug) slug.disabled = false;
                updateLivePreview('page-content');
            }

            function closePageForm() {
                document.getElementById('pages-list-view').style.display = 'block';
                document.getElementById('pages-form-view').style.display = 'none';
            }

            async function savePage(e) {
                e.preventDefault();
                const title = document.getElementById('page-title').value;
                const lang = document.getElementById('page-lang').value;
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
                        body: JSON.stringify({ title, lang, slug, content, originalSlug })
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
                    document.getElementById('page-lang').value = page.lang || 'zh';
                    document.getElementById('page-slug').value = page.slug;
                    document.getElementById('page-slug').disabled = true;
                    document.getElementById('page-content').value = page.content;
                    document.getElementById('page-original-slug').value = page.slug;
                    updateLivePreview('page-content');
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
                        showToast('圖片上傳並成功提交到 GitHub！(約30秒自動同步至 Cloudflare)');
                        const previewUrl = URL.createObjectURL(file);
                        addUploadedImageToGrid(data.filename, data.url, previewUrl);
                    } else {
                        showToast(data.error || '上傳失敗', true);
                    }
                } catch (err) {
                    showToast('圖片上傳連線失敗', true);
                }
            }

            function addUploadedImageToGrid(filename, url, previewUrl) {
                document.getElementById('uploaded-files-title').style.display = 'block';
                const grid = document.getElementById('uploaded-files-grid');
                const card = document.createElement('div');
                card.style.background = 'rgba(255,255,255,0.03)';
                card.style.border = '1px solid var(--border-glass)';
                card.style.borderRadius = '12px';
                card.style.padding = '12px';
                card.style.textAlign = 'center';
                
                const displayUrl = previewUrl || url;
                const markdownText = '![' + filename + '](' + url + ')';

                card.innerHTML = '<img src="' + displayUrl + '" style="max-width:100%; height:120px; object-fit:cover; border-radius:8px; margin-bottom:10px;">' +
                    '<div style="font-size:0.75rem; text-overflow:ellipsis; overflow:hidden; white-space:nowrap; color:var(--text-muted); margin-bottom:8px;">' + filename + '</div>' +
                    '<button class="btn btn-secondary copy-btn" style="width:100%; padding:6px; font-size:0.75rem; justify-content:center;"><i data-lucide="copy" style="width:12px; height:12px;"></i> 複製 MD</button>';
                
                const copyBtn = card.querySelector('.copy-btn');
                if (copyBtn) {
                    copyBtn.onclick = function() { copyText(markdownText); };
                }

                grid.insertBefore(card, grid.firstChild);
                if (typeof lucide !== 'undefined' && lucide.createIcons) { lucide.createIcons(); }
            }

            function copyText(text) {
                navigator.clipboard.writeText(text);
                showToast('已複製 Markdown 圖片代碼！');
            }

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

            // ── Homepage Settings ───────────────────────────────────────
            const hpFieldIdMap = {
                heroTitle: 'hp-hero-title', heroDesc: 'hp-hero-desc', heroBadge: 'hp-hero-badge',
                aboutTitle: 'hp-about-title', aboutSubtitle: 'hp-about-subtitle',
                aboutCard1Title: 'hp-about-c1-title', aboutCard1Desc: 'hp-about-c1-desc',
                aboutCard2Title: 'hp-about-c2-title', aboutCard2Desc: 'hp-about-c2-desc',
                aboutCard3Title: 'hp-about-c3-title', aboutCard3Desc: 'hp-about-c3-desc',
                featuresTitle: 'hp-features-title', featuresSubtitle: 'hp-features-subtitle',
                feat1Title: 'hp-feat1-title', feat1Desc: 'hp-feat1-desc',
                feat2Title: 'hp-feat2-title', feat2Desc: 'hp-feat2-desc',
                feat3Title: 'hp-feat3-title', feat3Desc: 'hp-feat3-desc',
                feat4Title: 'hp-feat4-title', feat4Desc: 'hp-feat4-desc',
                ctaTitle: 'hp-cta-title', ctaDesc: 'hp-cta-desc',
                lineLink: 'hp-line-link', igLink: 'hp-ig-link', emailLink: 'hp-email',
                igCard1Tag: 'hp-ig1-tag', igCard1Caption: 'hp-ig1-caption', igCard1Img: 'hp-ig1-img', igCard1Likes: 'hp-ig1-likes', igCard1Comments: 'hp-ig1-comments',
                igCard2Tag: 'hp-ig2-tag', igCard2Caption: 'hp-ig2-caption', igCard2Img: 'hp-ig2-img', igCard2Likes: 'hp-ig2-likes', igCard2Comments: 'hp-ig2-comments',
                igCard3Tag: 'hp-ig3-tag', igCard3Caption: 'hp-ig3-caption', igCard3Img: 'hp-ig3-img', igCard3Likes: 'hp-ig3-likes', igCard3Comments: 'hp-ig3-comments',
                igCard4Tag: 'hp-ig4-tag', igCard4Caption: 'hp-ig4-caption', igCard4Img: 'hp-ig4-img', igCard4Likes: 'hp-ig4-likes', igCard4Comments: 'hp-ig4-comments'
            };

            async function loadHomepageData() {
                try {
                    const res = await fetch('/api/homepage');
                    if (!res.ok) return;
                    const data = await res.json();
                    Object.keys(hpFieldIdMap).forEach(function(key) {
                        const elem = document.getElementById(hpFieldIdMap[key]);
                        if (elem && data[key] !== undefined) {
                            elem.value = data[key];
                        }
                    });
                } catch (e) { /* silently ignore */ }
            }
            loadHomepageData();

            async function saveHomepage() {
                const payload = {};
                Object.keys(hpFieldIdMap).forEach(function(key) {
                    const elem = document.getElementById(hpFieldIdMap[key]);
                    if (elem) payload[key] = elem.value;
                });
                try {
                    const res = await fetch('/api/homepage', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    if (res.ok) {
                        showToast('所有首頁設定已儲存！前台即時生效。');
                    } else {
                        const d = await res.json();
                        showToast(d.error || '儲存失敗', true);
                    }
                } catch (e) {
                    showToast('連線失敗，請重試', true);
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
