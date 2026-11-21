import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import worker, { FileStore } from '../src/worker.js';
import { parseDriveUrl, parseFolderInput, validateDriveLink } from '../src/files.js';
import { driveEnabled, resetDriveCache, TOKEN_URL, DRIVE_SCOPE } from '../src/drive.js';
import { withSiteStore } from './helpers/site-store.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
const SECRET = JSON.stringify({ type: 'service_account', client_email: 'club@proj.iam.gserviceaccount.com', private_key: PEM, token_uri: 'https://evil.example/token' });
const ID = (name) => name.padEnd(12, '0');
const ROOT = ID('ROOTFOLDER'), SUB = ID('SUBFOLDER'), PDF = ID('FILEPDF'), IMG = ID('FILEIMG'), OUT_FOLDER = ID('OTHERROOT'), OUT_FILE = ID('OUTSIDE');

function durableObject(Class) {
    const values = new Map();
    let tail = Promise.resolve();
    const storage = {
        async get(key) { return structuredClone(values.get(key)); },
        async put(key, value) { values.set(key, structuredClone(value)); },
        async delete(keys) { for (const key of [].concat(keys)) values.delete(key); },
        async list({ prefix = '', limit = Infinity } = {}) { return new Map([...values.entries()].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1)).slice(0, limit)); },
        transaction(callback) { const result = tail.then(() => callback(storage)); tail = result.catch(() => {}); return result; }
    };
    const object = new Class({ storage });
    return { idFromName: name => name, get: () => ({ fetch: (input, init) => object.fetch(input instanceof Request ? input : new Request(input, init)) }) };
}

function fixture({ secret = SECRET } = {}) {
    const store = new Map();
    const db = { async get(k) { return store.get(k) ?? null; }, async put(k, v) { store.set(k, v); }, async delete(k) { store.delete(k); }, async list({ prefix }) { return { keys: [...store.keys()].filter(n => n.startsWith(prefix)).map(name => ({ name })) }; } };
    for (const [username, role] of Object.entries({ president: 'president', cadre1: 'cadre', alice: 'member' })) {
        store.set(`user:${username}`, JSON.stringify({ username, role, active: true, version: 'v1' }));
        store.set(`session:${username}`, JSON.stringify({ username, version: 'v1' }));
    }
    const env = withSiteStore({ DRONE_DB: db, FILE_STORE: durableObject(FileStore) });
    if (secret) env.GOOGLE_SERVICE_ACCOUNT_JSON = secret;
    const call = (path, who, init = {}) => worker.fetch(new Request(`https://example.com${path}`, { ...init, headers: { ...(who ? { Cookie: `session=${who}` } : {}), ...(init.headers || {}) } }), env);
    const api = async (path, who, method = 'GET', body) => {
        const response = await call(path, who, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
        return { status: response.status, body: await response.json() };
    };
    return { api, call, env };
}

// A fake Google: token endpoint (verifies the JWT really is signed by the key) and Drive v3.
function fakeGoogle() {
    const files = new Map([
        [ROOT, { id: ROOT, name: '社團資料', mimeType: 'application/vnd.google-apps.folder', parents: [] }],
        [SUB, { id: SUB, name: '活動照片', mimeType: 'application/vnd.google-apps.folder', parents: [ROOT] }],
        [PDF, { id: PDF, name: '預算.pdf', mimeType: 'application/pdf', parents: [ROOT], size: '2048', modifiedTime: '2026-03-01T00:00:00Z' }],
        [IMG, { id: IMG, name: '合照.jpg', mimeType: 'image/jpeg', parents: [SUB], thumbnailLink: 'https://lh3.googleusercontent.com/abc=s220' }],
        [OUT_FOLDER, { id: OUT_FOLDER, name: '別人的', mimeType: 'application/vnd.google-apps.folder', parents: [] }],
        [OUT_FILE, { id: OUT_FILE, name: 'secret.pdf', mimeType: 'application/pdf', parents: [OUT_FOLDER], thumbnailLink: 'https://lh3.googleusercontent.com/zzz=s220' }]
    ]);
    const log = { tokens: [], drive: [], thumbs: [] };
    const original = globalThis.fetch;
    globalThis.fetch = async (input, init = {}) => {
        const url = new URL(typeof input === 'string' ? input : input.url);
        if (url.href === TOKEN_URL) {
            const params = new URLSearchParams(init.body);
            assert.equal(params.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
            const [header, claims, signature] = params.get('assertion').split('.');
            const verify = createVerify('RSA-SHA256').update(`${header}.${claims}`);
            assert.ok(verify.verify(publicKey, Buffer.from(signature, 'base64url')), 'JWT signature must verify');
            const payload = JSON.parse(Buffer.from(claims, 'base64url').toString());
            assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), { alg: 'RS256', typ: 'JWT' });
            assert.equal(payload.iss, 'club@proj.iam.gserviceaccount.com');
            assert.equal(payload.scope, DRIVE_SCOPE);
            assert.equal(payload.aud, TOKEN_URL);
            assert.equal(payload.exp - payload.iat, 3600);
            log.tokens.push(payload);
            return Response.json({ access_token: `tok-${log.tokens.length}`, expires_in: 3600 });
        }
        assert.match(init.headers.Authorization, /^Bearer tok-/);
        if (url.hostname === 'lh3.googleusercontent.com') { log.thumbs.push(url.href); return new Response(new Uint8Array([0xFF, 0xD8, 0xFF]), { headers: { 'Content-Type': 'image/jpeg' } }); }
        assert.equal(url.origin, 'https://www.googleapis.com');
        log.drive.push(url.pathname + url.search);
        const single = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
        if (single) { const file = files.get(single[1]); return file ? Response.json(file) : new Response('{}', { status: 404 }); }
        const parent = /'([^']+)' in parents/.exec(url.searchParams.get('q'))[1];
        return Response.json({ files: [...files.values()].filter(f => f.parents.includes(parent)) });
    };
    return { files, log, restore: () => { globalThis.fetch = original; resetDriveCache(); } };
}

