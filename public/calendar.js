// Calendar page: shows the subscription URLs (absolute) and fetches the member-only feed URL.
(function () {
    var box = document.getElementById('calendar-subscribe');
    if (!box) return;
    var pub = document.getElementById('feed-public');
    pub.value = location.origin + '/calendar.ics';
    function copy(input) { input.select(); try { navigator.clipboard.writeText(input.value); } catch (e) { document.execCommand('copy'); } }
    pub.addEventListener('focus', function () { pub.select(); });
    if (box.dataset.signedIn !== '1') return;
    var holder = document.getElementById('feed-member');
    function show(url) {
        holder.textContent = '';
        var label = document.createElement('label'); label.textContent = box.dataset.memberLabel;
        var input = document.createElement('input'); input.readOnly = true; input.value = url;
        label.appendChild(input); holder.appendChild(label);
        var row = document.createElement('div'); row.className = 'group'; row.style.marginTop = '8px';
        var copyBtn = document.createElement('button'); copyBtn.type = 'button'; copyBtn.className = 'cal-btn'; copyBtn.textContent = box.dataset.copy;
        copyBtn.onclick = function () { copy(input); };
        var rotate = document.createElement('button'); rotate.type = 'button'; rotate.className = 'cal-btn'; rotate.textContent = box.dataset.rotate;
        rotate.onclick = function () { load('POST'); };
        row.appendChild(copyBtn); row.appendChild(rotate); holder.appendChild(row);
    }
    function load(method) {
        fetch('/api/calendar/token', { method: method, credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (d) { if (d.url) show(d.url); });
    }
    load('GET');
})();
