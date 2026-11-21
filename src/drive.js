// Read-only access to Google Drive through a service account (the optional 雲端硬碟 tab).
// The club shares folders with the service account's e-mail; the Worker signs a JWT with the
// account's key (RS256, Web Crypto), trades it for a short-lived access token and calls Drive API v3.
// Scope is drive.readonly, and nothing here ever writes to Drive. Without the
// GOOGLE_SERVICE_ACCOUNT_JSON secret the feature is simply off (driveEnabled() is false).
import { isDriveId } from './files.js';

export class DriveError extends Error {
    constructor(message, status = 502) { super(message); this.name = 'DriveError'; this.status = status; }
}

// Fixed on purpose: the "token_uri" inside a key file is never trusted, so a tampered secret
// cannot make the Worker send its signed JWT somewhere else.
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const API = 'https://www.googleapis.com/drive/v3';
const encoder = new TextEncoder();

export function driveCredentials(env) {
    const raw = env?.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (typeof raw !== 'string' || !raw.trim()) return null;
    let key;
    try { key = JSON.parse(raw); } catch { return null; }
    if (!key || (key.type && key.type !== 'service_account')) return null;
    if (typeof key.client_email !== 'string' || !key.client_email.includes('@')) return null;
    if (typeof key.private_key !== 'string' || !key.private_key.includes('BEGIN PRIVATE KEY')) return null;
    return { email: key.client_email, privateKey: key.private_key };
}
export const driveEnabled = env => driveCredentials(env) !== null;

const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlText = text => b64url(encoder.encode(text));

async function importKey(pem) {
    const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
    const der = Uint8Array.from(atob(body), c => c.charCodeAt(0));
    return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

export async function signServiceJwt(credentials, nowSeconds) {
    const header = b64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64urlText(JSON.stringify({ iss: credentials.email, scope: DRIVE_SCOPE, aud: TOKEN_URL, iat: nowSeconds, exp: nowSeconds + 3600 }));
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await importKey(credentials.privateKey), encoder.encode(`${header}.${claims}`));
    return `${header}.${claims}.${b64url(signature)}`;
}

// Access token and short-lived response caches live in this isolate's memory only.
let tokenState = null;
const answers = new Map();
export function resetDriveCache() { tokenState = null; answers.clear(); }

export async function accessToken(env, now = Date.now()) {
    const credentials = driveCredentials(env);
    if (!credentials) throw new DriveError('雲端硬碟功能尚未啟用', 404);
    if (tokenState?.email === credentials.email && tokenState.token && tokenState.expiresAt - 60_000 > now) return tokenState.token;
    if (tokenState?.email === credentials.email && tokenState.pending) return tokenState.pending;
    const pending = (async () => {
        const assertion = await signServiceJwt(credentials, Math.floor(now / 1000));
        const response = await fetch(TOKEN_URL, {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || typeof body.access_token !== 'string') {
            console.error('Google token request failed', response.status, body?.error || '');
            throw new DriveError('無法向 Google 取得授權，請確認服務帳號金鑰');
        }
        tokenState = { email: credentials.email, token: body.access_token, expiresAt: now + (Number(body.expires_in) || 3600) * 1000 };
        return body.access_token;
    })();
    tokenState = { email: credentials.email, pending };
    try { return await pending; } catch (error) { tokenState = null; throw error; }
}

// Authenticated GET against Google. One retry with a fresh token when the cached one was rejected.
async function googleGet(env, url, { raw = false } = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
        const response = await fetch(url, { headers: { Authorization: `Bearer ${await accessToken(env)}` } });
        if (response.status === 401 && attempt === 0) { tokenState = null; continue; }
        if (response.status === 404) throw new DriveError('找不到這個雲端硬碟項目（請確認已分享給服務帳號）', 404);
        if (!response.ok) { console.error('Drive request failed', response.status); throw new DriveError('Google 雲端硬碟暫時無法讀取'); }
        return raw ? response : response.json();
    }
    throw new DriveError('Google 雲端硬碟暫時無法讀取');
}