// ---- Drive links ---------------------------------------------------------------------------
test('only drive.google.com and docs.google.com links with a well-formed id are accepted', () => {
    const id = '1AbCdEfGhIjK_-lmn';
    assert.equal(parseDriveUrl(`https://drive.google.com/file/d/${id}/view?usp=sharing`).embedUrl, `https://drive.google.com/file/d/${id}/preview`);
    assert.equal(parseDriveUrl(`https://drive.google.com/open?id=${id}`).id, id);
    assert.equal(parseDriveUrl(`https://drive.google.com/drive/u/2/folders/${id}`).kind, 'folder');
    assert.equal(parseDriveUrl(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`).embedUrl, `https://docs.google.com/spreadsheets/d/${id}/preview`);
    assert.equal(parseDriveUrl(`https://docs.google.com/forms/d/${id}/edit`).embedUrl, null);
    for (const bad of [
        `https://drive.google.com.evil.com/file/d/${id}/view`, `https://evil.com/drive.google.com/file/d/${id}`, `http://drive.google.com/file/d/${id}/view`,
        `https://user:pw@drive.google.com/file/d/${id}/view`, `https://drive.google.com:8443/file/d/${id}/view`, `https://drive.google.com/file/d/short/view`,
        `https://drive.google.com/file/d/${id}%22onload/view`, `https://lh3.googleusercontent.com/d/${id}`, `javascript:alert(1)`, 'not a url', '',
        `https://docs.google.com/document/${id}/edit`, `https://drive.google.com/file/d/..%2F..%2Fx/view`
    ]) assert.equal(parseDriveUrl(bad), null, bad);
    assert.equal(parseFolderInput(ROOT), ROOT);
    assert.equal(parseFolderInput(`https://drive.google.com/file/d/${id}/view`), null);
});

test('stored Drive links are rebuilt from the id and are never public', () => {
    const id = '1AbCdEfGhIjKlmn';
    const link = validateDriveLink({ url: `https://drive.google.com/file/d/${id}/view?resourcekey=x&evil=1`, name: ' 春季 \n 活動 ', category: 'photo', visibility: 'member' });
    assert.equal(link.viewUrl, `https://drive.google.com/file/d/${id}/view`);
    assert.equal(link.name, '春季 活動');
    assert.throws(() => validateDriveLink({ url: `https://drive.google.com/file/d/${id}/view`, name: 'x', visibility: 'public' }), /可見範圍/);
    assert.throws(() => validateDriveLink({ url: 'https://example.com/a', name: 'x' }), /drive\.google\.com/);
    assert.throws(() => validateDriveLink({ url: `https://drive.google.com/file/d/${id}/view`, name: '  ' }), /標題/);
});

test('Drive link items are created, listed, edited and deleted like files, without touching R2', async () => {
    const { api, call } = fixture({ secret: '' });
    const url = 'https://drive.google.com/file/d/1AbCdEfGhIjKlmn/view';
    assert.equal((await api('/api/files/links', undefined, 'POST', { url, name: 'x' })).status, 401);
    assert.equal((await api('/api/files/links', 'alice', 'POST', { url, name: 'x' })).status, 403);
    assert.equal((await api('/api/files/links', 'cadre1', 'POST', { url: 'https://evil.com/x', name: 'x' })).status, 400);
    const created = await api('/api/files/links', 'cadre1', 'POST', { url, name: '預算表', category: 'document', visibility: 'member' });
    assert.equal(created.status, 201);
    assert.equal(created.body.url, url);
    assert.equal(created.body.embedUrl, 'https://drive.google.com/file/d/1AbCdEfGhIjKlmn/preview');
    assert.equal(created.body.uploadedBy, 'cadre1');
    assert.equal((await api('/api/files', 'alice')).body.items[0].name, '預算表');
    // A link card is neither a document nor an image (it has no file to download); it has its own kind.
    assert.deepEqual((await api('/api/files?kind=document', 'alice')).body.items, []);
    assert.deepEqual((await api('/api/files?kind=image', 'alice')).body.items, []);
    assert.deepEqual((await api('/api/files?kind=drive', 'alice')).body.items.map(item => item.name), ['預算表']);
    assert.equal((await call(`/files/${created.body.id}`, 'alice')).status, 404);
    assert.equal((await api(`/api/files/${created.body.id}`, 'cadre1', 'PATCH', { name: '新標題', visibility: 'cadre' })).body.name, '新標題');
    assert.equal((await api(`/api/files/${created.body.id}`, 'cadre1', 'PATCH', { visibility: 'public' })).status, 400);
    assert.equal((await api(`/api/files/${created.body.id}`, 'cadre1', 'DELETE')).status, 200);
});

test('the site CSP lets the file library frame Drive and Docs previews, and nothing else new', async () => {
    const { call } = fixture();
    const csp = (await call('/')).headers.get('Content-Security-Policy');
    assert.match(csp, /frame-src https:\/\/challenges\.cloudflare\.com https:\/\/drive\.google\.com https:\/\/docs\.google\.com;/);
    assert.match(csp, /img-src 'self' https: data:/);
});

// ---- cursor paging -------------------------------------------------------------------------
test('a list cursor still works after its record was deleted or became hidden', async () => {
    const { api, env } = fixture({ secret: '' });
    const link = n => api('/api/files/links', 'president', 'POST', { url: `https://drive.google.com/file/d/${String(n).padStart(2, '0')}AbCdEfGhIjKlmn/view`, name: `項目${n}`, visibility: 'member' });
    const ids = [];
    for (let n = 1; n <= 5; n++) { ids.push((await link(n)).body.id); await new Promise(resolve => setTimeout(resolve, 3)); }
    const page1 = (await api('/api/files?limit=2', 'alice')).body;
    assert.deepEqual(page1.items.map(item => item.name), ['項目5', '項目4']);
    await api(`/api/files/${ids[3]}`, 'president', 'DELETE');            // the cursor's own record is gone
    const page2 = (await api(`/api/files?limit=2&cursor=${encodeURIComponent(page1.nextCursor)}`, 'alice')).body;
    assert.deepEqual(page2.items.map(item => item.name), ['項目3', '項目2']);
    await api(`/api/files/${ids[1]}`, 'president', 'PATCH', { visibility: 'cadre' }); // hidden from this viewer
    const page3 = (await api(`/api/files?limit=2&cursor=${encodeURIComponent(page2.nextCursor)}`, 'alice')).body;
    assert.deepEqual(page3.items.map(item => item.name), ['項目1']);
    assert.equal((await api('/api/files?cursor=garbage', 'alice')).status, 400);
    assert.ok(env);
});

// ---- service-account Drive browsing --------------------------------------------------------
test('without the secret the Drive tab is off and nothing fails', async () => {
    const { api } = fixture({ secret: '' });
    assert.equal(driveEnabled({}), false);
    assert.equal(driveEnabled({ GOOGLE_SERVICE_ACCOUNT_JSON: 'not json' }), false);
    assert.equal(driveEnabled({ GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'a@b.c' }) }), false);
    assert.deepEqual((await api('/api/drive/status', 'president')).body, { enabled: false, canConfigure: false });
    assert.equal((await api('/api/drive/status')).status, 401);
    assert.equal((await api('/api/drive/folders', 'president')).status, 404);
    assert.equal((await api(`/api/drive/list?root=${ROOT}`, 'president')).status, 404);
});

