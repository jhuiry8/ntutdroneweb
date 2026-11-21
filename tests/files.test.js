import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { FileStore } from '../src/worker.js';
import { detectFileType, validateUpload, cleanFileName, contentDisposition, FileError, zipEntryNames } from '../src/files.js';
import { withSiteStore } from './helpers/site-store.js';

// ---- sample files -------------------------------------------------------------------------
const PNG = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 73, 72, 68, 82]);
const JPG = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 74, 70, 73, 70, 0, 1, 1]);
const GIF = new TextEncoder().encode('GIF89a\u0001\u0000\u0001\u0000\u0000\u0000\u0000;');
const WEBP = new TextEncoder().encode('RIFF\u0004\u0000\u0000\u0000WEBPVP8 ');
const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
const HTML = new TextEncoder().encode('<!doctype html><script>alert(1)</script>');

// A minimal stored ZIP holding the given entry names (empty files).
function zip(names) {
    const enc = new TextEncoder(), parts = [], central = [];
    let offset = 0;
    for (const name of names) {
        const n = enc.encode(name);
        const local = new Uint8Array(30 + n.length); const lv = new DataView(local.buffer);
        lv.setUint32(0, 0x04034b50, true); lv.setUint16(26, n.length, true); local.set(n, 30);
        const cen = new Uint8Array(46 + n.length); const cv = new DataView(cen.buffer);
        cv.setUint32(0, 0x02014b50, true); cv.setUint16(28, n.length, true); cv.setUint32(42, offset, true); cen.set(n, 46);
        parts.push(local); central.push(cen); offset += local.length;
    }
    const cdSize = central.reduce((sum, c) => sum + c.length, 0);
    const end = new Uint8Array(22); const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, names.length, true); ev.setUint16(10, names.length, true); ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
    return Uint8Array.from([...parts, ...central, end].flatMap(part => [...part]));
}
const DOCX = zip(['[Content_Types].xml', 'word/document.xml']);
const XLSX = zip(['[Content_Types].xml', 'xl/workbook.xml']);
const PPTX = zip(['[Content_Types].xml', 'ppt/presentation.xml']);
const ZIP = zip(['a.txt', 'b/c.txt']);

// ---- magic bytes / validation -------------------------------------------------------------
test('file types are recognised by content', () => {
    assert.equal(detectFileType(PNG), 'png');
    assert.equal(detectFileType(JPG), 'jpeg');
    assert.equal(detectFileType(GIF), 'gif');
    assert.equal(detectFileType(WEBP), 'webp');
    assert.equal(detectFileType(PDF), 'pdf');
    assert.equal(detectFileType(DOCX), 'docx');
    assert.equal(detectFileType(XLSX), 'xlsx');
    assert.equal(detectFileType(PPTX), 'pptx');
    assert.equal(detectFileType(ZIP), 'zip');
    assert.deepEqual(zipEntryNames(DOCX), ['[Content_Types].xml', 'word/document.xml']);
});

test('SVG, HTML, scripts and unknown or truncated data are not allowed types', () => {
    for (const bytes of [SVG, HTML, new TextEncoder().encode('console.log("hi");\n// js'), new Uint8Array(64), new Uint8Array([0x50, 0x4B, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8, 9])]) {
        assert.equal(detectFileType(bytes), null);
    }
});

test('the extension must agree with the content, whatever the name or Content-Type says', () => {
    const base = { category: 'article', visibility: 'cadre', description: '' };
    assert.throws(() => validateUpload({ ...base, bytes: SVG, originalName: 'logo.png' }), error => error instanceof FileError && error.status === 415);
    assert.throws(() => validateUpload({ ...base, bytes: HTML, originalName: 'x.jpg' }), FileError);
    assert.throws(() => validateUpload({ ...base, bytes: PNG, originalName: 'photo.jpg' }), /副檔名與檔案內容不符/);
    assert.throws(() => validateUpload({ ...base, bytes: PNG, originalName: 'photo' }), FileError);
    assert.throws(() => validateUpload({ ...base, bytes: new Uint8Array(0), originalName: 'a.png' }), /空/);
    for (const [bytes, name] of [[PNG, 'a.PNG'], [JPG, 'a.jpeg'], [JPG, 'a.jpg'], [PDF, 'a.pdf'], [DOCX, 'a.docx'], [ZIP, 'a.zip']]) {
        assert.doesNotThrow(() => validateUpload({ ...base, bytes, originalName: name }));
    }
    assert.throws(() => validateUpload({ ...base, bytes: DOCX, originalName: 'a.zip' }), FileError);
});

