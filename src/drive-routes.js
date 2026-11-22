// HTTP routes for the read-only Google Drive tab of the file library (/api/drive/*).
// Off until the GOOGLE_SERVICE_ACCOUNT_JSON secret exists: /api/drive/status then reports
// enabled:false (the page hides the tab) and every other route answers 404 instead of failing.
//
//   GET /api/drive/status                       { enabled, canConfigure }
//   GET /api/drive/folders                      configured folders this account may open
//   PUT /api/drive/folders                      president: set folders [{ id|url, name, visibility }]
//   GET /api/drive/list?root=&folder=&pageToken=    one folder's contents (folder defaults to root)
//   GET /api/drive/thumb?root=&file=            thumbnail image proxied through the Worker
import { hasPermission } from './auth.js';
import { readJsonObject } from './request.js';
import { sessionUser } from './session.js';
import { VISIBILITIES, isDriveId, parseFolderInput, visibleLevels } from './files.js';
import { fileStoreRequest } from './file-store.js';
import { DriveError, driveEnabled, isInside, listFolder, thumbnail, fileInfo } from './drive.js';

const MAX_FOLDERS = 20;
const json = (body, status = 200, cache = 'no-store') => Response.json(body, { status, headers: { 'Cache-Control': cache } });

async function configured(env) {
    const result = await fileStoreRequest(env, 'drive-folders-get');
    return Array.isArray(result.body) ? result.body : [];
}

export function normalizeFolders(input) {
    if (!Array.isArray(input) || input.length > MAX_FOLDERS) throw new DriveError(`最多設定 ${MAX_FOLDERS} 個資料夾`, 400);
    const seen = new Set();
    return input.map(entry => {
        const id = parseFolderInput(entry?.id ?? entry?.url);
        if (!id) throw new DriveError('資料夾需為 Drive 資料夾網址或有效的資料夾 ID', 400);
        if (seen.has(id)) throw new DriveError('資料夾重複', 400);
        seen.add(id);
        const name = String(entry?.name ?? '').replace(/[\u0000-\u001F\u007F-\u009F‪-‮⁦-⁩]/g, '').trim().slice(0, 60);
        if (!name) throw new DriveError('請為每個資料夾填顯示名稱', 400);
        const visibility = String(entry?.visibility ?? 'cadre');
        if (!Object.hasOwn(VISIBILITIES, visibility)) throw new DriveError('可見範圍無效', 400);
        return { id, name, visibility };
    });
}

// Returns a Response for /api/drive*, or null for any other path.
export async function handleDriveRequest(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path !== '/api/drive' && !path.startsWith('/api/drive/')) return null;
    if (request.method !== 'GET' && request.method !== 'PUT') return json({ error: '方法不允許' }, 405);

    const user = await sessionUser(request, env);
    if (!user) return json({ error: '未授權' }, 401);
    const enabled = driveEnabled(env);
    if (path === '/api/drive/status' && request.method === 'GET') return json({ enabled, canConfigure: enabled && hasPermission(user, 'site.settings') });
    if (!enabled) return json({ error: '雲端硬碟功能尚未啟用' }, 404);

    try {
        if (path === '/api/drive/folders' && request.method === 'GET') {
            const levels = visibleLevels(user);
            return json((await configured(env)).filter(folder => levels.includes(folder.visibility)));
        }
        if (path === '/api/drive/folders' && request.method === 'PUT') {
            if (!hasPermission(user, 'site.settings')) return json({ error: '沒有設定雲端硬碟資料夾的權限' }, 403);
            const body = await readJsonObject(request, 32 * 1024);
            const folders = normalizeFolders(body.folders);
            return json((await fileStoreRequest(env, 'drive-folders-set', { folders, by: user.username })).body);
        }
        if (request.method !== 'GET') return json({ error: '方法不允許' }, 405);

        const rootId = url.searchParams.get('root') || '';
        if (!isDriveId(rootId)) return json({ error: '找不到資料夾' }, 404);
        // The root must be configured and visible to this account; everything below inherits its visibility.
        const root = (await configured(env)).find(folder => folder.id === rootId);
        if (!root || !visibleLevels(user).includes(root.visibility)) return json({ error: '找不到資料夾' }, 404);

        if (path === '/api/drive/list') {
            const folderId = url.searchParams.get('folder') || rootId;
            if (!isDriveId(folderId)) return json({ error: '資料夾編號無效' }, 400);
            if (!(await isInside(env, rootId, folderId))) return json({ error: '找不到資料夾' }, 404);
            const pageToken = (url.searchParams.get('pageToken') || '').slice(0, 500);
            const result = await listFolder(env, folderId, pageToken);
            return json({ root: { id: root.id, name: root.name }, folder: folderId, ...result }, 200, 'private, max-age=60');
        }
        if (path === '/api/drive/thumb') {
            const fileId = url.searchParams.get('file') || '';
            if (!isDriveId(fileId)) return json({ error: '找不到檔案' }, 404);
            const info = await fileInfo(env, fileId);
            if (!info.parents?.[0] || !(await isInside(env, rootId, info.parents[0]))) return json({ error: '找不到檔案' }, 404);
            const image = await thumbnail(env, fileId);
            return new Response(image.body, { headers: {
                'Content-Type': image.type, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox",
                'Cache-Control': 'private, max-age=300', 'Cross-Origin-Resource-Policy': 'same-origin'
            } });
        }
        return json({ error: '找不到' }, 404);
    } catch (error) {
        if (error instanceof DriveError) return json({ error: error.message }, error.status);
        throw error;
    }
}
