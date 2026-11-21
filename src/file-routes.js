// HTTP routes for the file library (檔案庫). Bytes live in the R2 bucket bound as FILES under
// `files/<random id>`; metadata lives in the FileStore Durable Object.
//
//   GET    /files/:id              download / display (public files need no session)
//   GET    /api/files/config       limits, allowed types, categories and what the caller may do
//   GET    /api/files              list (?category= &kind=image &q= &limit= &cursor=)
//   POST   /api/files              upload, multipart/form-data: file, category, visibility, description
//   GET    /api/files/:id          metadata
//   PATCH  /api/files/:id          change name, description, category or visibility (JSON)
//   DELETE /api/files/:id          delete
//   GET    /api/files/audit        upload / edit / delete log (president)
import { canManageUsers } from './auth.js';
import { PayloadTooLargeError, readBytesLimited, readJsonObject } from './request.js';
import { takeAttempt, sessionUser } from './session.js';
import {
    FileError, FILE_TYPES, CATEGORIES, VISIBILITIES, MAX_FILE_BYTES, MAX_IMAGE_BYTES, MULTIPART_OVERHEAD,
    validateUpload, contentDisposition, canUploadFiles, canManageFile, visibleLevels, isImageType
} from './files.js';
import { fileStoreRequest } from './file-store.js';

const UPLOADS_PER_USER = { max: 40, windowSeconds: 600 };
const UPLOADS_PER_IP = { max: 80, windowSeconds: 600 };
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const fileUrl = id => `/files/${id}`;
const withUrl = record => ({ ...record, url: fileUrl(record.id) });

function bucket(env) {
    if (!env.FILES) throw new FileError('此網站尚未設定 FILES（R2 儲存桶），檔案庫無法使用', 503);
    return env.FILES;
}

// Headers that make a stored file harmless to open: it can only be shown, never run.
function downloadHeaders(record, { inline, isPublic, etag }) {
    const headers = new Headers({
        'Content-Type': record.mime,
        'Content-Length': String(record.size),
        'Content-Disposition': contentDisposition(inline ? 'inline' : 'attachment', record.name),
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Referrer-Policy': 'no-referrer'
    });
    if (isPublic) headers.set('Cache-Control', 'public, max-age=300');
    else { headers.set('Cache-Control', 'private, no-store'); headers.set('Cross-Origin-Resource-Policy', 'same-origin'); }
    if (etag) headers.set('ETag', etag);
    return headers;
}

async function download(request, env, id) {
    const user = await sessionUser(request, env);
    const { status, body: record } = await fileStoreRequest(env, 'get', { id });
    // A file the caller may not see is reported as missing, so its existence is not revealed.
    if (status !== 200 || !visibleLevels(user).includes(record.visibility)) {
        if (!user && status === 200) return json({ error: '請先登入' }, 401);
        return json({ error: '檔案不存在' }, 404);
    }
    const object = await bucket(env).get(`files/${record.id}`);
    if (!object) return json({ error: '檔案不存在' }, 404);
    const isPublic = record.visibility === 'public';
    const inline = isImageType(record.type) && new URL(request.url).searchParams.get('download') !== '1';
    const etag = object.httpEtag || '';
    const headers = downloadHeaders(record, { inline, isPublic, etag });
    if (isPublic && etag && request.headers.get('If-None-Match') === etag) {
        headers.delete('Content-Length');
        return new Response(null, { status: 304, headers });
    }
    return new Response(request.method === 'HEAD' ? null : object.body, { status: 200, headers });
}