test('only the president configures folders, and ids are validated', async () => {
    const google = fakeGoogle();
    try {
        const { api } = fixture();
        assert.deepEqual((await api('/api/drive/status', 'president')).body, { enabled: true, canConfigure: true });
        assert.equal((await api('/api/drive/status', 'cadre1')).body.canConfigure, false);
        const body = { folders: [{ id: `https://drive.google.com/drive/folders/${ROOT}?usp=sharing`, name: '社團資料', visibility: 'member' }] };
        assert.equal((await api('/api/drive/folders', 'cadre1', 'PUT', body)).status, 403);
        for (const bad of [
            [{ id: 'x', name: 'a', visibility: 'member' }], [{ id: "abc'def'ghijklm", name: 'a', visibility: 'member' }],
            [{ id: ROOT, name: '', visibility: 'member' }], [{ id: ROOT, name: 'a', visibility: 'nope' }], [{ id: ROOT, name: 'a' }, { id: ROOT, name: 'b' }],
            [{ id: 'https://drive.google.com/file/d/1AbCdEfGhIjKlmn/view', name: 'a', visibility: 'member' }]
        ]) assert.equal((await api('/api/drive/folders', 'president', 'PUT', { folders: bad })).status, 400, JSON.stringify(bad));
        assert.equal((await api('/api/drive/folders', 'president', 'PUT', { folders: Array.from({ length: 21 }, (_, i) => ({ id: `FOLDER${String(i).padStart(6, '0')}`, name: 'n' })) })).status, 400);
        const saved = await api('/api/drive/folders', 'president', 'PUT', body);
        assert.equal(saved.status, 200);
        assert.deepEqual(saved.body, [{ id: ROOT, name: '社團資料', visibility: 'member' }]);
        assert.equal(google.log.drive.length, 0, 'configuring never calls Google');
    } finally { google.restore(); }
});