async function cached(key, ttlMs, load) {
    const hit = answers.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
    const value = await load();
    if (answers.size >= 500) answers.delete(answers.keys().next().value);
    answers.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
}

const LIST_TTL = 60_000, META_TTL = 300_000;
const NATIVE = { 'application/vnd.google-apps.document': 'document', 'application/vnd.google-apps.spreadsheet': 'spreadsheets', 'application/vnd.google-apps.presentation': 'presentation' };
export const FOLDER_MIME = 'application/vnd.google-apps.folder';

// Preview and open links are rebuilt from the file id; Google's own link fields are never passed on.
export function previewUrlFor(file) {
    if (file.mimeType === FOLDER_MIME) return null;
    if (NATIVE[file.mimeType]) return `https://docs.google.com/${NATIVE[file.mimeType]}/d/${file.id}/preview`;
    if (file.mimeType?.startsWith('application/vnd.google-apps.')) return null;
    return `https://drive.google.com/file/d/${file.id}/preview`;
}
export function openUrlFor(file) {
    if (file.mimeType === FOLDER_MIME) return `https://drive.google.com/drive/folders/${file.id}`;
    if (NATIVE[file.mimeType]) return `https://docs.google.com/${NATIVE[file.mimeType]}/d/${file.id}/edit`;
    return `https://drive.google.com/file/d/${file.id}/view`;
}

export function listFolder(env, folderId, pageToken = '') {
    if (!isDriveId(folderId)) throw new DriveError('資料夾編號無效', 400);
    return cached(`list:${folderId}:${pageToken}`, LIST_TTL, async () => {
        const params = new URLSearchParams({
            q: `'${folderId}' in parents and trashed = false`, pageSize: '100', orderBy: 'folder,name',
            fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,size,thumbnailLink)',
            supportsAllDrives: 'true', includeItemsFromAllDrives: 'true'
        });
        if (pageToken) params.set('pageToken', pageToken);
        const data = await googleGet(env, `${API}/files?${params}`);
        const items = (Array.isArray(data.files) ? data.files : []).filter(file => isDriveId(file.id)).map(file => ({
            id: file.id, name: String(file.name || '').slice(0, 200), mimeType: String(file.mimeType || ''), isFolder: file.mimeType === FOLDER_MIME,
            modifiedTime: file.modifiedTime || '', size: Number(file.size) || 0, hasThumb: typeof file.thumbnailLink === 'string',
            previewUrl: previewUrlFor(file), openUrl: openUrlFor(file)
        }));
        return { items, nextPageToken: typeof data.nextPageToken === 'string' ? data.nextPageToken : null };
    });
}

export function fileInfo(env, id) {
    if (!isDriveId(id)) throw new DriveError('檔案編號無效', 400);
    return cached(`meta:${id}`, META_TTL, () => googleGet(env, `${API}/files/${id}?${new URLSearchParams({ fields: 'id,name,mimeType,parents,thumbnailLink', supportsAllDrives: 'true' })}`));
}

// True when `id` is the root folder or sits somewhere below it. Folders the Worker did not configure
// are therefore unreachable even if the service account can see them.
export async function isInside(env, rootId, id) {
    let current = id;
    for (let depth = 0; depth < 20; depth++) {
        if (current === rootId) return true;
        const parent = (await fileInfo(env, current)).parents?.[0];
        if (!parent) return false;
        current = parent;
    }
    return false;
}

// Thumbnail bytes for a file below a configured root, fetched with the service account.
export async function thumbnail(env, id) {
    const info = await fileInfo(env, id);
    let link;
    try { link = new URL(info.thumbnailLink || ''); } catch { throw new DriveError('沒有縮圖', 404); }
    if (link.protocol !== 'https:' || !/^[a-z0-9-]+\.googleusercontent\.com$/.test(link.hostname)) throw new DriveError('沒有縮圖', 404);
    link.href = link.href.replace(/=s\d+(-[a-z]+)*$/, '=s320');
    const response = await googleGet(env, link.href, { raw: true });
    const type = (response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(type)) throw new DriveError('沒有縮圖', 404);
    return { body: response.body, type };
}
