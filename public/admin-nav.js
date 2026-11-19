// Dashboard navigation and toast helpers, loaded in <head> so onclick handlers work early.
function showToast(text, isError) {
    var toast = document.getElementById('toast');
    var toastText = document.getElementById('toast-text');
    if (!toast || !toastText) return;
    toastText.innerText = text;
    if (isError) {
        toast.style.borderColor = '#ef4444';
        toast.innerHTML = '<i data-lucide="alert-circle" style="color:#ef4444; width:20px; height:20px;"></i> <span id="toast-text"></span>';
    } else {
        toast.style.borderColor = 'var(--color-cyan)';
        toast.innerHTML = '<i data-lucide="check-circle" style="color:var(--color-cyan); width:20px; height:20px;"></i> <span id="toast-text"></span>';
    }
    if (typeof lucide !== 'undefined' && lucide.createIcons) { lucide.createIcons(); }
    toast.querySelector('span').textContent = text;
    toast.classList.add('show');
    setTimeout(function() { toast.classList.remove('show'); }, 3000);
}

function showPanel(panelName) {
    document.querySelectorAll('.panel').forEach(function(p) { p.classList.remove('active'); });
    document.querySelectorAll('.nav-item').forEach(function(btn) { btn.classList.remove('active'); });
    var panel = document.getElementById('panel-' + panelName);
    if (panel) panel.classList.add('active');
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(function(btn) {
        if (btn.getAttribute('onclick') && btn.getAttribute('onclick').indexOf(panelName) !== -1) {
            btn.classList.add('active');
        }
    });
    if (typeof closePostForm === 'function') closePostForm();
    if (typeof closePageForm === 'function') closePageForm();
    closeAdminMenu();
}

function toggleAdminMenu() {
    const open = document.body.classList.toggle('menu-open');
    document.querySelector('.mobile-admin-bar button').setAttribute('aria-expanded', String(open));
}
function closeAdminMenu() {
    document.body.classList.remove('menu-open');
    const button = document.querySelector('.mobile-admin-bar button');
    if (button) button.setAttribute('aria-expanded', 'false');
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAdminMenu(); });

function logout() {
    fetch('/api/logout', { method: 'POST' }).then(function() { location.href = '/admin'; });
}

function openPostForm() {
    var listView = document.getElementById('posts-list-view');
    var formView = document.getElementById('posts-form-view');
    if (listView) listView.style.display = 'none';
    if (formView) formView.style.display = 'block';
    var title = document.getElementById('post-form-title');
    if (title) title.innerText = '新增文章';
    var form = document.getElementById('post-form');
    if (form) form.reset();
    var origSlug = document.getElementById('post-original-slug');
    if (origSlug) origSlug.value = '';
    var slug = document.getElementById('post-slug');
    if (slug) slug.disabled = false;
    if (typeof updateLivePreview === 'function') updateLivePreview('post-content');
}

function closePostForm() {
    var listView = document.getElementById('posts-list-view');
    var formView = document.getElementById('posts-form-view');
    if (listView) listView.style.display = 'block';
    if (formView) formView.style.display = 'none';
}

function openPageForm() {
    var listView = document.getElementById('pages-list-view');
    var formView = document.getElementById('pages-form-view');
    if (listView) listView.style.display = 'none';
    if (formView) formView.style.display = 'block';
    var title = document.getElementById('page-form-title');
    if (title) title.innerText = '新增頁面';
    var form = document.getElementById('page-form');
    if (form) form.reset();
    var origSlug = document.getElementById('page-original-slug');
    if (origSlug) origSlug.value = '';
    var slug = document.getElementById('page-slug');
    if (slug) slug.disabled = false;
    if (typeof updateLivePreview === 'function') updateLivePreview('page-content');
}

function closePageForm() {
    var listView = document.getElementById('pages-list-view');
    var formView = document.getElementById('pages-form-view');
    if (listView) listView.style.display = 'block';
    if (formView) formView.style.display = 'none';
}