async function upload(request, env, user) {
    const store = bucket(env);
    if (!canUploadFiles(user)) return json({ error: '權限不足' }, 403);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!(await takeAttempt(env, [
        { key: `file-upload:u:${user.username.slice(0, 80)}`, ...UPLOADS_PER_USER },
        { key: `file-upload:ip:${ip}`, ...UPLOADS_PER_IP }
    ]))) return json({ error: '上傳過於頻繁，請稍後再試' }, 429);

    if (!/^multipart\/form-data\s*;/i.test(request.headers.get('Content-Type') || '')) return json({ error: '請以 multipart/form-data 上傳檔案' }, 415);
    // Read at most the largest allowed file (plus form framing), then re-parse it as a form.
    const raw = await readBytesLimited(request, MAX_FILE_BYTES + MULTIPART_OVERHEAD);
    let form;
    try { form = await new Response(raw, { headers: { 'Content-Type': request.headers.get('Content-Type') } }).formData(); }
    catch { return json({ error: '上傳格式錯誤' }, 400); }
    const file = form.get('file');
    if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') return json({ error: '請選擇要上傳的檔案' }, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const checked = validateUpload({
        bytes, originalName: String(form.get('name') || file.name || ''), category: form.get('category'),
        visibility: form.get('visibility'), description: form.get('description')
    });

    const id = crypto.randomUUID();
    const record = { id, ...checked, uploadedBy: user.username };
    await store.put(`files/${id}`, bytes, {
        httpMetadata: { contentType: checked.mime },
        customMetadata: { id, uploadedBy: user.username, category: checked.category }
    });
    try {
        const result = await fileStoreRequest(env, 'create', { record });
        if (result.status !== 201) { await store.delete(`files/${id}`); return json(result.body, result.status); }
        console.log('file uploaded', { id, by: user.username, size: checked.size, type: checked.type, visibility: checked.visibility });
        return json(withUrl(result.body), 201);
    } catch (error) {
        await store.delete(`files/${id}`).catch(() => {});
        throw error;
    }
}

// Returns a Response for /files/* and /api/files*, or null for any other path.
export async function handleFileRequest(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const downloadMatch = /^\/files\/([0-9a-f-]{36})$/.exec(path);
    if (downloadMatch) {
        if (!['GET', 'HEAD'].includes(method)) return json({ error: '方法不允許' }, 405);
        return download(request, env, downloadMatch[1]);
    }
    if (path !== '/api/files' && !path.startsWith('/api/files/')) return null;

    const user = await sessionUser(request, env);
    if (!user) return json({ error: '未授權' }, 401);

    if (path === '/api/files/config' && method === 'GET') {
        return json({
            categories: CATEGORIES, visibilities: VISIBILITIES, canUpload: canUploadFiles(user),
            maxImageBytes: MAX_IMAGE_BYTES, maxFileBytes: MAX_FILE_BYTES,
            types: Object.fromEntries(Object.entries(FILE_TYPES).map(([key, spec]) => [key, { mime: spec.mime, ext: spec.ext, image: spec.image }]))
        });
    }
    if (path === '/api/files/audit' && method === 'GET') {
        if (!canManageUsers(user)) return json({ error: '權限不足' }, 403);
        return json((await fileStoreRequest(env, 'audit')).body);
    }
    if (path === '/api/files' && method === 'GET') {
        const params = url.searchParams;
        const result = await fileStoreRequest(env, 'list', {
            levels: visibleLevels(user), category: params.get('category') || '', kind: params.get('kind') === 'image' ? 'image' : params.get('kind') === 'document' ? 'document' : '',
            query: (params.get('q') || '').slice(0, 100), cursor: (params.get('cursor') || '').slice(0, 100), limit: Number(params.get('limit')) || 24
        });
        if (result.status !== 200) return json(result.body, result.status);
        return json({ ...result.body, items: result.body.items.map(item => ({ ...withUrl(item), canManage: canManageFile(user, item) })) });
    }
    if (path === '/api/files' && method === 'POST') return upload(request, env, user);

    const idMatch = /^\/api\/files\/([0-9a-f-]{36})$/.exec(path);
    if (!idMatch) return json({ error: '找不到' }, 404);
    const id = idMatch[1];
    const current = await fileStoreRequest(env, 'get', { id });
    if (current.status !== 200 || !visibleLevels(user).includes(current.body.visibility)) return json({ error: '檔案不存在' }, 404);
    const record = current.body;

    if (method === 'GET') return json({ ...withUrl(record), canManage: canManageFile(user, record) });
    if (!['PATCH', 'DELETE'].includes(method)) return json({ error: '方法不允許' }, 405);
    if (!canManageFile(user, record)) return json({ error: '只有上傳者或社長可以修改或刪除此檔案' }, 403);

    if (method === 'PATCH') {
        const fields = await readJsonObject(request);
        const result = await fileStoreRequest(env, 'update', { id, fields, by: user.username });
        return json(result.status === 200 ? withUrl(result.body) : result.body, result.status);
    }
    // Delete the bytes first: if the metadata step then fails the same delete can simply be retried.
    await bucket(env).delete(`files/${id}`);
    const result = await fileStoreRequest(env, 'delete', { id, by: user.username });
    console.log('file deleted', { id, by: user.username });
    return json(result.body, result.status);
}
