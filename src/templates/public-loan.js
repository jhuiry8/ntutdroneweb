import { escapeHtml } from '../html.js';
import { getHeader, getFooter } from './layout.js';

// Public equipment loan slip: anyone can fill it in without logging in (no AI), then prints it for signatures.
export function renderPublicLoanForm(turnstileSiteKey = '', captcha = null) {
    const row = `<tr><td><input class="pl-input" data-col="name" maxlength="100" aria-label="設備名稱／型號" placeholder="例如：DJI Mini 4 Pro"></td><td><input class="pl-input" data-col="quantity" type="number" min="1" max="1000" step="1" value="1" aria-label="數量"></td><td><input class="pl-input" data-col="accessories" maxlength="100" aria-label="配件" placeholder="例如：電池 x3、遙控器"></td><td><button type="button" class="pl-remove" aria-label="刪除此列">✕</button></td></tr>`;
    return `${getHeader('設備借用申請', 'zh')}
    ${turnstileSiteKey ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : ''}
    <style>
        .pl-main { max-width: 860px; margin: 0 auto; padding: 120px 16px 72px; color: var(--text-primary); }
        .pl-main h1 { font-size: clamp(1.7rem, 4vw, 2.3rem); font-weight: 800; margin: 0 0 10px; }
        .pl-lead { color: var(--text-secondary); line-height: 1.75; margin: 0 0 22px; }
        .pl-steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 0 0 24px; padding: 0; list-style: none; counter-reset: step; }
        .pl-steps li { counter-increment: step; padding: 14px; border: 1px solid var(--border-color); border-radius: 12px; background: var(--bg-card); color: var(--text-secondary); font-size: .92rem; line-height: 1.6; }
        .pl-steps li::before { content: counter(step); display: inline-grid; place-items: center; width: 24px; height: 24px; margin-right: 8px; border-radius: 50%; background: var(--color-primary); color: #fff; font-weight: 700; font-size: .85rem; }
        .pl-card { padding: 22px; border: 1px solid var(--border-color); border-radius: 16px; background: var(--bg-card); margin-bottom: 18px; }
        .pl-card h2 { font-size: 1.1rem; margin: 0 0 14px; }
        .pl-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
        .pl-field { display: grid; gap: 6px; font-size: .9rem; color: var(--text-secondary); }
        .pl-field.wide { grid-column: 1 / -1; }
        .pl-field b { color: var(--color-danger); font-weight: 600; }
        .pl-input { width: 100%; box-sizing: border-box; padding: 11px 12px; border-radius: 10px; border: 1px solid var(--border-color); background: var(--bg-page); color: var(--text-primary); font: inherit; font-size: 16px; }
        .pl-input:focus { outline: 2px solid var(--color-primary); outline-offset: 1px; }
        .pl-period { display: grid; grid-template-columns: 1fr 110px; gap: 8px; }
        .pl-table-wrap { overflow-x: auto; }
        .pl-table { width: 100%; border-collapse: collapse; min-width: 520px; }
        .pl-table th { text-align: left; font-size: .85rem; color: var(--text-secondary); font-weight: 600; padding: 0 6px 8px; }
        .pl-table td { padding: 4px 6px 4px 0; }
        .pl-table td:nth-child(2) { width: 90px; }
        .pl-table td:last-child { width: 44px; }
        .pl-remove { width: 40px; height: 40px; border-radius: 10px; border: 1px solid var(--border-color); background: transparent; color: var(--text-secondary); cursor: pointer; }
        .pl-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 10px; }
        .pl-btn { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 18px; border-radius: 10px; border: 1px solid var(--border-color); background: transparent; color: var(--text-primary); font: inherit; font-weight: 600; cursor: pointer; text-decoration: none; }
        .pl-btn.primary { background: var(--color-primary); border-color: var(--color-primary); color: #fff; }
        .pl-btn:disabled { opacity: .6; cursor: wait; }
        .pl-rules { color: var(--text-secondary); font-size: .9rem; line-height: 1.75; padding-left: 20px; margin: 0; }
        .pl-agree { display: flex; gap: 10px; align-items: flex-start; margin-top: 14px; font-size: .95rem; }
        .pl-agree input { width: 20px; height: 20px; margin-top: 2px; flex: none; }
        .pl-error { color: var(--color-danger); min-height: 1.4em; margin: 10px 0 0; }
        .pl-done { border-color: var(--color-success); }
        .pl-done strong { font-size: 1.6rem; color: var(--color-success); letter-spacing: .04em; }
        @media (max-width: 680px) { .pl-steps, .pl-grid { grid-template-columns: minmax(0, 1fr); } .pl-main { padding-top: 96px; } }
    </style>
    <main class="pl-main">
        <h1>設備借用申請</h1>
        <p class="pl-lead">不需登入。填好送出後會拿到借據編號，請列印借據並親筆簽名，交給財產管理人與社長簽核後才能領取設備。</p>
        <ol class="pl-steps"><li>線上填寫借用人與設備資料</li><li>送出後列印借據（一張 A4 兩聯）</li><li>簽名後交給幹部，簽核完成再領取</li></ol>
        <form id="public-loan-form" novalidate>
            <section class="pl-card"><h2>借用人資料</h2><div class="pl-grid">
                <label class="pl-field"><span>姓名 <b>*</b></span><input class="pl-input" id="pl-borrower" maxlength="50" autocomplete="name" required></label>
                <label class="pl-field"><span>學號 <b>*</b></span><input class="pl-input" id="pl-studentId" maxlength="15" style="text-transform:uppercase" autocomplete="off" required pattern="[A-Za-z0-9]{5,15}" placeholder="請自行填寫學號"></label>
                <label class="pl-field"><span>系級</span><input class="pl-input" id="pl-department" maxlength="50" placeholder="例如：機械三"></label>
                <label class="pl-field"><span>聯絡電話 <b>*</b></span><input class="pl-input" id="pl-phone" maxlength="20" type="tel" autocomplete="tel" required></label>
                <label class="pl-field wide"><span>借用用途 <b>*</b></span><input class="pl-input" id="pl-purpose" maxlength="200" required placeholder="例如：期末成果展空拍"></label>
            </div></section>
            <section class="pl-card"><h2>借用期間</h2><div class="pl-grid">
                <label class="pl-field"><span>借用日期與時 <b>*</b></span><span class="pl-period"><input class="pl-input" id="pl-startDate" type="date" required><select class="pl-input" id="pl-startHour" aria-label="借用時"></select></span></label>
                <label class="pl-field"><span>歸還日期與時 <b>*</b></span><span class="pl-period"><input class="pl-input" id="pl-endDate" type="date" required><select class="pl-input" id="pl-endHour" aria-label="歸還時"></select></span></label>
            </div></section>
            <section class="pl-card"><h2>借用設備（最多 6 項）</h2>
                <p class="pl-lead" style="margin-bottom:12px; font-size:.9rem;">財產編號由幹部在簽核時填寫，不清楚型號可寫大概名稱。</p>
                <div class="pl-table-wrap"><table class="pl-table"><thead><tr><th>設備名稱／型號 *</th><th>數量</th><th>配件</th><th></th></tr></thead><tbody id="pl-items">${row}</tbody></table></div>
                <div class="pl-actions"><button type="button" class="pl-btn" id="pl-add">新增一項設備</button></div>
                <template id="pl-row-template">${row}</template>
            </section>
            <section class="pl-card"><h2>借用規定</h2>
                <ol class="pl-rules">
                    <li>設備僅限申請用途使用，不得轉借他人或挪作私用；飛行須遵守民航法規及本社飛安規範，於合法安全場地進行。</li>
                    <li>借用期間如有遺失、損壞，借用人應照價賠償或負責維修至原狀。鋰電池應依規定充放電及儲存，不得過充、過放或置於高溫處。</li>
                    <li>須於期限內歸還；如需延長，應於到期前向財產管理人申請並重新簽核。逾期或違規者，本社得停止其借用權利。</li>
                </ol>
                <label class="pl-agree"><input type="checkbox" id="pl-agree" required> 我已閱讀並同意遵守以上借用規定。</label>
                ${turnstileSiteKey ? `<div class="cf-turnstile" data-sitekey="${escapeHtml(turnstileSiteKey)}" style="margin-top:14px;"></div>` : ''}
                ${captcha ? `<div class="pl-field" style="margin-top:14px;">
                    <span>驗證碼 <b>*</b></span>
                    <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin:6px 0;">
                        <div id="pl-captcha-image" style="border:1px solid #b1b4b6; border-radius:4px; line-height:0; overflow:hidden; background:#f4f1e8;">${captcha.svg}</div>
                        <button type="button" class="pl-btn" id="pl-captcha-refresh">換一張</button>
                    </div>
                    <input type="hidden" id="pl-captcha-id" value="${escapeHtml(captcha.id)}">
                    <input class="pl-input" id="pl-captcha" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="5" required placeholder="請輸入圖片中的 5 個字元（不分大小寫）">
                </div>` : ''}
                <p class="pl-error" id="pl-error" role="alert"></p>
                <div class="pl-actions"><button type="submit" class="pl-btn primary" id="pl-submit">送出並取得借據</button></div>
            </section>
        </form>
        <section class="pl-card pl-done" id="pl-done" hidden aria-live="polite">
            <h2>已送出，借據編號</h2>
            <strong id="pl-number"></strong>
            <p class="pl-lead" style="margin-top:12px;">請立即列印借據並簽名，交給財產管理人與社長簽核。列印連結 <span id="pl-days">3</span> 天內有效，只有你拿得到，請勿分享。</p>
            <div class="pl-actions"><a class="pl-btn primary" id="pl-print" href="#" target="_blank" rel="noopener">列印借據</a><button type="button" class="pl-btn" id="pl-again">再填一張</button></div>
        </section>
    </main>
    <script src="/public-loan.js" defer></script>
    ${getFooter('zh', 'loan')}`;
}