test('browsing signs a JWT once, caches the token and the folder listing, and respects visibility', async () => {
    const google = fakeGoogle();
    try {
        const { api } = fixture();
        await api('/api/drive/folders', 'president', 'PUT', { folders: [{ id: ROOT, name: '社團資料', visibility: 'member' }, { id: OUT_FOLDER, name: '幹部資料', visibility: 'cadre' }] });
        assert.deepEqual((await api('/api/drive/folders', 'alice')).body.map(f => f.name), ['社團資料']);
        assert.equal((await api('/api/drive/folders', 'cadre1')).body.length, 2);
        assert.equal((await api(`/api/drive/list?root=${ROOT}`)).status, 401);

        const listing = await api(`/api/drive/list?root=${ROOT}`, 'alice');
        assert.equal(listing.status, 200);
        assert.deepEqual(listing.body.items.map(i => i.name), ['活動照片', '預算.pdf']);
        const pdf = listing.body.items.find(i => i.id === PDF);
        assert.equal(pdf.previewUrl, `https://drive.google.com/file/d/${PDF}/preview`);
        assert.equal(pdf.openUrl, `https://drive.google.com/file/d/${PDF}/view`);
        assert.equal(JSON.stringify(listing.body).includes('googleusercontent'), false, 'Google thumbnail links are not exposed');

        await api(`/api/drive/list?root=${ROOT}`, 'alice');
        const sub = await api(`/api/drive/list?root=${ROOT}&folder=${SUB}`, 'alice');
        assert.deepEqual(sub.body.items.map(i => [i.name, i.hasThumb]), [['合照.jpg', true]]);
        assert.equal(google.log.tokens.length, 1, 'one token for all calls');
        assert.equal(google.log.drive.filter(entry => entry.includes('in+parents') && entry.includes(ROOT)).length, 1, 'repeat listing came from the cache');

        // Not configured / not visible / outside the configured root: all look like "not found".
        assert.equal((await api(`/api/drive/list?root=${OUT_FOLDER}`, 'alice')).status, 404);
        assert.equal((await api(`/api/drive/list?root=${ID('NOTCONFIG')}`, 'alice')).status, 404);
        assert.equal((await api(`/api/drive/list?root=${ROOT}&folder=${OUT_FOLDER}`, 'alice')).status, 404);
        assert.equal((await api(`/api/drive/list?root=${ROOT}&folder=bad'id`, 'alice')).status, 400);
        assert.equal((await api(`/api/drive/list?root=${OUT_FOLDER}`, 'cadre1')).status, 200);
    } finally { google.restore(); }
});