test('images are capped at 10 MB and other files at 25 MB', () => {
    const big = (head, size) => { const bytes = new Uint8Array(size); bytes.set(head); return bytes; };
    const base = { category: 'other', visibility: 'cadre', description: '' };
    assert.throws(() => validateUpload({ ...base, bytes: big(PNG, 10 * 1024 * 1024 + 1), originalName: 'a.png' }), error => error.status === 413);
    assert.doesNotThrow(() => validateUpload({ ...base, bytes: big(PNG, 10 * 1024 * 1024), originalName: 'a.png' }));
    assert.doesNotThrow(() => validateUpload({ ...base, bytes: big(PDF, 11 * 1024 * 1024), originalName: 'a.pdf' }));
    assert.throws(() => validateUpload({ ...base, bytes: big(PDF, 25 * 1024 * 1024 + 1), originalName: 'a.pdf' }), error => error.status === 413);
});

test('only images can be public, and category and visibility are whitelisted', () => {
    assert.throws(() => validateUpload({ bytes: PDF, originalName: 'a.pdf', category: 'other', visibility: 'public' }), /只有圖片/);
    assert.equal(validateUpload({ bytes: PNG, originalName: 'a.png', category: 'article', visibility: 'public' }).visibility, 'public');
    assert.throws(() => validateUpload({ bytes: PNG, originalName: 'a.png', category: 'nope', visibility: 'cadre' }), /分類/);
    assert.throws(() => validateUpload({ bytes: PNG, originalName: 'a.png', category: 'other', visibility: 'everyone' }), /可見範圍/);
    assert.equal(validateUpload({ bytes: PNG, originalName: 'a.png' }).visibility, 'cadre');
});

test('stored names lose paths, control and direction-override characters', () => {
    assert.equal(cleanFileName('../../etc/passwd.png', 'png'), '.._.._etc_passwd.png'.replace(/^\.+/, ''));
    assert.ok(!/[\\/]/.test(cleanFileName('a/b\\c.png', 'png')));
    assert.equal(cleanFileName('gpj‮.png', 'png').includes('‮'), false);
    assert.equal(cleanFileName('活動照片\n.jpg', 'jpeg'), '活動照片.jpg');
    assert.equal(cleanFileName('photo.exe', 'png'), 'photo.png');
    assert.ok(cleanFileName('a'.repeat(300) + '.png', 'png').length <= 120);
});

test('Content-Disposition encodes names safely', () => {
    const value = contentDisposition('attachment', '會議"紀錄";x.pdf');
    assert.match(value, /^attachment; filename="[\x20-\x7E]*"; filename\*=UTF-8''/);
    assert.ok(!/\r|\n/.test(value));
    assert.ok(value.includes('%E6%9C%83'));
    assert.equal(value.split('filename="')[1].split('"; ')[0].includes('"'), false);
});

// ---- routes -------------------------------------------------------------------------------
function durableObject(Class) {
    const values = new Map();
    let tail = Promise.resolve();
    const storage = {
        async get(key) { return structuredClone(values.get(key)); },
        async put(key, value) { values.set(key, structuredClone(value)); },
        async delete(keys) { for (const key of [].concat(keys)) values.delete(key); },
        async list({ prefix = '', limit = Infinity } = {}) {
            return new Map([...values.entries()].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1)).slice(0, limit));
        },
        transaction(callback) { const result = tail.then(() => callback(storage)); tail = result.catch(() => {}); return result; }
    };
    const object = new Class({ storage });
    return { idFromName: name => name, get: () => ({ fetch: (input, init) => object.fetch(input instanceof Request ? input : new Request(input, init)) }), values };
}

function mockBucket() {
    const objects = new Map();
    return {
        objects,
        async put(key, bytes, options) { objects.set(key, { bytes: new Uint8Array(bytes), options }); },
        async get(key) {
            const entry = objects.get(key);
            return entry ? { body: new Response(entry.bytes).body, httpEtag: `"${key.length}-${entry.bytes.length}"`, size: entry.bytes.length } : null;
        },
        async delete(key) { objects.delete(key); }
    };
}

