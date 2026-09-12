import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { parseDocument } from 'htmlparser2';
import worker from '../src/worker.js';
import { renderAdminDashboard } from '../src/templates.js';
import { sanitizeContent } from '../src/html.js';

function elements(html) {
    const result = [];
    function visit(node) {
        if (node.name && node.attribs) result.push(node);
        for (const child of node.children || []) visit(child);
    }
    visit(parseDocument(html));
    return result;
}

function fixture() {
    const store = new Map();
    const reads = [];
    for (const role of ['president', 'cadre', 'finance', 'member']) {
        store.set(`user:${role}`, JSON.stringify({ username: role, role, active: true, version: 'v1' }));
        store.set(`session:${role}`, JSON.stringify({ username: role, version: 'v1' }));
    }
    const env = { DRONE_DB: {
        async get(key) { reads.push(key); return store.get(key) ?? null; },
        async put(key, value) { store.set(key, value); },
        async delete(key) { store.delete(key); }
    } };
    const request = (path, role, method = 'GET', body) => worker.fetch(new Request(`https://example.com${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(role ? { Cookie: `session=${role}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }), env);
    return { store, reads, request };
}

test('cadre content cannot inject scripts or handlers into a president dashboard', async () => {
    const { request, store } = fixture();
    const attack = 'fetch("/api/users",{method:"PATCH",body:JSON.stringify({username:"cadre",role:"president"})})';
    const title = `<script>${attack}</script><img src=x onerror="${attack}">`;
    const slug = `x');${attack};//" onmouseover="${attack}`;
    assert.equal((await request('/api/users', 'cadre', 'PATCH', { username: 'cadre', role: 'president' })).status, 403);
    for (const type of ['posts', 'pages']) {
        assert.equal((await request(`/api/${type}`, 'cadre', 'POST', { title, slug, content: 'Hello' })).status, 200);
    }
    const html = await (await request('/admin/dashboard', 'president')).text();
    const nodes = elements(html);
    const baseline = elements(renderAdminDashboard([], [], { role: 'president' }));
    assert.equal(nodes.filter(n => n.name === 'script').length, baseline.filter(n => n.name === 'script').length);
    for (const node of nodes) {
        assert.equal(node.attribs.onmouseover, undefined);
        assert.equal(node.attribs.onerror, undefined);
        if (node.name === 'script') {
            const code = node.children.map(c => c.data || '').join('');
            assert.ok(!code.includes(attack));
            if (code.trim()) new vm.Script(code);
        }
    }
    // HTML parser decodes attributes as the browser does; the original slug must
    // survive as data, and the handler must call only its intended action.
    const buttons = nodes.filter(n => n.attribs['data-slug'] !== undefined);
    assert.equal(buttons.length, 4);
    for (const button of buttons) {
        assert.equal(button.attribs['data-slug'], slug);
        const calls = [];
        const context = { button: { dataset: { slug } } };
        for (const action of ['editPost', 'deletePost', 'editPage', 'deletePage']) context[action] = value => calls.push(value);
        vm.runInNewContext(`(function(){${button.attribs.onclick}}).call(button)`, context);
        assert.deepEqual(calls, [slug]);
    }
    assert.equal(JSON.parse(store.get('user:cadre')).role, 'cadre');
});

test('member dashboard does not read or emit CMS lists and controls', async () => {
    const { request, reads, store } = fixture();
    store.set('posts_list', JSON.stringify([{ title: 'CMS_POST_SECRET', slug: 'secret-post' }]));
    store.set('pages_list', JSON.stringify([{ title: 'CMS_PAGE_SECRET', slug: 'secret-page' }]));
    const response = await request('/admin/dashboard', 'member');
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.doesNotMatch(html, /CMS_POST_SECRET|CMS_PAGE_SECRET|id="panel-(posts|pages|media|homepage|users)"/);
    assert.match(html, /id="panel-settings" class="panel active"/);
    assert.ok(!reads.includes('posts_list') && !reads.includes('pages_list') && !reads.includes('homepage_content'));
    const directHtml = renderAdminDashboard([{ title: 'CMS_POST_SECRET' }], [{ title: 'CMS_PAGE_SECRET' }], { role: 'member' });
    assert.doesNotMatch(directHtml, /CMS_POST_SECRET|CMS_PAGE_SECRET/);
    for (const role of ['president', 'cadre', 'finance']) {
        const allowed = await (await request('/admin/dashboard', role)).text();
        assert.match(allowed, /CMS_POST_SECRET/);
        assert.match(allowed, /CMS_PAGE_SECRET/);
    }
});