test('thumbnails are proxied only for files below a configured, visible root', async () => {
    const google = fakeGoogle();
    try {
        const { api, call } = fixture();
        await api('/api/drive/folders', 'president', 'PUT', { folders: [{ id: ROOT, name: 'r', visibility: 'member' }] });
        assert.equal((await call(`/api/drive/thumb?root=${ROOT}&file=${IMG}`)).status, 401);
        const ok = await call(`/api/drive/thumb?root=${ROOT}&file=${IMG}`, 'alice');
        assert.equal(ok.status, 200);
        assert.equal(ok.headers.get('Content-Type'), 'image/jpeg');
        assert.equal(ok.headers.get('X-Content-Type-Options'), 'nosniff');
        assert.match(ok.headers.get('Cache-Control'), /private/);
        assert.deepEqual(google.log.thumbs, ['https://lh3.googleusercontent.com/abc=s320']);
        assert.equal((await call(`/api/drive/thumb?root=${ROOT}&file=${OUT_FILE}`, 'alice')).status, 404);
        assert.equal((await call(`/api/drive/thumb?root=${ROOT}&file=${PDF}`, 'alice')).status, 404, 'no thumbnail link');
    } finally { google.restore(); }
});

test('Google failures become a clean 502 without leaking details', async () => {
    const original = globalThis.fetch;
    try {
        globalThis.fetch = async () => Response.json({ error: 'invalid_grant', error_description: 'secret detail' }, { status: 400 });
        resetDriveCache();
        const { api } = fixture();
        await api('/api/drive/folders', 'president', 'PUT', { folders: [{ id: ROOT, name: 'r', visibility: 'member' }] });
        const result = await api(`/api/drive/list?root=${ROOT}`, 'alice');
        assert.equal(result.status, 502);
        assert.ok(!JSON.stringify(result.body).includes('secret detail'));
    } finally { globalThis.fetch = original; resetDriveCache(); }
});

test('the dashboard carries the Drive tab, hidden until the server says the feature is on', async () => {
    const { renderAdminDashboard } = await import('../src/templates.js');
    const { readFileSync } = await import('node:fs');
    const html = renderAdminDashboard([], [], { username: 'c', role: 'cadre' });
    assert.match(html, /data-files-tab="drive"[^>]*hidden/);
    assert.match(html, /id="files-link-form"/);
    const script = readFileSync('public/admin-files.js', 'utf8');
    assert.match(script, /\/api\/drive\/status/);
    assert.ok(!/<img[^>]*thumbnailLink|googleusercontent/.test(script), 'Drive image URLs are never used as <img> sources');
});
