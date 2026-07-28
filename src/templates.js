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
        <title>${title} | 北科無人機社 NTUT Drone Club</title>
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
    const heroTitle  = override.heroTitle  || t.heroTitleZh;
    const heroDesc   = override.heroDesc   || t.heroDesc;
    const heroBadge  = override.heroBadge  || (lang === 'zh' ? '國立臺北科技大學 | 學務處課外活動指導組核可康樂性社團' : 'NTUT | Recreational Club • Student Affairs Approved');
    const lineLink   = override.lineLink   || 'https://lin.ee/s5YJgGI';
    const igLink     = override.igLink     || 'https://www.instagram.com/ntut_drone/';
    const emailLink  = override.emailLink  || 'ntut.droneclub@gmail.com';
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
        <meta name="description" content="北科無人機社 (NTUT Drone Club) - 探索天空的無限可能。我們提供模擬器練習、FPV 穿越機飛行、空拍體驗與專業組裝考照課程，歡迎對無人機有興趣的北科同學加入！">
        <meta name="keywords" content="北科無人機社, NTUT Drone Club, 無人機, FPV, 穿越機, 空拍, 模擬器, 台北科技大學, 社團">
        <meta property="og:title" content="北科無人機社 | NTUT Drone Club">
        <meta property="og:description" content="探索天空的無限可能，啟動你的飛行夢想！北科無人機社提供模擬飛行、FPV 穿越機、空拍創作與證照輔導。">
        <meta property="og:image" content="/assets/images/fpv_drone_hero.jpg">
        <meta property="og:type" content="website">
        <title>${t.heroTitleZh} | NTUT Drone Club</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@300;400;500;700;900&family=Outfit:wght@300;400;600;800&display=swap" rel="stylesheet">
        <script src="https://cdn.jsdelivr.net/npm/lucide@latest/dist/umd/lucide.js"></script>
        <link rel="stylesheet" href="/style.css">
        <script>(function(){var t=localStorage.getItem('ntut-theme')||'dark';document.documentElement.setAttribute('data-theme',t);})();</script>
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
                <a href="#dynamic-blog" class="drawer-link">${lang === 'zh' ? '最新文章' : 'Latest Posts'}</a>
                <a href="#faq" class="drawer-link">${t.navFaq}</a>
                <a href="?lang=${t.langToggleQuery}" class="drawer-link" style="color: var(--color-primary);"><span style="margin-right: 6px;">🌐</span> ${t.langToggleText}</a>
                <hr class="drawer-divider">
                <a href="mailto:ntut.droneclub@gmail.com" class="drawer-cta-btn" style="background: #3b82f6;"><i data-lucide="mail"></i> ntut.droneclub@gmail.com</a>
                <a href="https://lin.ee/s5YJgGI" target="_blank" class="drawer-cta-btn"><i data-lucide="message-square"></i> ${t.heroBtnLine}</a>
                <a href="https://www.instagram.com/ntut_drone/" target="_blank" class="drawer-cta-btn secondary"><i data-lucide="instagram"></i> Instagram</a>
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
                            <a href="https://lin.ee/s5YJgGI" target="_blank" class="popular-link">${lang === 'zh' ? '無人機飛行場地預約與使用規範' : 'Drone Flight Field Reservation & Rules'}</a>
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
                            <a href="https://lin.ee/s5YJgGI" target="_blank" class="popular-link">${lang === 'zh' ? 'LINE 官方社群與 2026 年度入社報名' : 'Official LINE Community & 2026 Registration'}</a>
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
                    <h2 class="section-title">${t.aboutTitle}</h2>
                    <p class="section-subtitle">${t.aboutSubtitle}</p>
                </div>
                
                <div class="about-grid">
                    <div class="about-card">
                        <div class="about-card-icon"><i data-lucide="shield-check"></i></div>
                        <h3>${t.aboutCard1Title}</h3>
                        <p>${t.aboutCard1Desc}</p>
                    </div>
                    
                    <div class="about-card">
                        <div class="about-card-icon"><i data-lucide="wrench"></i></div>
                        <h3>${t.aboutCard2Title}</h3>
                        <p>${t.aboutCard2Desc}</p>
                    </div>
                    
                    <div class="about-card">
                        <div class="about-card-icon"><i data-lucide="users"></i></div>
                        <h3>${t.aboutCard3Title}</h3>
                        <p>${t.aboutCard3Desc}</p>
                    </div>
                </div>
            </div>
        </section>

        <!-- Features Section -->
        <section class="features-section" id="features">
            <div class="section-container">
                <div class="section-header text-center">
                    <h2 class="section-title">${t.featuresTitle}</h2>
                    <p class="section-subtitle">${t.featuresSubtitle}</p>
                </div>

                <div class="features-grid">
                    <div class="feature-item-card">
                        <div class="feature-visual">
                            <div class="feature-icon-wrapper cyan">
                                <i data-lucide="monitor-play"></i>
                            </div>
                        </div>
                        <div class="feature-info">
                            <h3 class="feature-name">${t.feat1Title}</h3>
                            <p class="feature-desc">${t.feat1Desc}</p>
                        </div>
                    </div>

                    <div class="feature-item-card">
                        <div class="feature-visual">
                            <div class="feature-icon-wrapper purple">
                                <i data-lucide="eye"></i>
                            </div>
                        </div>
                        <div class="feature-info">
                            <h3 class="feature-name">${t.feat2Title}</h3>
                            <p class="feature-desc">${t.feat2Desc}</p>
                        </div>
                    </div>

                    <div class="feature-item-card">
                        <div class="feature-visual">
                            <div class="feature-icon-wrapper green">
                                <i data-lucide="aperture"></i>
                            </div>
                        </div>
                        <div class="feature-info">
                            <h3 class="feature-name">${t.feat3Title}</h3>
                            <p class="feature-desc">${t.feat3Desc}</p>
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

            <!-- Homepage Settings Panel -->
            <div id="panel-homepage" class="panel">
                <div class="content-header">
                    <h1>首頁內容設定</h1>
                    <button class="btn btn-primary" onclick="saveHomepage()"><i data-lucide="save"></i> 儲存設定</button>
                </div>
                <p style="color: var(--text-muted); margin-bottom: 28px; font-size: 0.9rem;">修改首頁展示的文字與聯絡資訊，儲存後即時生效。</p>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; max-width: 900px;">
                    <div class="form-group" style="grid-column: 1 / -1;">
                        <label for="hp-hero-title">統一標題 (首頁 H1)</label>
                        <input type="text" id="hp-hero-title" class="form-control" placeholder="北科無人機社">
                    </div>
                    <div class="form-group" style="grid-column: 1 / -1;">
                        <label for="hp-hero-desc">展示區說明文字 (Hero 副標題)</label>
                        <textarea id="hp-hero-desc" class="form-control" rows="3" placeholder="探索上帝視角的無限精彩…"></textarea>
                    </div>
                    <div class="form-group" style="grid-column: 1 / -1;">
                        <label for="hp-hero-badge">首頁彽章文字 (Hero Badge)</label>
                        <input type="text" id="hp-hero-badge" class="form-control" placeholder="國立臺北科技大學 | 學務處課外活動指導組核可康樂性社團">
                    </div>
                    <div class="form-group">
                        <label for="hp-line-link">LINE 社群連結</label>
                        <input type="url" id="hp-line-link" class="form-control" placeholder="https://lin.ee/...">
                    </div>
                    <div class="form-group">
                        <label for="hp-ig-link">Instagram 連結</label>
                        <input type="url" id="hp-ig-link" class="form-control" placeholder="https://www.instagram.com/ntut_drone/">
                    </div>
                    <div class="form-group" style="grid-column: 1 / -1;">
                        <label for="hp-email">官方信箱</label>
                        <input type="email" id="hp-email" class="form-control" placeholder="ntut.droneclub@gmail.com">
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
            async function loadHomepageData() {
                try {
                    const res = await fetch('/api/homepage');
                    if (!res.ok) return;
                    const data = await res.json();
                    if (data.heroTitle)  document.getElementById('hp-hero-title').value = data.heroTitle;
                    if (data.heroDesc)   document.getElementById('hp-hero-desc').value  = data.heroDesc;
                    if (data.heroBadge)  document.getElementById('hp-hero-badge').value = data.heroBadge;
                    if (data.lineLink)   document.getElementById('hp-line-link').value  = data.lineLink;
                    if (data.igLink)     document.getElementById('hp-ig-link').value    = data.igLink;
                    if (data.emailLink)  document.getElementById('hp-email').value      = data.emailLink;
                } catch (e) { /* silently ignore */ }
            }
            loadHomepageData();

            async function saveHomepage() {
                const payload = {
                    heroTitle: document.getElementById('hp-hero-title').value,
                    heroDesc:  document.getElementById('hp-hero-desc').value,
                    heroBadge: document.getElementById('hp-hero-badge').value,
                    lineLink:  document.getElementById('hp-line-link').value,
                    igLink:    document.getElementById('hp-ig-link').value,
                    emailLink: document.getElementById('hp-email').value
                };
                try {
                    const res = await fetch('/api/homepage', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    if (res.ok) {
                        showToast('首頁設定已儲存！前台即時生效。');
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