function fixture() {
    const store = new Map();
    const db = {
        async get(key) { return store.get(key) ?? null; },
        async put(key, value) { store.set(key, typeof value === 'string' ? value : JSON.stringify(value)); },
        async delete(key) { store.delete(key); },
        async list({ prefix }) { return { keys: [...store.keys()].filter(name => name.startsWith(prefix)).map(name => ({ name })) }; }
    };
    for (const [username, role] of Object.entries({ president: 'president', cadre1: 'cadre', cadre2: 'cadre', treasurer: 'finance', alice: 'member' })) {
        store.set(`user:${username}`, JSON.stringify({ username, role, active: true, version: 'v1' }));
        store.set(`session:${username}`, JSON.stringify({ username, version: 'v1' }));
    }
    const files = mockBucket();
    const env = withSiteStore({ DRONE_DB: db, FILES: files, FILE_STORE: durableObject(FileStore) });
    const call = (path, who, init = {}) => worker.fetch(new Request(`https://example.com${path}`, { ...init, headers: { ...(who ? { Cookie: `session=${who}` } : {}), ...(init.headers || {}) } }), env);
    const api = async (path, who, method = 'GET', body) => {
        const response = await call(path, who, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
        return { status: response.status, body: await response.json() };
    };
    const upload = async (who, bytes, name, fields = {}) => {
        const form = new FormData();
        form.set('file', new File([bytes], name));
        for (const [key, value] of Object.entries(fields)) form.set(key, value);
        const response = await call('/api/files', who, { method: 'POST', body: form });
        return { status: response.status, body: await response.json() };
    };
    return { call, api, upload, files, env };
}

test('uploading needs president, cadre or finance', async () => {
    const { upload } = fixture();
    assert.equal((await upload(undefined, PNG, 'a.png')).status, 401);
    assert.equal((await upload('alice', PNG, 'a.png')).status, 403);
    for (const who of ['president', 'cadre1', 'treasurer']) assert.equal((await upload(who, PNG, 'a.png')).status, 201);
});

test('upload stores bytes under a random key, never the original name, and records who uploaded', async () => {
    const { upload, files } = fixture();
    const { status, body } = await upload('cadre1', PNG, '../../秘密 照片.png', { category: 'photo', visibility: 'member', description: '春季飛行' });
    assert.equal(status, 201);
    assert.match(body.id, /^[0-9a-f-]{36}$/);
    assert.equal(body.url, `/files/${body.id}`);
    assert.deepEqual([...files.objects.keys()], [`files/${body.id}`]);
    assert.equal(files.objects.get(`files/${body.id}`).options.httpMetadata.contentType, 'image/png');
    assert.equal(body.uploadedBy, 'cadre1');
    assert.equal(body.mime, 'image/png');
    assert.equal(body.size, PNG.length);
    assert.equal(body.category, 'photo');
    assert.ok(!body.name.includes('/') && body.name.endsWith('.png'));
    assert.ok(body.createdAt);
});

test('rejected uploads leave nothing in the bucket', async () => {
    const { upload, files } = fixture();
    assert.equal((await upload('president', SVG, 'logo.svg')).status, 415);
    assert.equal((await upload('president', SVG, 'logo.png')).status, 415);
    assert.equal((await upload('president', HTML, 'x.html')).status, 415);
    assert.equal((await upload('president', PNG, 'x.jpg')).status, 415);
    assert.equal((await upload('president', PDF, 'x.pdf', { visibility: 'public' })).status, 400);
    assert.equal((await upload('president', PNG, 'x.png', { category: 'bogus' })).status, 400);
    assert.equal(files.objects.size, 0);
});

test('oversized request bodies are refused before parsing', async () => {
    const { call, files } = fixture();
    const form = new FormData();
    form.set('file', new File([new Uint8Array(26 * 1024 * 1024)], 'big.pdf'));
    const response = await call('/api/files', 'president', { method: 'POST', body: form });
    assert.equal(response.status, 413);
    assert.equal(files.objects.size, 0);
    const notMultipart = await call('/api/files', 'president', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(notMultipart.status, 415);
});

test('uploads are rate limited per account', async () => {
    const { upload } = fixture();
    let last;
    for (let i = 0; i < 41; i++) last = await upload('cadre1', SVG, 'x.svg');
    assert.equal(last.status, 429);
    assert.equal((await upload('cadre2', PNG, 'a.png')).status, 201);
});

test('downloads are served inert: nosniff, real type, sandbox CSP, attachment for non-images', async () => {
    const { upload, call } = fixture();
    const png = (await upload('president', PNG, 'a.png', { visibility: 'public', category: 'article' })).body;
    const pdf = (await upload('president', PDF, '會議紀錄.pdf', { visibility: 'member', category: 'meeting' })).body;
    const image = await call(png.url);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('Content-Type'), 'image/png');
    assert.equal(image.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(image.headers.get('Content-Security-Policy'), "default-src 'none'; sandbox");
    assert.match(image.headers.get('Content-Disposition'), /^inline;/);
    assert.match(image.headers.get('Cache-Control'), /public/);
    assert.deepEqual(new Uint8Array(await image.arrayBuffer()), PNG);
    assert.match((await call(`${png.url}?download=1`)).headers.get('Content-Disposition'), /^attachment;/);

    const doc = await call(pdf.url, 'alice');
    assert.equal(doc.status, 200);
    assert.equal(doc.headers.get('Content-Type'), 'application/pdf');
    assert.match(doc.headers.get('Content-Disposition'), /^attachment; filename=".*"; filename\*=UTF-8''%E6%9C%83%E8%AD%B0/);
    assert.equal(doc.headers.get('Content-Security-Policy'), "default-src 'none'; sandbox");
    assert.match(doc.headers.get('Cache-Control'), /no-store/);
});

test('public images are readable anonymously and revalidate with ETag', async () => {
    const { upload, call } = fixture();
    const png = (await upload('president', PNG, 'a.png', { visibility: 'public' })).body;
    const first = await call(png.url);
    const etag = first.headers.get('ETag');
    assert.ok(etag);
    assert.equal((await call(png.url, undefined, { headers: { 'If-None-Match': etag } })).status, 304);
});

test('non-public files check the session on every download', async () => {
    const { upload, call, api } = fixture();
    const member = (await upload('president', PNG, 'm.png', { visibility: 'member' })).body;
    const cadre = (await upload('president', PNG, 'c.png', { visibility: 'cadre' })).body;
    assert.equal((await call(member.url)).status, 401);
    assert.equal((await call(cadre.url)).status, 401);
    assert.equal((await call(member.url, 'alice')).status, 200);
    assert.equal((await call(cadre.url, 'alice')).status, 404);
    assert.equal((await call(cadre.url, 'treasurer')).status, 200);
    assert.equal((await api(`/api/files/${cadre.id}`, 'alice')).status, 404);
    // A signed-out session (e.g. logged out or disabled account) loses access immediately.
    assert.equal((await call(member.url, 'ghost')).status, 401);
});

test('listing is filtered by what the viewer may see, with categories and paging', async () => {
    const { upload, api } = fixture();
    await upload('president', PNG, 'p.png', { visibility: 'public', category: 'article' });
    await upload('president', PNG, 'm.png', { visibility: 'member', category: 'photo' });
    await upload('president', PDF, 'c.pdf', { visibility: 'cadre', category: 'meeting', description: '三月會議' });
    assert.equal((await api('/api/files')).status, 401);
    assert.equal((await api('/api/files', 'alice')).body.items.length, 2);
    const all = (await api('/api/files', 'cadre1')).body;
    assert.equal(all.items.length, 3);
    // Newest first; uploads in the same millisecond share a timestamp and are ordered by id instead.
    const times = all.items.map(item => item.createdAt);
    assert.deepEqual(times, [...times].sort().reverse());
    assert.deepEqual(all.items.map(item => item.name).sort(), ['c.pdf', 'm.png', 'p.png']);
    assert.deepEqual((await api('/api/files?category=photo', 'cadre1')).body.items.map(item => item.name), ['m.png']);
    assert.deepEqual((await api('/api/files?kind=document', 'cadre1')).body.items.map(item => item.name), ['c.pdf']);
    assert.deepEqual((await api('/api/files?q=%E4%B8%89%E6%9C%88', 'cadre1')).body.items.map(item => item.name), ['c.pdf']);
    const page1 = (await api('/api/files?limit=2', 'cadre1')).body;
    assert.equal(page1.items.length, 2);
    assert.ok(page1.nextCursor);
    const page2 = (await api(`/api/files?limit=2&cursor=${encodeURIComponent(page1.nextCursor)}`, 'cadre1')).body;
    assert.equal(page2.items.length, 1);
    assert.equal(page2.nextCursor, null);
    assert.deepEqual([...page1.items, ...page2.items].map(item => item.id), all.items.map(item => item.id));
});

test('only the uploader or the president can edit or delete; both are logged', async () => {
    const { upload, api, call, files } = fixture();
    const file = (await upload('cadre1', PNG, 'a.png', { visibility: 'member' })).body;
    assert.equal((await api(`/api/files/${file.id}`, 'cadre2', 'PATCH', { description: 'x' })).status, 403);
    assert.equal((await api(`/api/files/${file.id}`, 'cadre2', 'DELETE')).status, 403);
    assert.equal((await api(`/api/files/${file.id}`, 'alice', 'DELETE')).status, 403);
    const renamed = await api(`/api/files/${file.id}`, 'cadre1', 'PATCH', { name: '新名稱', description: '說明', category: 'photo', visibility: 'cadre' });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.name, '新名稱.png');
    assert.equal(renamed.body.visibility, 'cadre');
    assert.equal((await api(`/api/files/${file.id}`, 'cadre1', 'PATCH', { visibility: 'bogus' })).status, 400);
    assert.equal((await api(`/api/files/${file.id}`, 'president', 'PATCH', { description: 'ok' })).status, 200);
    assert.equal((await api(`/api/files/${file.id}`, 'cadre1', 'DELETE')).status, 200);
    assert.equal(files.objects.size, 0);
    assert.equal((await call(file.url, 'president')).status, 404);
    assert.equal((await api(`/api/files/${file.id}`, 'cadre1', 'DELETE')).status, 404);
    assert.equal((await api('/api/files/audit', 'cadre1')).status, 403);
    const audit = (await api('/api/files/audit', 'president')).body;
    assert.deepEqual(audit.map(entry => `${entry.action}:${entry.by}`), ['delete:cadre1', 'update:president', 'update:cadre1', 'upload:cadre1']);
});

test('a PDF can never be made public by editing', async () => {
    const { upload, api } = fixture();
    const pdf = (await upload('president', PDF, 'a.pdf')).body;
    assert.equal((await api(`/api/files/${pdf.id}`, 'president', 'PATCH', { visibility: 'public' })).status, 400);
});

test('concurrent uploads all keep their metadata', async () => {
    const { upload, api } = fixture();
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => upload(['president', 'cadre1', 'cadre2', 'treasurer'][i % 4], PNG, `f${i}.png`)));
    assert.ok(results.every(result => result.status === 201));
    assert.equal((await api('/api/files?limit=100', 'president')).body.items.length, 8);
});

