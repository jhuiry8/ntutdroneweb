// Survey pages: the public fill page (site layout, bilingual) and the officers' list/editor and report
// shells. Everything inside is drawn by /survey.js, /admin-surveys.js and /admin-survey-report.js from the JSON API.
import { locales } from '../locales.js';
import { escapeHtml } from '../html.js';
import { getHeader, getFooter } from './layout.js';

const jsonForScript = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

export function renderSurveyPage({ lang = 'zh', id, turnstileSiteKey = '' }) {
    lang = lang === 'en' ? 'en' : 'zh';
    const t = locales[lang];
    const strings = Object.fromEntries(Object.entries(t).filter(([key]) => key.startsWith('svy')));
    return `${getHeader(lang === 'en' ? 'Survey' : '問卷', lang)}
        <style>
        .svy-wrap { max-width: 720px; margin: 0 auto; padding: 0 16px 48px; }
        .svy-card { border: 1px solid var(--border-light); border-radius: 14px; padding: 18px; background: var(--bg-card); margin-top: 14px; }
        .svy-card.bad { border-color: #ef4444; }
        .svy-q { font-weight: 700; margin: 0 0 4px; } .svy-q .req { color: #ef4444; margin-left: 4px; }
        .svy-help { color: var(--text-secondary); font-size: .88rem; margin: 0 0 10px; }
        .svy-opt { display: flex; gap: 10px; align-items: center; padding: 10px 6px; min-height: 44px; cursor: pointer; border-radius: 8px; }
        .svy-opt input { width: 20px; height: 20px; flex: none; margin: 0; }
        .svy-wrap input[type=text], .svy-wrap input[type=date], .svy-wrap textarea, .svy-wrap select { width: 100%; padding: 12px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-page); color: var(--text-primary); font: inherit; }
        .svy-wrap textarea { min-height: 120px; resize: vertical; }
        .svy-count { color: var(--text-secondary); font-size: .8rem; text-align: right; }
        .svy-stars { display: flex; gap: 6px; flex-wrap: wrap; }
        .svy-stars button { min-width: 44px; min-height: 44px; border-radius: 10px; border: 1px solid var(--border-color); background: transparent; color: var(--text-primary); font: inherit; font-size: 1.15rem; cursor: pointer; }
        .svy-stars button[aria-pressed=true] { background: #2563eb; border-color: #2563eb; color: #fff; font-weight: 700; }
        .svy-stars.star button { font-size: 1.5rem; line-height: 1; color: #b45309; } .svy-stars.star button[aria-pressed=true] { background: #f59e0b; border-color: #f59e0b; color: #1f1300; }
        .svy-scale-note { display: flex; justify-content: space-between; color: var(--text-secondary); font-size: .8rem; margin-top: 4px; }
        .svy-msg { margin-top: 12px; padding: 10px 12px; border-radius: 10px; background: var(--color-primary-light); } .svy-msg.err { background: rgba(239,68,68,.15); }
        .svy-submit { margin-top: 18px; padding: 14px 22px; min-height: 48px; border-radius: 10px; border: 0; background: #2563eb; color: #fff; font: inherit; font-weight: 700; cursor: pointer; width: 100%; } .svy-submit:disabled { opacity: .55; }
        .svy-cap { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; } .svy-cap svg { background: #fff; border-radius: 8px; max-width: 180px; }
        </style>
        <main style="padding-top: 120px; min-height: 80vh;">
            <div class="svy-wrap" id="survey-app" data-id="${escapeHtml(id)}" data-lang="${lang}" data-turnstile="${escapeHtml(turnstileSiteKey)}">
                <p id="survey-loading" style="color: var(--text-secondary);">${escapeHtml(t.svyLoading)}</p>
            </div>
            <script type="application/json" id="survey-i18n">${jsonForScript(strings)}</script>
        </main>
        ${turnstileSiteKey ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>' : ''}
        <script src="/survey.js" defer></script>
        ${getFooter(lang, 'calendar')}`;
}

// Standalone officer pages share one stylesheet that follows the back-office light/dark theme (/theme.js).
const ADMIN_STYLE = `<style>
:root { color-scheme: dark; --bg: #0b1120; --card: #111a2e; --line: #23324d; --ink: #e2e8f0; --muted: #94a3b8; --link: #60a5fa; --field: #0f172a; --fieldline: #334155; --btn: #3b82f6; --btn2: #334155; }
:root[data-theme="light"] { color-scheme: light; --bg: #eef2f8; --card: #ffffff; --line: rgba(15,23,42,.14); --ink: #0f172a; --muted: #475569; --link: #1d4ed8; --field: #ffffff; --fieldline: rgba(15,23,42,.3); --btn: #2563eb; --btn2: #475569; }
* { box-sizing: border-box; } body { margin: 0; font-family: "Noto Sans TC", system-ui, sans-serif; background: var(--bg); color: var(--ink); line-height: 1.6; }
main { max-width: 1000px; margin: 0 auto; padding: 20px 16px 64px; } a { color: var(--link); } h1 { font-size: 1.4rem; margin: 0 0 12px; } h2 { font-size: 1.1rem; margin: 0 0 8px; } h3 { font-size: 1rem; margin: 0 0 6px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px; margin-top: 14px; } .muted { color: var(--muted); font-size: .9rem; }
input, select, textarea { width: 100%; padding: 9px; border-radius: 8px; border: 1px solid var(--fieldline); background: var(--field); color: var(--ink); font: inherit; margin-top: 4px; }
input[type=checkbox], input[type=radio] { width: auto; margin: 0 6px 0 0; }
label { display: block; font-size: .85rem; color: var(--muted); } label.inline { display: inline-flex; align-items: center; color: var(--ink); margin-right: 14px; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px; }
button, .btn { padding: 8px 14px; border-radius: 8px; border: 0; font: inherit; font-weight: 700; cursor: pointer; background: var(--btn); color: #fff; text-decoration: none; display: inline-block; min-height: 38px; }
button.secondary, .btn.secondary { background: var(--btn2); } button.danger { background: #dc2626; } button:disabled { opacity: .5; }
.row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; align-items: center; }
table { width: 100%; border-collapse: collapse; font-size: .88rem; } th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; } .wrap { overflow-x: auto; }
.msg { margin-top: 10px; padding: 8px 12px; border-radius: 8px; background: rgba(59,130,246,.15); } .msg.err { background: rgba(239,68,68,.18); }
.tag { font-size: .75rem; padding: 1px 8px; border-radius: 999px; background: var(--btn2); color: #fff; }
.q { border: 1px solid var(--line); border-radius: 12px; padding: 12px; margin-top: 10px; } .q .row { margin-top: 8px; }
@media print { body { background: #fff; color: #000; --ink: #000; --muted: #444; --line: #bbb; --card: #fff; } .noprint { display: none !important; } .card { break-inside: avoid; border-color: #bbb; } a { color: #000; } }
</style>`;

const adminShell = (title, script) => `<!DOCTYPE html><html lang="zh-TW" data-theme="dark"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title} | 北科無人機社</title>
<script src="/theme.js"></script>${ADMIN_STYLE}</head><body><main id="app"><p class="muted">載入中…</p></main>${script}</body></html>`;

export function renderAdminSurveysPage() {
    return adminShell('問卷與回饋', '<script src="/admin-surveys.js"></script>');
}

export function renderSurveyReportPage(id) {
    return adminShell('問卷報表', `<script src="/charts.js"></script><script src="/admin-survey-report.js" data-id="${escapeHtml(id)}"></script>`);
}
