// Public calendar page (month grid + list), the event page shell and the officer management shell.
// The calendar is rendered on the server; the event and admin pages are shells filled in by
// /events.js and /admin-events.js from the JSON API.
import { locales } from '../locales.js';
import { escapeHtml } from '../html.js';
import { getHeader, getFooter } from './layout.js';

const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = n => String(n).padStart(2, '0');

export function monthLabel(lang, year, month) {
    const t = locales[lang];
    return t.calMonthFormat.replace('{y}', year).replace('{m}', lang === 'en' ? EN_MONTHS[month - 1] : month);
}

// 'YYYY-MM' of the shown month; anything invalid falls back to the month of `today`.
export function parseMonth(value, today) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(value || ''));
    const fallback = /^(\d{4})-(\d{2})/.exec(today);
    const source = match && Number(match[2]) >= 1 && Number(match[2]) <= 12 && Number(match[1]) >= 2000 && Number(match[1]) <= 2100 ? match : fallback;
    return { year: Number(source[1]), month: Number(source[2]) };
}
const shiftMonth = ({ year, month }, delta) => { const index = year * 12 + month - 1 + delta; return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`; };

const STYLE = `<style>
.cal-wrap { max-width: 1100px; margin: 0 auto; padding: 0 16px; }
.cal-bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; margin: 18px 0; }
.cal-bar h2 { margin: 0; font-size: 1.4rem; }
.cal-bar .group { display: flex; gap: 8px; flex-wrap: wrap; }
.cal-btn { padding: 8px 14px; border-radius: 10px; border: 1px solid var(--border-color); color: var(--text-primary); text-decoration: none; font-size: .9rem; background: transparent; cursor: pointer; }
.cal-btn.on { background: var(--color-primary); border-color: var(--color-primary); color: #fff; }
.cal-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); border: 1px solid var(--border-light); border-radius: 14px; overflow: hidden; }
.cal-dow { padding: 8px 4px; text-align: center; font-size: .8rem; color: var(--text-secondary); background: var(--bg-card); }
.cal-day { min-height: 96px; padding: 4px; border-top: 1px solid var(--border-light); border-left: 1px solid var(--border-light); font-size: .78rem; overflow: hidden; }
.cal-day:nth-child(7n+1) { border-left: 0; }
.cal-day.dim { opacity: .35; }
.cal-day.today .num { background: var(--color-primary); color: #fff; border-radius: 999px; padding: 0 6px; }
.cal-day .num { display: inline-block; margin-bottom: 2px; color: var(--text-secondary); }
.cal-item { display: block; margin-top: 2px; padding: 2px 5px; border-radius: 6px; background: var(--color-primary-light); color: var(--text-primary); text-decoration: none; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cal-item.meeting { background: rgba(250, 204, 21, .15); }
.cal-list { display: grid; gap: 10px; }
.cal-row { display: flex; gap: 14px; align-items: center; padding: 14px; border: 1px solid var(--border-light); border-radius: 14px; background: var(--bg-card); text-decoration: none; color: var(--text-primary); }
.cal-row .when { min-width: 92px; font-weight: 700; color: var(--color-cyan, var(--color-primary)); }
.cal-row small { color: var(--text-secondary); display: block; }
.cal-tag { font-size: .72rem; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--border-color); margin-left: 6px; color: var(--text-secondary); }
.cal-sub { margin-top: 28px; padding: 16px; border: 1px solid var(--border-light); border-radius: 14px; background: var(--bg-card); }
.cal-sub input { width: 100%; padding: 10px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-page); color: var(--text-primary); margin: 6px 0; }
@media (max-width: 700px) { .cal-day { min-height: 64px; font-size: .68rem; } .cal-item { padding: 1px 3px; } }
</style>`;

function monthGrid({ lang, entries, month, today }) {
    const t = locales[lang];
    const first = new Date(Date.UTC(month.year, month.month - 1, 1));
    const days = new Date(Date.UTC(month.year, month.month, 0)).getUTCDate();
    const byDate = new Map();
    for (const entry of entries) { if (!byDate.has(entry.date)) byDate.set(entry.date, []); byDate.get(entry.date).push(entry); }
    const cells = t.calWeekdays.split(',').map(name => `<div class="cal-dow">${escapeHtml(name)}</div>`);
    for (let i = 0; i < first.getUTCDay(); i++) cells.push('<div class="cal-day dim"></div>');
    for (let day = 1; day <= days; day++) {
        const date = `${month.year}-${pad(month.month)}-${pad(day)}`;
        const items = (byDate.get(date) || []).map(entry => {
            const label = `${entry.time ? `${entry.time} ` : ''}${entry.title}`;
            return entry.href
                ? `<a class="cal-item" href="${escapeHtml(entry.href)}" title="${escapeHtml(label)}">${escapeHtml(label)}</a>`
                : `<span class="cal-item meeting" title="${escapeHtml(label)}">📌 ${escapeHtml(label)}</span>`;
        }).join('');
        cells.push(`<div class="cal-day${date === today ? ' today' : ''}"><span class="num">${day}</span>${items}</div>`);
    }
    return `<div class="cal-grid" role="grid">${cells.join('')}</div>`;
}

function listRows({ lang, entries, today }) {
    const t = locales[lang];
    const upcoming = entries.filter(entry => entry.date >= today);
    if (!upcoming.length) return `<p style="color: var(--text-secondary); text-align: center; padding: 40px 0;">${escapeHtml(t.calNoEntries)}</p>`;
    return `<div class="cal-list">${upcoming.map(entry => {
        const inner = `<div class="when">${escapeHtml(entry.date.slice(5))}<small>${escapeHtml(entry.time || '')}</small></div>
            <div><strong>${escapeHtml(entry.title)}</strong>${entry.tag ? `<span class="cal-tag">${escapeHtml(entry.kind === 'meeting' ? `${t.calMeeting}・${entry.tag}` : entry.tag)}</span>` : ''}${entry.full ? `<span class="cal-tag">${escapeHtml(t.calFull)}</span>` : ''}
            <small>${escapeHtml(entry.location || '')}</small></div>`;
        return entry.href ? `<a class="cal-row" href="${escapeHtml(entry.href)}">${inner}</a>` : `<div class="cal-row">${inner}</div>`;
    }).join('')}</div>`;
}

// entries: [{ kind: 'event'|'meeting', title, date: 'YYYY-MM-DD', time: 'HH:mm', location, href, tag, full }]
export function renderCalendarPage({ lang = 'zh', entries, month: monthParam, view = 'month', today, signedIn = false }) {
    lang = lang === 'en' ? 'en' : 'zh';
    const t = locales[lang];
    const month = parseMonth(monthParam, today);
    const base = `/calendar?lang=${lang}`;
    const current = `${month.year}-${pad(month.month)}`;
    const body = view === 'list' ? listRows({ lang, entries, today }) : monthGrid({ lang, entries, month, today });
    return `${getHeader(t.calTitle, lang)}
        ${STYLE}
        <main style="padding-top: 120px; min-height: 80vh;">
            <div class="cal-wrap">
                <h1>${escapeHtml(t.calTitle)}</h1>
                <p style="color: var(--text-secondary);">${escapeHtml(t.calDesc)}</p>
                <div class="cal-bar">
                    <div class="group">
                        <a class="cal-btn${view === 'month' ? ' on' : ''}" href="${base}&m=${current}">${escapeHtml(t.calMonthView)}</a>
                        <a class="cal-btn${view === 'list' ? ' on' : ''}" href="${base}&view=list">${escapeHtml(t.calListView)}</a>
                    </div>
                    ${view === 'month' ? `<div class="group">
                        <a class="cal-btn" href="${base}&m=${shiftMonth(month, -1)}" aria-label="${escapeHtml(t.calPrev)}">‹</a>
                        <h2>${escapeHtml(monthLabel(lang, month.year, month.month))}</h2>
                        <a class="cal-btn" href="${base}&m=${shiftMonth(month, 1)}" aria-label="${escapeHtml(t.calNext)}">›</a>
                        <a class="cal-btn" href="${base}">${escapeHtml(t.calToday)}</a>
                    </div>` : ''}
                </div>
                ${body}
                <section class="cal-sub" id="calendar-subscribe" data-signed-in="${signedIn ? '1' : '0'}" data-copy="${escapeHtml(t.calCopy)}" data-rotate="${escapeHtml(t.calRotate)}" data-member-label="${escapeHtml(t.calMemberFeed)}">
                    <h3 style="margin-top: 0;">${escapeHtml(t.calSubscribe)}</h3>
                    <p style="color: var(--text-secondary); font-size: .9rem;">${escapeHtml(t.calSubscribeHelp)}</p>
                    <label>${escapeHtml(t.calPublicFeed)}<input id="feed-public" readonly value="/calendar.ics"></label>
                    <div id="feed-member">${signedIn ? '' : `<p style="color: var(--text-secondary); font-size: .9rem;"><a href="/admin">${escapeHtml(t.calMemberLogin)}</a></p>`}</div>
                </section>
            </div>
        </main>
        <script src="/calendar.js" defer></script>
        ${getFooter(lang, 'calendar')}`;
}

const jsonForScript = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

export function renderEventPage({ lang = 'zh', event, turnstileSiteKey = '' }) {
    lang = lang === 'en' ? 'en' : 'zh';
    const t = locales[lang];
    const strings = Object.fromEntries(Object.entries(t).filter(([key]) => key.startsWith('evt')));
    return `${getHeader(event.title, lang)}
        ${STYLE}
        <style>
        .evt-wrap { max-width: 760px; margin: 0 auto; padding: 0 16px; }
        .evt-card { border: 1px solid var(--border-light); border-radius: 14px; padding: 18px; background: var(--bg-card); margin-top: 16px; }
        .evt-meta { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; }
        .evt-meta dt { color: var(--text-secondary); } .evt-meta dd { margin: 0; }
        .evt-form label { display: block; margin-top: 10px; font-size: .9rem; color: var(--text-secondary); }
        .evt-form input { width: 100%; padding: 10px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-page); color: var(--text-primary); margin-top: 4px; }
        .evt-msg { margin-top: 12px; padding: 10px 12px; border-radius: 10px; background: var(--color-primary-light); }
        .evt-msg.err { background: rgba(239, 68, 68, .15); }
        </style>
        <main style="padding-top: 120px; min-height: 80vh;">
            <div class="evt-wrap" id="event-app" data-id="${escapeHtml(event.id)}" data-lang="${lang}" data-turnstile="${escapeHtml(turnstileSiteKey)}">
                <a href="/calendar?lang=${lang}" class="cal-btn">‹ ${escapeHtml(t.evtBack)}</a>
                <p id="event-loading" style="color: var(--text-secondary);">${escapeHtml(t.evtLoading)}</p>
            </div>
            <script type="application/json" id="event-i18n">${jsonForScript(strings)}</script>
        </main>
        ${turnstileSiteKey ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>' : ''}
        <script src="/events.js" defer></script>
        ${getFooter(lang, 'calendar')}`;
}

export function renderAdminEventsPage() {
    return `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>活動管理 | 北科無人機社</title>
<style>:root { color-scheme: dark; } * { box-sizing: border-box; } body { margin: 0; font-family: "Noto Sans TC", system-ui, sans-serif; background: #0b1120; color: #e2e8f0; line-height: 1.6; }
main { max-width: 1000px; margin: 0 auto; padding: 20px 16px 64px; } a { color: #60a5fa; } h1 { font-size: 1.4rem; margin: 0 0 12px; }
.card { background: #111a2e; border: 1px solid #23324d; border-radius: 14px; padding: 16px; margin-top: 14px; } .muted { color: #94a3b8; font-size: .9rem; }
input, select, textarea { width: 100%; padding: 9px; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: #e2e8f0; font: inherit; margin-top: 4px; }
label { display: block; font-size: .85rem; color: #cbd5e1; } .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px; }
button, .btn { padding: 8px 14px; border-radius: 8px; border: 0; font: inherit; font-weight: 700; cursor: pointer; background: #3b82f6; color: #fff; text-decoration: none; display: inline-block; }
button.secondary, .btn.secondary { background: #334155; } button.danger { background: #ef4444; } .row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; align-items: center; }
table { width: 100%; border-collapse: collapse; font-size: .88rem; } th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #23324d; } .wrap { overflow-x: auto; }
.msg { margin-top: 10px; padding: 8px 12px; border-radius: 8px; background: rgba(59,130,246,.15); } .msg.err { background: rgba(239,68,68,.15); } .tag { font-size: .75rem; padding: 1px 8px; border-radius: 999px; background: #334155; }
</style></head><body><main id="app"><p class="muted">載入中…</p></main><script src="/admin-events.js"></script></body></html>`;
}
