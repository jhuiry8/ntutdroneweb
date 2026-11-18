// Public voting steps: verify student ID + name, choose one option, cast the ballot.
(function () {
    'use strict';

    var root = document.getElementById('ev-vote');
    if (!root) return;
    var electionId = root.dataset.election;
    var token = '';

    function $(id) { return document.getElementById(id); }

    async function sha256(text) {
        if (!window.crypto || !crypto.subtle) return '';
        var digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.prototype.map.call(new Uint8Array(digest), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    }

    // Device characteristics for the audit log. Never linked to the ballot.
    var devicePromise = (async function () {
        var screenText = (screen.width || 0) + 'x' + (screen.height || 0) + '@' + (window.devicePixelRatio || 1);
        var timezone = '';
        try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (error) { /* ignore */ }
        var platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
        var touch = navigator.maxTouchPoints || 0;
        var canvasHash = '';
        try {
            var canvas = document.createElement('canvas');
            canvas.width = 200; canvas.height = 40;
            var ctx = canvas.getContext('2d');
            ctx.textBaseline = 'top'; ctx.font = '16px Arial'; ctx.fillStyle = '#f60'; ctx.fillRect(0, 0, 80, 20);
            ctx.fillStyle = '#069'; ctx.fillText('NTUT drone 投票 ✈', 2, 15);
            canvasHash = await sha256(canvas.toDataURL());
        } catch (error) { /* ignore */ }
        var parts = [navigator.userAgent, navigator.language, (navigator.languages || []).join(','), screenText, screen.colorDepth, timezone, platform, touch, navigator.hardwareConcurrency || 0, navigator.deviceMemory || 0, canvasHash];
        return { fingerprint: (await sha256(parts.join('|'))).slice(0, 32), screen: screenText, timezone: timezone, platform: platform, touch: touch };
    })();

    async function post(step, body) {
        body.device = await devicePromise;
        var response = await fetch('/api/vote/' + encodeURIComponent(electionId) + '/' + step, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        var data = await response.json().catch(function () { return {}; });
        if (!response.ok) throw new Error(data.error || '連線失敗，請稍後再試');
        return data;
    }

    async function refreshCaptcha() {
        if (!$('ev-captcha-id')) return;
        try {
            var response = await fetch('/api/captcha', { method: 'POST' });
            var data = await response.json();
            if (!response.ok) return;
            $('ev-captcha-image').innerHTML = data.svg;
            $('ev-captcha-id').value = data.id;
            $('ev-captcha').value = '';
        } catch (error) { /* keep the current image */ }
    }
    if ($('ev-captcha-refresh')) $('ev-captcha-refresh').addEventListener('click', refreshCaptcha);

    $('ev-verify-form').addEventListener('submit', async function (event) {
        event.preventDefault();
        var error = $('ev-verify-error');
        error.textContent = '';
        var studentId = $('ev-studentId').value.trim().toUpperCase();
        var name = $('ev-name').value.trim();
        if (!/^[A-Za-z0-9]{5,15}$/.test(studentId) || !name) { error.textContent = '請輸入正確的學號與姓名。'; return; }
        if (!$('ev-consent').checked) { error.textContent = '請勾選同意選務紀錄方式。'; return; }
        var body = { studentId: studentId, name: name };
        if ($('ev-captcha-id')) { body.captchaId = $('ev-captcha-id').value; body.captcha = $('ev-captcha').value.trim(); }
        var turnstile = document.querySelector('[name="cf-turnstile-response"]');
        if (turnstile) body.turnstileToken = turnstile.value;
        var button = $('ev-verify-submit');
        button.disabled = true;
        try {
            var data = await post('verify', body);
            token = data.token;
            $('ev-ballot-hello').textContent = (data.displayName || name) + ' 同學，身分已確認。請在 ' + Math.round(data.expiresInSeconds / 60) + ' 分鐘內完成投票。';
            $('ev-options').innerHTML = '';
            data.options.forEach(function (option) {
                var label = document.createElement('label');
                label.className = 'ev-option';
                var input = document.createElement('input');
                input.type = 'radio'; input.name = 'choice'; input.value = option.id;
                label.appendChild(input);
                label.appendChild(document.createTextNode(option.label));
                $('ev-options').appendChild(label);
            });
            $('ev-verify-form').hidden = true;
            $('ev-ballot-form').hidden = false;
            $('ev-ballot-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (failure) {
            error.textContent = failure.message;
            refreshCaptcha();
            if (window.turnstile) try { window.turnstile.reset(); } catch (ignored) { /* ignore */ }
        } finally {
            button.disabled = false;
        }
    });

    $('ev-ballot-cancel').addEventListener('click', function () {
        token = '';
        $('ev-ballot-form').hidden = true;
        $('ev-verify-form').hidden = false;
        refreshCaptcha();
    });

    $('ev-ballot-form').addEventListener('submit', async function (event) {
        event.preventDefault();
        var error = $('ev-ballot-error');
        error.textContent = '';
        var chosen = document.querySelector('input[name="choice"]:checked');
        if (!chosen) { error.textContent = '請圈選一個選項。'; return; }
        var label = chosen.parentNode.textContent.trim();
        if (!window.confirm('確定投給「' + label + '」嗎？送出後不能更改。')) return;
        var button = $('ev-ballot-submit');
        button.disabled = true;
        try {
            await post('cast', { token: token, choice: chosen.value });
            token = '';
            // Clear the choice from the page so it is not left on screen.
            $('ev-options').innerHTML = '';
            $('ev-ballot-form').hidden = true;
            $('ev-done').hidden = false;
        } catch (failure) {
            error.textContent = failure.message;
        } finally {
            button.disabled = false;
        }
    });
})();
