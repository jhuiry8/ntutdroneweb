import { escapeHtml } from '../html.js';
import { PWA_HEAD_TAGS } from './layout.js';

// 5. Render Admin Login Page
export function renderLogin(errorMessage = '', turnstileSiteKey = '', captcha = null) {
    return `
    <!DOCTYPE html>
    <html lang="zh-TW">
    <head>
        <meta charset="UTF-8">
        ${PWA_HEAD_TAGS}
        <title>後台登入 | 北科無人機社</title>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;700&family=Outfit:wght@400;600;800&display=swap" rel="stylesheet">
        ${turnstileSiteKey ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : ''}
        <script src="/vendor/lucide-1.65.0.min.js"></script>
        <link rel="stylesheet" href="/style.css">
        <style>
            body {
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                background: #f3f2f1;
                padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
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
            @media (max-width: 480px) { .login-container { padding: 28px 20px; } }
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
                <p style="color: var(--text-muted); font-size: 0.8rem; margin-top: 8px;">舊管理者請以 admin 和原管理密碼登入，再由社長建立個別帳號。</p>
            </div>
            
            ${errorMessage ? `<div style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; padding: 12px; border-radius: 12px; font-size: 0.875rem; margin-bottom: 20px; text-align: center;"><i data-lucide="alert-circle" style="width: 16px; height: 16px; display: inline; vertical-align: middle; margin-right: 6px;"></i> ${escapeHtml(errorMessage)}</div>` : ''}
            
            <form action="/api/login" method="POST">
                <div class="form-group">
                    <label for="username">帳號</label>
                    <input type="text" name="username" id="username" class="form-control" autocomplete="username" required autofocus>
                </div>
                <div class="form-group">
                    <label for="password">密碼</label>
                    <input type="password" name="password" id="password" class="form-control" autocomplete="current-password" required>
                </div>
                ${turnstileSiteKey ? `<div class="cf-turnstile" data-sitekey="${escapeHtml(turnstileSiteKey)}" data-size="compact"></div>` : ''}
                ${captcha ? `
                <div class="form-group">
                    <label for="captcha">驗證碼</label>
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap;">
                        <div id="captcha-image" style="border: 1px solid #b1b4b6; border-radius: 4px; line-height: 0; overflow: hidden;">${captcha.svg}</div>
                        <button type="button" id="captcha-refresh" class="btn" style="padding: 8px 12px; font-size: 0.85rem;" aria-label="換一張驗證碼"><i data-lucide="refresh-cw" style="width: 14px; height: 14px; display: inline; vertical-align: middle;"></i> 換一張</button>
                    </div>
                    <input type="hidden" name="captcha_id" id="captcha-id" value="${escapeHtml(captcha.id)}">
                    <input type="text" name="captcha" id="captcha" class="form-control" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="5" placeholder="請輸入圖片中的 5 個字元（不分大小寫）" required>
                </div>` : ''}
                <button type="submit" class="btn btn-primary" style="width: 100%; border-radius: 12px; padding: 14px; margin-top: 10px;">安全登入</button>
            </form>
            <div class="text-center" style="margin-top: 24px;">
                <a href="/" style="font-size: 0.85rem; color: var(--text-muted);"><i data-lucide="arrow-left" style="width: 12px; height: 12px; display: inline; vertical-align: middle;"></i> 返回網站首頁</a>
            </div>
        </div>
        <script>
            if (typeof lucide !== 'undefined' && lucide.createIcons) { lucide.createIcons(); }
            const captchaRefresh = document.getElementById('captcha-refresh');
            if (captchaRefresh) {
                captchaRefresh.addEventListener('click', async () => {
                    captchaRefresh.disabled = true;
                    try {
                        const res = await fetch('/api/captcha', { method: 'POST', cache: 'no-store' });
                        if (!res.ok) throw new Error('captcha refresh failed');
                        const data = await res.json();
                        document.getElementById('captcha-image').innerHTML = data.svg;
                        document.getElementById('captcha-id').value = data.id;
                        const input = document.getElementById('captcha');
                        input.value = '';
                        input.focus();
                    } catch (e) {
                        window.location.reload();
                    } finally {
                        captchaRefresh.disabled = false;
                    }
                });
            }
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
