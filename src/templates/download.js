// Public download page (/download): Android APK, Windows installers and the iOS home-screen tip.
// Every package is a GitHub Release asset published by .github/workflows/release.yml.
import { locales } from '../locales.js';
import { escapeHtml } from '../html.js';
import { getHeader, getFooter } from './layout.js';

export const RELEASES_URL = 'https://github.com/jhuiry8/ntutdroneweb/releases';
// release.yml marks every release as "latest" and always names the APK this way.
export const ANDROID_APK_URL = `${RELEASES_URL}/latest/download/NTUT-Drone-Club.apk`;

const STYLE = `<style>
    .dl-wrap { max-width: 960px; margin: 0 auto; padding: 0 16px 60px; }
    .dl-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 20px; margin-top: 28px; }
    .dl-card { display: flex; flex-direction: column; gap: 10px; padding: 24px; border-radius: 16px; border: 1px solid var(--border-color); background: var(--bg-card, rgba(255,255,255,.04)); }
    .dl-card h2 { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 1.2rem; }
    .dl-card p { margin: 0; color: var(--text-secondary); font-size: .92rem; flex: 1; }
    .dl-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 10px 16px; border-radius: 10px; font-weight: 700; text-decoration: none; background: var(--color-primary, #0284c7); color: #fff; }
    .dl-btn.secondary { background: none; border: 1px solid var(--border-color); color: var(--text-primary); }
    .dl-meta { font-size: .8rem; color: var(--text-secondary); }
</style>`;

// release: the newest desktop release ({version, url, win7Url?, apkUrl?}) or null.
export function renderDownloadPage({ lang = 'zh', release = null } = {}) {
    lang = lang === 'en' ? 'en' : 'zh';
    const t = locales[lang];
    const windowsUrl = release?.url || `${RELEASES_URL}/latest`;
    const icon = name => `<i data-lucide="${name}" style="width:20px; height:20px;"></i>`;
    return `${getHeader(t.dlTitle, lang)}
        ${STYLE}
        <main style="padding-top: 120px; min-height: 80vh;">
            <div class="dl-wrap">
                <h1>${escapeHtml(t.dlTitle)}</h1>
                <p style="color: var(--text-secondary);">${escapeHtml(t.dlDesc)}</p>
                <div class="dl-grid">
                    <section class="dl-card" id="android">
                        <h2>${icon('smartphone')} ${escapeHtml(t.dlAndroidTitle)}</h2>
                        <p>${escapeHtml(t.dlAndroidDesc)}</p>
                        <a class="dl-btn" href="${escapeHtml(release?.apkUrl || ANDROID_APK_URL)}" rel="noopener">${icon('download')} ${escapeHtml(t.dlAndroidBtn)}</a>
                    </section>
                    <section class="dl-card" id="windows">
                        <h2>${icon('monitor')} ${escapeHtml(t.dlWindowsTitle)}</h2>
                        <p>${escapeHtml(t.dlWindowsDesc)}</p>
                        ${release?.version ? `<span class="dl-meta">${escapeHtml(t.dlVersion)}：${escapeHtml(release.version)}</span>` : ''}
                        <a class="dl-btn" href="${escapeHtml(windowsUrl)}" rel="noopener">${icon('download')} ${escapeHtml(t.dlWindowsBtn)}</a>
                    </section>
                    <section class="dl-card" id="windows7">
                        <h2>${icon('monitor')} ${escapeHtml(t.dlWin7Title)}</h2>
                        <p>${escapeHtml(t.dlWin7Desc)}</p>
                        ${release?.win7Url
                            ? `<a class="dl-btn" href="${escapeHtml(release.win7Url)}" rel="noopener">${icon('download')} ${escapeHtml(t.dlWin7Btn)}</a>`
                            : `<a class="dl-btn secondary" href="${escapeHtml(RELEASES_URL)}/latest" rel="noopener">${icon('external-link')} ${escapeHtml(t.dlAllReleases)}</a>`}
                    </section>
                    <section class="dl-card" id="ios">
                        <h2>${icon('tablet-smartphone')} ${escapeHtml(t.dlIosTitle)}</h2>
                        <p>${escapeHtml(t.dlIosDesc)}</p>
                    </section>
                </div>
                <p style="margin-top: 24px;"><a href="${escapeHtml(RELEASES_URL)}" rel="noopener">${escapeHtml(t.dlAllReleases)} →</a></p>
            </div>
        </main>
    ${getFooter(lang)}`;
}