test('published Markdown and authenticated previews share safe HTML rendering', async () => {
    const { request } = fixture();
    const content = '# Heading\n\n**Bold** and <u>underline</u>\n\n' +
        '| A | B |\n| - | - |\n| 1 | 2 |\n\n' +
        '![image](https://example.com/image.png)\n\n' +
        '<script>fetch("/api/users")</script><img src=x onerror="alert(1)">' +
        '<a href="jav&#x61;script:alert(1)">unsafe</a><iframe srcdoc="bad"></iframe>';
    assert.equal((await request('/api/preview', null, 'POST', { content })).status, 401);
    assert.equal((await request('/api/preview', 'member', 'POST', { content })).status, 403);
    assert.equal((await request('/api/preview', 'cadre', 'POST', { content: {} })).status, 400);
    const preview = await request('/api/preview', 'finance', 'POST', { content });
    assert.equal(preview.status, 200);
    const { html } = await preview.json();
    assert.match(html, /<h1>Heading<\/h1>/);
    assert.match(html, /<strong>Bold<\/strong>/);
    assert.match(html, /<u>underline<\/u>/);
    assert.match(html, /<table>/);
    assert.match(html, /src="https:\/\/example.com\/image.png"/);
    for (const node of elements(html)) {
        assert.ok(!['script', 'iframe'].includes(node.name));
        assert.equal(node.attribs.onerror, undefined);
        assert.ok(!node.attribs.href?.startsWith('javascript:'));
    }
    for (const [api, route] of [['posts', 'blog'], ['pages', 'page']]) {
        assert.equal((await request(`/api/${api}`, 'cadre', 'POST', { title: '<img src=x onerror=alert(1)>', slug: 'safe-preview', content, lang: '\" onmouseover=alert(1)' })).status, 200);
        const published = await (await request(`/${route}/safe-preview`)).text();
        assert.ok(published.includes(html));
        assert.ok(!elements(published).some(n => n.attribs.onerror));
        assert.ok(!elements(published).some(n => n.attribs.onmouseover));
    }
});

test('homepage overrides and legacy titles cannot create scripts or executable URLs', async () => {
    const { store, request } = fixture();
    store.set('posts_list', JSON.stringify([{ title: '<img src=x onerror=alert(1)>', summary: '<script>alert(1)</script>', slug: '\" onmouseover=alert(1)', lang: 'zh' }]));
    store.set('homepage_content', JSON.stringify({
        heroTitle: '<span class="highlight">Welcome</span><script>alert(1)</script>',
        igCard1Caption: '<svg onload=alert(1)>', igCard1Img: 'x\" onerror=alert(1)',
        lineLink: 'javascript:alert(1)', igLink: 'java\nscript:alert(1)'
    }));
    for (const path of ['/', '/blog']) {
        const nodes = elements(await (await request(path)).text());
        for (const node of nodes) {
            assert.equal(node.attribs.onerror, undefined);
            assert.equal(node.attribs.onmouseover, undefined);
            assert.equal(node.attribs.onload, undefined);
            assert.ok(!node.attribs.href?.replace(/\s/g, '').startsWith('javascript:'));
            if (node.name === 'script') assert.ok(!node.children.some(c => c.data?.includes('alert(1)')));
        }
    }
});

test('sanitizer rejects active HTML while retaining ordinary rich content', () => {
    for (const payload of [
        '<svg><a xlink:href="javascript:alert(1)">x</a></svg>',
        '<math><mtext><img src=x onerror=alert(1)></mtext></math>',
        '<a href="data:text/html,bad">x</a>',
        '<img src="data:image/svg+xml,bad">',
        '<form action=/api/login><input name=password></form>',
        '<style>body{display:none}</style><script>alert(1)</script>'
    ]) {
        for (const node of elements(sanitizeContent(payload))) {
            assert.ok(!['svg', 'math', 'form', 'input', 'script', 'style'].includes(node.name));
            assert.ok(!Object.keys(node.attribs).some(key => key.startsWith('on')));
            assert.ok(!/^(javascript|data):/i.test(node.attribs.href || node.attribs.src || ''));
        }
    }
});

test('editor preview ignores stale responses and falls back to text on failure', async () => {
    const script = elements(renderAdminDashboard([], [], { role: 'member' }))
        .filter(node => node.name === 'script')
        .map(node => node.children.map(child => child.data || '').join(''))
        .find(code => code.includes('const previewTimers'));
    const textarea = { value: 'old' };
    const body = { dataset: {}, innerHTML: '', textContent: '' };
    const timers = new Map();
    const requests = [];
    let timerId = 0;
    const context = vm.createContext({
        document: { getElementById: id => id === 'post-content' ? textarea : body },
        setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
        clearTimeout: id => timers.delete(id),
        fetch: (path, options) => new Promise(resolve => requests.push({ path, options, resolve }))
    });
    vm.runInContext(script, context);
    const update = () => vm.runInContext('updateLivePreview("post-content")', context);
    update();
    const first = timers.get(timerId)();
    textarea.value = 'new';
    update();
    const second = timers.get(timerId)();
    assert.equal(requests[1].path, '/api/preview');
    assert.equal(JSON.parse(requests[1].options.body).content, 'new');
    requests[1].resolve({ ok: true, json: async () => ({ html: '<p>new</p>' }) });
    await second;
    requests[0].resolve({ ok: true, json: async () => ({ html: '<p>old</p>' }) });
    await first;
    assert.equal(body.innerHTML, '<p>new</p>');
    textarea.value = '<img src=x onerror=alert(1)>';
    update();
    const failed = timers.get(timerId)();
    requests[2].resolve({ ok: false });
    await failed;
    assert.equal(body.textContent, textarea.value);
    assert.equal(body.innerHTML, '<p>new</p>', 'Failure must never insert raw source as HTML');
});
