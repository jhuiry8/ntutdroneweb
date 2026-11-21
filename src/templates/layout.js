// Pieces shared by every server-rendered page: PWA <head> tags, the public site header,
// footer and the mobile bottom navigation.
import { locales } from '../locales.js';
import { escapeHtml } from '../html.js';

// Helper: Common PWA Head Tags
export const PWA_HEAD_TAGS = `
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="theme-color" content="#0f172a">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="北科無人機">
    <link rel="manifest" href="/manifest.webmanifest">
    <link rel="apple-touch-icon" href="/assets/icons/apple-touch-icon.png">
    <link rel="apple-touch-icon" sizes="152x152" href="/assets/icons/icon-152x152.png">
    <link rel="apple-touch-icon" sizes="180x180" href="/assets/icons/apple-touch-icon.png">
    <link rel="apple-touch-icon" sizes="192x192" href="/assets/icons/icon-192x192.png">
    <link rel="icon" type="image/png" sizes="192x192" href="/assets/icons/icon-192x192.png">
`;

// Helper: Common Header
export function getHeader(title, lang = 'zh') {
    lang = lang === 'en' ? 'en' : 'zh';
    const t = locales[lang];
    return `
    <!DOCTYPE html>
    <html lang="${lang}">
    <head>
        <meta charset="UTF-8">
        ${PWA_HEAD_TAGS}
        <title>${escapeHtml(title)} | 北科無人機社 NTUT Drone Club - 台北科技大學無人機平台</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@300;400;500;700;900&family=Outfit:wght@300;400;600;800&display=swap" rel="stylesheet">
        <script src="/vendor/lucide-1.65.0.min.js"></script>
        <link rel="stylesheet" href="/style.css">
        <link rel="stylesheet" href="/glass.css">
        <script src="/theme.js"></script>
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
                    <a href="/calendar?lang=${lang}" class="nav-link">${t.navCalendar}</a>
                    <a href="/?lang=${lang}#faq" class="nav-link">${t.navFaq}</a>
                </nav>
                <div class="nav-socials">
                    <!-- Language Toggle -->
                    <a href="?lang=${t.langToggleQuery}" class="cta-nav-btn" style="background:none; border: 1px solid var(--border-color); color:var(--text-primary); margin-right:4px; padding: 6px 12px;">
                        <span style="font-size: 1.1rem; margin-right: 4px;">🌐</span> ${t.langToggleText}
                    </a>
                    <!-- Theme Toggle -->
                    <button id="theme-toggle-btn" class="theme-toggle-btn" data-theme-toggle title="切換深色/淺色模式">☀️</button>
                    <a href="mailto:ntut.droneclub@gmail.com" class="social-icon-btn email" title="官方信箱"><i data-lucide="mail"></i><span class="fallback-text">✉️</span></a>
                    <a href="https://www.instagram.com/ntut_drone/" target="_blank" class="social-icon-btn ig" title="Instagram"><i data-lucide="instagram"></i><span class="fallback-text">IG</span></a>
                    <a href="https://lin.ee/s5YJgGI" target="_blank" class="social-icon-btn line" title="LINE 官方社群"><i data-lucide="message-square"></i><span class="fallback-text">LINE</span></a>
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
                <a href="/?lang=${lang}#about" class="drawer-link">${t.navAbout}</a>
                <a href="/?lang=${lang}#features" class="drawer-link">${t.navFeatures}</a>
                <a href="/blog?lang=${lang}" class="drawer-link">${t.navBlog}</a>
                <a href="/calendar?lang=${lang}" class="drawer-link">${t.navCalendar}</a>
                <a href="/?lang=${lang}#faq" class="drawer-link">${t.navFaq}</a>
                <a href="/admin" class="drawer-link">🔐 社務後台 / 會員專區</a>
                <a href="/forms/equipment-loan" class="drawer-link">📋 設備借用申請</a>
                <hr class="drawer-divider">
                <a href="mailto:ntut.droneclub@gmail.com" class="drawer-cta-btn" style="background: #0284c7;"><i data-lucide="mail"></i> ntut.droneclub@gmail.com</a>
                <a href="https://lin.ee/s5YJgGI" target="_blank" class="drawer-cta-btn"><i data-lucide="message-square"></i> LINE 聯絡加入</a>
            </nav>
        </div>
    `;
}


// Helper: Mobile bottom navigation (shown at <= 768px). `active` is home | blog | loan | admin.
export function mobileBottomNav(lang, active = '') {
    const items = [
        ['home', `/?lang=${lang}`, 'home', '首頁'],
        ['blog', `/blog?lang=${lang}`, 'newspaper', '公告'],
        ['loan', '/forms/equipment-loan', 'clipboard-list', '借用'],
        ['admin', '/admin', 'user', '後台']
    ];
    return `<nav class="mobile-bottom-nav" aria-label="手機快捷導覽列">
            ${items.map(([key, href, icon, label]) => `<a href="${href}" class="mobile-nav-item${key === active ? ' active' : ''}"${key === active ? ' aria-current="page"' : ''}>
                <i data-lucide="${icon}"></i>
                <span>${label}</span>
            </a>`).join('\n            ')}
        </nav>`;
}

// Helper: Common Footer
export function getFooter(lang = 'zh', active = '') {
    lang = lang === 'en' ? 'en' : 'zh';
    const t = locales[lang];
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
                        <a href="/calendar?lang=${lang}">${t.navCalendar}</a>
                        <a href="/forms/equipment-loan">設備借用申請</a>
                        <a href="/admin">社務管理後台</a>
                        <a href="https://lin.ee/s5YJgGI" target="_blank">LINE 社群</a>
                    </div>
                </div>
            </div>
            <div class="footer-bottom">
                <p>&copy; 2026 北科無人機社 NTUT Drone Club. All rights reserved.</p>
            </div>
        </footer>

        ${mobileBottomNav(lang, active)}

        <script src="/main.js"></script>
    </body>
    </html>
    `;
}
