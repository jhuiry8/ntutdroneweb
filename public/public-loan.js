// Public equipment loan form (no login, no AI): validate, submit, then offer the print link.
(function () {
    'use strict';

    var form = document.getElementById('public-loan-form');
    if (!form) return;
    var PROFILE_KEY = 'ntut-forms-profile';
    var MAX_ITEMS = 6;
    var items = document.getElementById('pl-items');
    var errorBox = document.getElementById('pl-error');
    var submit = document.getElementById('pl-submit');

    function $(id) { return document.getElementById(id); }
    function today() {
        var now = new Date();
        return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    }
    function readProfile() {
        try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}') || {}; } catch (error) { return {}; }
    }
    function writeProfile(update) {
        try { localStorage.setItem(PROFILE_KEY, JSON.stringify(Object.assign(readProfile(), update))); } catch (error) { /* storage unavailable */ }
    }

    ['pl-startHour', 'pl-endHour'].forEach(function (id, index) {
        var select = $(id);
        for (var hour = 0; hour < 24; hour++) select.insertAdjacentHTML('beforeend', '<option value="' + hour + '">' + hour + ' 時</option>');
        select.value = index === 0 ? '9' : '18';
    });
    $('pl-startDate').value = today();
    $('pl-startDate').min = today();
    $('pl-endDate').min = today();

    var profile = readProfile();
    if (profile.name) $('pl-borrower').value = profile.name;
    if (profile.studentId) $('pl-studentId').value = profile.studentId;
    if (profile.department) $('pl-department').value = profile.department;
    if (profile.phone) $('pl-phone').value = profile.phone;

    $('pl-startDate').addEventListener('change', function () {
        $('pl-endDate').min = this.value || today();
        if ($('pl-endDate').value && $('pl-endDate').value < this.value) $('pl-endDate').value = this.value;
    });
    $('pl-add').addEventListener('click', function () {
        if (items.children.length >= MAX_ITEMS) return showError('最多借用 ' + MAX_ITEMS + ' 項設備，超過請分開填寫。');
        items.appendChild($('pl-row-template').content.cloneNode(true));
    });
    items.addEventListener('click', function (event) {
        var button = event.target.closest('.pl-remove');
        if (!button) return;
        if (items.children.length === 1) {
            items.querySelectorAll('input').forEach(function (input) { input.value = input.dataset.col === 'quantity' ? '1' : ''; });
        } else {
            button.closest('tr').remove();
        }
    });

    function showError(message) {
        errorBox.textContent = message;
        if (message) errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function collect() {
        var rows = Array.prototype.map.call(items.querySelectorAll('tr'), function (row) {
            var value = function (col) { return row.querySelector('[data-col="' + col + '"]').value.trim(); };
            return { name: value('name'), quantity: Number(value('quantity') || 1), accessories: value('accessories'), assetNo: '', condition: '' };
        }).filter(function (item) { return item.name; });
        return {
            borrower: $('pl-borrower').value.trim(),
            studentId: $('pl-studentId').value.trim().toUpperCase(),
            department: $('pl-department').value.trim(),
            phone: $('pl-phone').value.trim(),
            purpose: $('pl-purpose').value.trim(),
            fillDate: today(),
            startDate: $('pl-startDate').value,
            startHour: Number($('pl-startHour').value),
            endDate: $('pl-endDate').value,
            endHour: Number($('pl-endHour').value),
            items: rows
        };
    }

    form.addEventListener('submit', async function (event) {
        event.preventDefault();
        showError('');
        if (!form.reportValidity()) return;
        var data = collect();
        if (!data.items.length) return showError('請至少填寫一項要借用的設備。');
        if (data.endDate < data.startDate) return showError('歸還日期不可早於借用日期。');
        var tokenInput = form.querySelector('[name="cf-turnstile-response"]');
        if (document.querySelector('.cf-turnstile') && !(tokenInput && tokenInput.value)) return showError('請先完成驗證碼。');
        var captchaId = $('pl-captcha-id');
        var captchaInput = $('pl-captcha');
        submit.disabled = true;
        submit.textContent = '送出中…';
        try {
            var response = await fetch('/api/public/equipment-loan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    data: data,
                    turnstileToken: tokenInput ? tokenInput.value : '',
                    captchaId: captchaId ? captchaId.value : '',
                    captcha: captchaInput ? captchaInput.value : ''
                })
            });
            var result = await response.json().catch(function () { return {}; });
            if (!response.ok) throw new Error(result.error || '送出失敗，請稍後再試');
            writeProfile({ name: data.borrower, studentId: data.studentId, department: data.department, phone: data.phone });
            $('pl-number').textContent = result.number;
            $('pl-days').textContent = result.printDays || 3;
            $('pl-print').href = result.printUrl;
            form.hidden = true;
            $('pl-done').hidden = false;
            $('pl-done').scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (error) {
            showError(error.message);
        } finally {
            submit.disabled = false;
            submit.textContent = '送出並取得借據';
            if (window.turnstile && document.querySelector('.cf-turnstile')) window.turnstile.reset();
            // Each image CAPTCHA works only once, so fetch a new one after every attempt.
            if (captchaId) refreshCaptcha();
        }
    });

    async function refreshCaptcha() {
        var button = $('pl-captcha-refresh');
        if (button) button.disabled = true;
        try {
            var response = await fetch('/api/captcha', { method: 'POST', cache: 'no-store' });
            if (!response.ok) throw new Error('captcha refresh failed');
            var next = await response.json();
            $('pl-captcha-image').innerHTML = next.svg;
            $('pl-captcha-id').value = next.id;
            $('pl-captcha').value = '';
        } catch (error) {
            showError('無法更新驗證碼，請重新整理頁面。');
        } finally {
            if (button) button.disabled = false;
        }
    }
    if ($('pl-captcha-refresh')) $('pl-captcha-refresh').addEventListener('click', refreshCaptcha);

    $('pl-again').addEventListener('click', function () {
        $('pl-purpose').value = '';
        $('pl-agree').checked = false;
        items.innerHTML = '';
        items.appendChild($('pl-row-template').content.cloneNode(true));
        $('pl-done').hidden = true;
        form.hidden = false;
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
})();
