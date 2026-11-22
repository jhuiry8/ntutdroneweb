// FileStore Durable Object: the metadata of every file in the R2 bucket (名稱、類型、大小、
// 上傳者、時間、分類、可見範圍) plus a short audit trail. Each file is its own storage key and
// every change runs in one transaction, so concurrent uploads and edits cannot overwrite each other.
// The bytes live in R2 under `files/<id>`; this object never sees them.
import { FileError, MAX_FILES, cleanCategory, cleanDescription, cleanFileName, cleanLinkVisibility, cleanTitle, cleanVisibility, isDriveLink, isImageType } from './files.js';
import { isExportRequest, exportStorage } from './do-export.js';

const FILE_PREFIX = 'file:';
const AUDIT_PREFIX = 'audit:';
const AUDIT_KEEP = 500;
const AUDIT_SEQ_KEY = 'meta:audit-seq';
const DRIVE_FOLDERS_KEY = 'config:drive-folders';

export async function fileStoreRequest(env, op, payload = {}) {
    if (!env.FILE_STORE) throw new FileError('此網站尚未設定 FILE_STORE，檔案庫無法使用', 503);
    const stub = env.FILE_STORE.get(env.FILE_STORE.idFromName('club-files'));
    const response = await stub.fetch(`https://file-store/${op}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await response.json();
    if (response.status >= 500) throw new Error(body?.error || 'File store failed');
    return { status: response.status, body };
}

const newestFirst = (a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1);

// image / document for uploaded files, drive for Google Drive link cards (they have no file to download).
const kindOf = record => (record.type === 'drive' ? 'drive' : isImageType(record.type) ? 'image' : 'document');

export class FileStore {
    constructor(ctx) { this.storage = ctx.storage; }

    // Entries are keyed by a running sequence number, so their order never depends on the clock.
    async audit(storage, action, record, by) {
        const at = new Date().toISOString();
        const seq = ((await storage.get(AUDIT_SEQ_KEY)) || 0) + 1;
        await storage.put(AUDIT_SEQ_KEY, seq);
        await storage.put(`${AUDIT_PREFIX}${String(seq).padStart(12, '0')}`, { action, id: record.id, name: record.name, size: record.size, visibility: record.visibility, by, at });
        const keys = [...(await storage.list({ prefix: AUDIT_PREFIX })).keys()];
        if (keys.length > AUDIT_KEEP) await storage.delete(keys.slice(0, keys.length - AUDIT_KEEP));
    }

    async fetch(request) {
        try {
            if (isExportRequest(request)) return await exportStorage(this.storage);
            if (request.method !== 'POST') return Response.json({ error: '方法不允許' }, { status: 405 });
            const op = new URL(request.url).pathname.replace(/^\//, '');
            const payload = await request.json();
            const result = await this.storage.transaction(storage => this.run(storage, op, payload));
            return Response.json(result.body, { status: result.status });
        } catch (error) {
            if (error instanceof FileError) return Response.json({ error: error.message }, { status: error.status });
            console.error('File store operation failed', error?.message || String(error));
            return Response.json({ error: '檔案資料操作失敗' }, { status: 500 });
        }
    }

    async run(storage, op, payload) {
        const id = String(payload.id || '');
        if (['get', 'update', 'delete'].includes(op) && !/^[0-9a-f-]{36}$/.test(id)) return { status: 404, body: { error: '檔案不存在' } };

        if (op === 'create') {
            const count = (await storage.list({ prefix: FILE_PREFIX, limit: MAX_FILES + 1 })).size;
            if (count >= MAX_FILES) return { status: 409, body: { error: `檔案庫上限為 ${MAX_FILES} 個檔案` } };
            const record = { ...payload.record, createdAt: new Date().toISOString() };
            record.updatedAt = record.createdAt;
            await storage.put(FILE_PREFIX + record.id, record);
            await this.audit(storage, 'upload', record, record.uploadedBy);
            return { status: 201, body: record };
        }
        if (op === 'get') {
            const record = await storage.get(FILE_PREFIX + id);
            return record ? { status: 200, body: record } : { status: 404, body: { error: '檔案不存在' } };
        }
        if (op === 'list') {
            const { levels = ['public'], category = '', kind = '', query = '', cursor = '', limit = 24 } = payload;
            const q = String(query).trim().toLowerCase();
            const all = [...(await storage.list({ prefix: FILE_PREFIX, limit: MAX_FILES + 1 })).values()]
                .filter(record => levels.includes(record.visibility)
                    && (!category || record.category === category)
                    && (!kind || kindOf(record) === kind)
                    && (!q || `${record.name} ${record.description}`.toLowerCase().includes(q)))
                .sort(newestFirst);
            // The cursor is the (createdAt|id) of the last record already sent. Resume at the first record
            // ordered after it, so a cursor whose record was deleted or hidden meanwhile still works.
            let start = 0;
            if (cursor) {
                const split = String(cursor).indexOf('|');
                if (split < 1) throw new FileError('分頁游標無效');
                const cursorAt = cursor.slice(0, split), cursorId = cursor.slice(split + 1);
                start = all.findIndex(record => record.createdAt < cursorAt || (record.createdAt === cursorAt && record.id < cursorId));
                if (start < 0) start = all.length;
            }
            const size = Math.min(100, Math.max(1, Number(limit) || 24));
            const items = all.slice(start, start + size);
            const last = items[items.length - 1];
            return { status: 200, body: { items, total: all.length, nextCursor: start + size < all.length && last ? `${last.createdAt}|${last.id}` : null } };
        }
        if (op === 'update') {
            const record = await storage.get(FILE_PREFIX + id);
            if (!record) return { status: 404, body: { error: '檔案不存在' } };
            const fields = payload.fields || {};
            const link = isDriveLink(record);
            if (fields.name !== undefined) record.name = link ? cleanTitle(fields.name) : cleanFileName(fields.name, record.type);
            if (fields.description !== undefined) record.description = cleanDescription(fields.description);
            if (fields.category !== undefined) record.category = cleanCategory(fields.category);
            if (fields.visibility !== undefined) record.visibility = link ? cleanLinkVisibility(fields.visibility) : cleanVisibility(fields.visibility, record.type);
            record.updatedAt = new Date().toISOString();
            record.updatedBy = String(payload.by || '');
            await storage.put(FILE_PREFIX + id, record);
            await this.audit(storage, 'update', record, record.updatedBy);
            return { status: 200, body: record };
        }
        if (op === 'delete') {
            const record = await storage.get(FILE_PREFIX + id);
            if (!record) return { status: 404, body: { error: '檔案不存在' } };
            await storage.delete(FILE_PREFIX + id);
            await this.audit(storage, 'delete', record, String(payload.by || ''));
            return { status: 200, body: { success: true } };
        }
        if (op === 'drive-folders-get') return { status: 200, body: (await storage.get(DRIVE_FOLDERS_KEY)) || [] };
        if (op === 'drive-folders-set') {
            await storage.put(DRIVE_FOLDERS_KEY, payload.folders);
            await this.audit(storage, 'drive-folders', { id: '', name: `${payload.folders.length} 個資料夾`, size: 0, visibility: '' }, String(payload.by || ''));
            return { status: 200, body: payload.folders };
        }
        if (op === 'audit') {
            const entries = [...(await storage.list({ prefix: AUDIT_PREFIX })).values()].reverse();
            return { status: 200, body: entries.slice(0, 100) };
        }
        return { status: 404, body: { error: '檔案操作不存在' } };
    }
}