test('the file library reports a missing bucket binding instead of crashing', async () => {
    const { upload, env } = fixture();
    delete env.FILES;
    const result = await upload('president', PNG, 'a.png');
    assert.equal(result.status, 503);
});

test('config lists the limits and what the caller may do', async () => {
    const { api } = fixture();
    const config = (await api('/api/files/config', 'alice')).body;
    assert.equal(config.canUpload, false);
    assert.equal(config.maxImageBytes, 10 * 1024 * 1024);
    assert.ok(config.types.png && !config.types.svg);
    assert.equal((await api('/api/files/config', 'cadre1')).body.canUpload, true);
});

test('published Markdown image links survive the article sanitizer', async () => {
    const { sanitizeContent } = await import('../src/html.js');
    const { marked } = await import('marked');
    assert.match(sanitizeContent(marked.parse('![飛行](/files/0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f)')), /<img src="\/files\/0f0f/);
});

test('the dashboard shows the file library, with upload controls only for uploaders', async () => {
    const { renderAdminDashboard } = await import('../src/templates.js');
    const officer = renderAdminDashboard([], [], { username: 'c', role: 'cadre' });
    const member = renderAdminDashboard([], [], { username: 'm', role: 'member' });
    assert.match(officer, /id="panel-files"[^>]*data-can-upload="1"/);
    assert.match(officer, /id="files-drop"/);
    assert.match(officer, /admin-files\.js/);
    assert.match(member, /id="panel-files"[^>]*data-can-upload=""/);
    assert.doesNotMatch(member, /id="files-drop"/);
});
