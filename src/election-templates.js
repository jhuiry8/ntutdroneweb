// Public election pages: the list of elections, the election bulletin (選舉公報)
// with candidate profiles, the voting steps and the published results.
import { getHeader, getFooter } from './templates.js';
import { escapeHtml } from './html.js';

const STATUS_LABELS = { published: '已公告・尚未開始投票', open: '投票中', closed: '投票已結束' };

export function taipeiTime(iso) {
    if (!iso) return '';
    const date = new Date(Date.parse(iso) + 8 * 3600000);
    if (Number.isNaN(date.getTime())) return '';
    const pad = value => String(value).padStart(2, '0');
    return `${date.getUTCFullYear() - 1911}/${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function period(election) {
    if (!election.startsAt && !election.endsAt) return '由選務人員宣布開始與結束';
    return `${election.startsAt ? taipeiTime(election.startsAt) : '宣布開始'} 至 ${election.endsAt ? taipeiTime(election.endsAt) : '宣布結束'}（臺灣時間）`;
}

// Plain text with line breaks; candidate text is never treated as HTML.
function paragraphs(value) {
    return escapeHtml(value).split(/\n{2,}/).map(block => `<p>${block.replace(/\n/g, '<br>')}</p>`).join('');
}

const STYLE = `<style>
    .ev-main { max-width: 960px; margin: 0 auto; padding: 120px 16px 72px; color: var(--text-primary); }
    .ev-main h1 { font-size: clamp(1.7rem, 4vw, 2.3rem); font-weight: 800; margin: 0 0 10px; }
    .ev-lead { color: var(--text-secondary); line-height: 1.75; margin: 0 0 18px; }
    .ev-card { padding: 22px; border: 1px solid var(--border-color); border-radius: 16px; background: var(--bg-card); margin-bottom: 18px; }
    .ev-card h2 { font-size: 1.15rem; margin: 0 0 14px; }
    .ev-badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: .82rem; font-weight: 700; border: 1px solid var(--border-color); color: var(--text-secondary); }
    .ev-badge.open { color: #fff; background: var(--color-success); border-color: var(--color-success); }
    .ev-badge.closed { color: var(--text-secondary); }
    .ev-facts { display: grid; grid-template-columns: max-content 1fr; gap: 6px 14px; margin: 14px 0 0; font-size: .95rem; }
    .ev-facts dt { color: var(--text-secondary); }
    .ev-facts dd { margin: 0; }
    .ev-list { display: grid; gap: 14px; }
    .ev-list a { color: inherit; text-decoration: none; display: block; }
    .ev-list a:hover .ev-card { border-color: var(--color-primary); }
    .ev-candidates { display: grid; gap: 16px; }
    .ev-candidate { display: grid; grid-template-columns: 140px 1fr; gap: 18px; align-items: start; }
    .ev-photo { width: 140px; height: 175px; border-radius: 12px; object-fit: cover; background: var(--bg-page); border: 1px solid var(--border-color); display: grid; place-items: center; font-size: 3rem; font-weight: 800; color: var(--text-secondary); }
    .ev-number { display: inline-grid; place-items: center; min-width: 34px; height: 34px; padding: 0 8px; border-radius: 10px; background: var(--color-primary); color: #fff; font-weight: 800; margin-right: 8px; }
    .ev-candidate h3 { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; font-size: 1.3rem; margin: 0 0 4px; }
    .ev-slogan { color: var(--color-cyan, var(--color-primary)); font-weight: 600; margin: 4px 0 10px; }
    .ev-section-title { font-size: .85rem; color: var(--text-secondary); font-weight: 700; margin: 12px 0 4px; letter-spacing: .05em; }
    .ev-text p { margin: 0 0 8px; line-height: 1.75; }
    .ev-field { display: grid; gap: 6px; font-size: .9rem; color: var(--text-secondary); margin-bottom: 12px; }
    .ev-input { width: 100%; box-sizing: border-box; padding: 11px 12px; border-radius: 10px; border: 1px solid var(--border-color); background: var(--bg-page); color: var(--text-primary); font: inherit; font-size: 16px; }
    .ev-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .ev-btn { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 18px; border-radius: 10px; border: 1px solid var(--border-color); background: transparent; color: var(--text-primary); font: inherit; font-weight: 600; cursor: pointer; }
    .ev-btn.primary { background: var(--color-primary); border-color: var(--color-primary); color: #fff; }
    .ev-btn:disabled { opacity: .6; cursor: wait; }
    .ev-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
    .ev-error { color: var(--color-danger); min-height: 1.4em; margin: 10px 0 0; }
    .ev-notice { font-size: .88rem; line-height: 1.7; color: var(--text-secondary); padding: 12px 14px; border-radius: 10px; border: 1px dashed var(--border-color); margin: 12px 0; }
    .ev-agree { display: flex; gap: 10px; align-items: flex-start; font-size: .95rem; margin: 12px 0; }
    .ev-agree input { width: 20px; height: 20px; margin-top: 2px; flex: none; }
    .ev-options { display: grid; gap: 10px; margin: 12px 0; }
    .ev-option { display: flex; gap: 12px; align-items: center; padding: 14px; border: 2px solid var(--border-color); border-radius: 12px; cursor: pointer; font-size: 1.05rem; font-weight: 600; }
    .ev-option input { width: 22px; height: 22px; }
    .ev-option:has(input:checked) { border-color: var(--color-primary); }
    .ev-bar { height: 12px; border-radius: 6px; background: var(--bg-page); overflow: hidden; border: 1px solid var(--border-color); }
    .ev-bar span { display: block; height: 100%; background: var(--color-primary); }
    .ev-result { display: grid; grid-template-columns: minmax(120px, 220px) 1fr 90px; gap: 12px; align-items: center; margin: 10px 0; }
    .ev-done { border-color: var(--color-success); }
    @media (max-width: 680px) { .ev-main { padding-top: 96px; } .ev-grid { grid-template-columns: minmax(0, 1fr); } .ev-candidate { grid-template-columns: 1fr; } .ev-photo { width: 120px; height: 150px; } .ev-result { grid-template-columns: 1fr 70px; } .ev-result .ev-bar { grid-column: 1 / -1; grid-row: 2; } }
</style>`;

export function renderElectionList(elections = []) {
    const cards = elections.map(election => `<a href="/vote/${escapeHtml(election.id)}"><section class="ev-card">
        <span class="ev-badge ${escapeHtml(election.status)}">${escapeHtml(STATUS_LABELS[election.status] || '')}</span>
        <h2 style="margin:10px 0 6px;">${escapeHtml(election.title)}</h2>
        <p class="ev-lead" style="margin:0;">${election.position ? `選舉職位：${escapeHtml(election.position)}・` : ''}候選人 ${election.candidates.length} 位・投票期間：${escapeHtml(period(election))}</p>
    </section></a>`).join('');
    return `${getHeader('社團選舉', 'zh')}${STYLE}
    <main class="ev-main">
        <h1>社團選舉</h1>
        <p class="ev-lead">選舉公報、候選人政見與線上投票。投票採一人一票、秘密投票：以學號與姓名核對社員名冊後投票，系統不會記錄你投給誰。</p>
        <div class="ev-list">${cards || '<section class="ev-card"><p class="ev-lead" style="margin:0;">目前沒有公告中的選舉。</p></section>'}</div>
    </main>
    ${getFooter('zh')}`;
}

function candidateCard(candidate) {
    const photo = candidate.photoUrl
        ? `<img class="ev-photo" src="${escapeHtml(candidate.photoUrl)}" alt="${escapeHtml(candidate.name)} 照片" loading="lazy" referrerpolicy="no-referrer">`
        : `<div class="ev-photo" aria-hidden="true">${escapeHtml(candidate.name.slice(0, 1))}</div>`;
    return `<article class="ev-card ev-candidate" id="candidate-${candidate.number}">
        ${photo}
        <div>
            <h3><span class="ev-number">${candidate.number}</span>${escapeHtml(candidate.name)}</h3>
            ${candidate.department ? `<div class="ev-lead" style="margin:0;">${escapeHtml(candidate.department)}</div>` : ''}
            ${candidate.slogan ? `<p class="ev-slogan">「${escapeHtml(candidate.slogan)}」</p>` : ''}
            ${candidate.experience ? `<div class="ev-section-title">經歷</div><div class="ev-text">${paragraphs(candidate.experience)}</div>` : ''}
            ${candidate.platform ? `<div class="ev-section-title">政見</div><div class="ev-text">${paragraphs(candidate.platform)}</div>` : ''}
        </div>
    </article>`;
}

function resultsSection(results) {
    if (!results) return '';
    const top = Math.max(1, ...results.options.map(option => option.votes));
    return `<section class="ev-card"><h2>開票結果</h2>
        ${results.options.map(option => `<div class="ev-result"><strong>${escapeHtml(option.label)}</strong><div class="ev-bar"><span style="width:${Math.round(option.votes / top * 100)}%"></span></div><span>${option.votes} 票</span></div>`).join('')}
        <p class="ev-lead" style="margin:14px 0 0;">有效票 ${results.totalBallots} 張・選舉人 ${results.rollSize} 人・投票率 ${(results.turnout * 100).toFixed(1)}%</p>
    </section>`;
}

function votingSection(election, turnstileSiteKey, captcha) {
    return `<section class="ev-card" id="ev-vote" data-election="${escapeHtml(election.id)}">
        <h2>線上投票</h2>
        <form id="ev-verify-form" novalidate>
            <p class="ev-lead">第一步：輸入學號與姓名，核對是否為本次選舉人名冊中的社員。</p>
            <div class="ev-grid">
                <label class="ev-field"><span>學號</span><input class="ev-input" id="ev-studentId" maxlength="15" autocomplete="off" style="text-transform:uppercase" required></label>
                <label class="ev-field"><span>姓名</span><input class="ev-input" id="ev-name" maxlength="50" autocomplete="name" required></label>
            </div>
            ${turnstileSiteKey ? `<div class="cf-turnstile" data-sitekey="${escapeHtml(turnstileSiteKey)}"></div>` : ''}
            ${captcha ? `<div class="ev-field"><span>驗證碼</span>
                <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                    <div id="ev-captcha-image" style="border:1px solid #b1b4b6; border-radius:4px; line-height:0; overflow:hidden; background:#f4f1e8;">${captcha.svg}</div>
                    <button type="button" class="ev-btn" id="ev-captcha-refresh">換一張</button>
                </div>
                <input type="hidden" id="ev-captcha-id" value="${escapeHtml(captcha.id)}">
                <input class="ev-input" id="ev-captcha" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="5" required placeholder="請輸入圖片中的 5 個字元（不分大小寫）">
            </div>` : ''}
            <div class="ev-notice">
                <strong>選務紀錄說明</strong><br>
                為確保一人一票、防止冒名代投與賄選，驗證與投票時會記錄你的學號、時間、IP 位址、網路業者、瀏覽器與裝置資訊，供選務人員稽核。
                這些紀錄與選票<strong>分開儲存、互不連結</strong>：選票只記錄選擇的選項，沒有學號、時間或裝置，任何人（包含幹部與系統管理員）都無法得知你投給誰。
                ${election.oneVotePerDevice ? '本次選舉每台裝置只能投一票，請用自己的手機或電腦投票。' : ''}
                投票後無法更改，系統也不提供能證明投票內容的憑證；請勿將學號姓名交給他人代投，也不要接受任何要求你出示投票內容的對價。
            </div>
            <label class="ev-agree"><input type="checkbox" id="ev-consent" required> 我是本人投票，並同意上述選務紀錄方式。</label>
            <p class="ev-error" id="ev-verify-error" role="alert"></p>
            <div class="ev-actions"><button type="submit" class="ev-btn primary" id="ev-verify-submit">核對身分</button></div>
        </form>
        <form id="ev-ballot-form" hidden novalidate>
            <p class="ev-lead" id="ev-ballot-hello"></p>
            <fieldset style="border:0; padding:0; margin:0;"><legend class="ev-lead">第二步：圈選一個選項。送出後不能更改。</legend>
                <div class="ev-options" id="ev-options"></div>
            </fieldset>
            <p class="ev-error" id="ev-ballot-error" role="alert"></p>
            <div class="ev-actions"><button type="submit" class="ev-btn primary" id="ev-ballot-submit">確認投票</button><button type="button" class="ev-btn" id="ev-ballot-cancel">取消</button></div>
        </form>
        <div id="ev-done" class="ev-done" hidden aria-live="polite">
            <h2 style="color:var(--color-success);">投票完成</h2>
            <p class="ev-lead">你的選票已投入票匭。選票與身分分開保存，沒有人能查到你的投票內容。結果將於投票結束後公布。</p>
        </div>
    </section>`;
}

export function renderElectionPage(election, results = null, turnstileSiteKey = '', captcha = null) {
    const voting = election.status === 'open';
    return `${getHeader(election.title, 'zh')}
    ${voting && turnstileSiteKey ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : ''}
    ${STYLE}
    <main class="ev-main">
        <p style="margin:0 0 10px;"><a href="/vote" style="color:var(--text-secondary);">← 所有選舉</a></p>
        <span class="ev-badge ${escapeHtml(election.status)}">${escapeHtml(STATUS_LABELS[election.status] || '')}</span>
        <h1 style="margin-top:10px;">${escapeHtml(election.title)}</h1>
        <section class="ev-card">
            <dl class="ev-facts">
                ${election.position ? `<dt>選舉職位</dt><dd>${escapeHtml(election.position)}</dd>` : ''}
                <dt>投票期間</dt><dd>${escapeHtml(period(election))}</dd>
                <dt>選舉人資格</dt><dd>${escapeHtml(election.eligibilityLabel)}</dd>
                <dt>投票方式</dt><dd>線上秘密投票，一人一票${election.candidates.length === 1 ? '（同額競選，圈選同意或不同意）' : '，圈選一位候選人'}</dd>
                ${election.rollSize ? `<dt>選舉人數</dt><dd>${election.rollSize} 人${voting ? `・已投票 ${election.voterCount} 人` : ''}</dd>` : ''}
            </dl>
            ${election.description ? `<div class="ev-text" style="margin-top:14px;">${paragraphs(election.description)}</div>` : ''}
        </section>
        ${resultsSection(results)}
        ${election.status === 'closed' && !results ? '<section class="ev-card"><p class="ev-lead" style="margin:0;">投票已結束，結果待選務人員公布。</p></section>' : ''}
        ${voting ? votingSection(election, turnstileSiteKey, captcha) : ''}
        <h2 style="font-size:1.4rem; margin:28px 0 14px;">選舉公報</h2>
        <div class="ev-candidates">${election.candidates.map(candidateCard).join('') || '<section class="ev-card"><p class="ev-lead" style="margin:0;">尚未登錄候選人。</p></section>'}</div>
    </main>
    ${voting ? '<script src="/vote.js" defer></script>' : ''}
    ${getFooter('zh')}`;
}
