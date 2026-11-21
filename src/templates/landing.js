import { locales } from '../locales.js';
import { escapeHtml, safeUrl, sanitizeInline } from '../html.js';
import { PWA_HEAD_TAGS, mobileBottomNav } from './layout.js';

// 1. Render Landing Page with Dynamic Blog Posts
export function renderLandingPage(latestPosts = [], lang = 'zh', override = {}) {
    lang = lang === 'en' ? 'en' : 'zh';
    const t = locales[lang];
    const o = Object.fromEntries(Object.entries(override).map(([key, value]) => [key,
        /Link$|Img$/.test(key) ? escapeHtml(safeUrl(value)) : sanitizeInline(value)
    ]));
    
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
                        <h3 style="margin-top: 8px; margin-bottom: 12px; font-size: 1.25rem;">${escapeHtml(post.title)}</h3>
                        <p style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 20px;">${escapeHtml(post.summary || '')}</p>
                    </div>
                    <a href="/blog/${escapeHtml(post.slug)}?lang=${lang}" class="cta-nav-btn" style="text-align: center; display: block; width: 100%;">閱讀全文 <i data-lucide="arrow-right" style="width: 14px; height: 14px; display: inline; vertical-align: middle;"></i></a>
                </div>
            `;
        });
    }

    return `
    <!DOCTYPE html>
    <html lang="${lang}">
    <head>
        <meta charset="UTF-8">
        ${PWA_HEAD_TAGS}
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
        <script src="/vendor/lucide-1.65.0.min.js"></script>
        <link rel="stylesheet" href="/style.css">
        <link rel="stylesheet" href="/glass.css">
        <script src="/theme.js"></script>
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
                    <a href="/calendar?lang=${lang}" class="nav-link">${t.navCalendar}</a>
                    <a href="/download?lang=${lang}" class="nav-link">${t.navDownload}</a>
                    <a href="#faq" class="nav-link">${t.navFaq}</a>
                </nav>

                <div class="nav-socials">
                    <!-- Language Toggle -->
                    <a href="?lang=${t.langToggleQuery}" class="cta-nav-btn" style="background:none; border: 1px solid var(--border-color); color:var(--text-primary); margin-right:4px; padding: 6px 12px;">
                        <span style="font-size: 1.1rem; margin-right: 4px;">🌐</span> ${t.langToggleText}
                    </a>
                    <!-- Theme Toggle -->
                    <button id="theme-toggle-btn" class="theme-toggle-btn" data-theme-toggle title="切換深色/淺色模式">☀️</button>
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
                    <button class="mobile-menu-toggle" type="button" aria-label="開啟選單" aria-controls="mobile-drawer" aria-expanded="false">
                        <i data-lucide="menu"></i>
                    </button>
                </div>
            </div>
        </header>

        <div class="mobile-drawer" id="mobile-drawer">
            <div class="drawer-header">
                <span class="drawer-logo"><img src="/assets/images/logo_ntut.jpg" alt="NTUT Drone Logo" style="height: 28px; width: 28px; object-fit: contain; border-radius: 4px; vertical-align: middle; margin-right: 6px;"> NTUT DRONE</span>
                <button class="drawer-close" type="button" aria-label="關閉選單"><i data-lucide="x"></i></button>
            </div>
            <nav class="drawer-links">
                <a href="#about" class="drawer-link">${t.navAbout}</a>
                <a href="#features" class="drawer-link">${t.navFeatures}</a>
                <a href="#instagram" class="drawer-link" style="color:#e1306c; font-weight:700;">📸 ${lang === 'zh' ? 'IG 實飛動態' : 'IG Feed'}</a>
                <a href="#dynamic-blog" class="drawer-link">${lang === 'zh' ? '最新文章' : 'Latest Posts'}</a>
                <a href="/calendar?lang=${lang}" class="drawer-link">${t.navCalendar}</a>
                <a href="/download?lang=${lang}" class="drawer-link">📲 ${t.navDownload}</a>
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
                            <h3 class="feature-name">${feat4Title}</h3>
                            <p class="feature-desc">${feat4Desc}</p>
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
                <h2 class="cta-title">${ctaTitle}</h2>
                <p class="cta-text">${ctaDesc}</p>
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
                        <a href="/download?lang=${lang}">📲 ${t.navDownload}</a>
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
                <p class="developer-tag">PWA & Mobile Ready · Designed with <i data-lucide="heart" class="heart-icon"></i> for NTUT</p>
            </div>
        </footer>

        ${mobileBottomNav(lang, 'home')}

        <script src="/main.js"></script>
    </body>
    </html>
    `;
}
