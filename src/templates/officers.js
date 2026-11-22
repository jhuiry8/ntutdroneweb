// Public 幹部介紹 page. It only ever receives the already filtered view from publicOfficerView
// (position, name, photo, intro), and escapes every value.
import { escapeHtml } from '../html.js';
import { getHeader, getFooter } from './layout.js';

export function renderOfficersPage({ officers = [], year = '' } = {}, lang = 'zh') {
    const cards = officers.map(officer => `
        <article class="glass-card" style="padding:24px; display:grid; gap:12px; text-align:center;">
            ${officer.photoUrl ? `<img src="${escapeHtml(officer.photoUrl)}" alt="${escapeHtml(officer.name || officer.position)}" loading="lazy" style="width:120px; height:120px; object-fit:cover; border-radius:50%; margin:0 auto; border:1px solid var(--border-glass);">` : ''}
            ${officer.name ? `<h2 style="font-size:1.3rem; margin:0;">${escapeHtml(officer.name)}</h2>` : ''}
            <p style="margin:0; color:var(--color-cyan); font-weight:600;">${escapeHtml(officer.position)}</p>
            ${officer.bio ? `<p style="margin:0; color:var(--text-secondary); line-height:1.7; white-space:pre-wrap;">${escapeHtml(officer.bio)}</p>` : ''}
        </article>`).join('');
    return `
        ${getHeader('幹部介紹', lang)}
        <main style="padding-top: 140px; min-height: 80vh;">
            <section class="section-container" style="max-width: 1000px; padding: 40px 24px;">
                <h1 style="font-size: 2.6rem; font-weight: 900; margin-bottom: 8px;">幹部介紹</h1>
                <p style="color:var(--text-secondary); margin-bottom: 32px;">${year ? `${escapeHtml(year)} 學年` : ''}北科無人機社幹部團隊</p>
                ${cards ? `<div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:20px;">${cards}</div>` : '<p style="color:var(--text-secondary);">目前沒有公開的幹部資料。</p>'}
            </section>
        </main>
        ${getFooter(lang)}
    `;
}
