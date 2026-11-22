// File library (檔案庫): pure validation for uploads. Nothing here touches storage, so the
// rules (type whitelist, magic bytes, size limits, names, visibility) are unit-testable.

export class FileError extends Error {
    constructor(message, status = 400) { super(message); this.name = 'FileError'; this.status = status; }
}

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
// multipart framing (boundaries, field headers, text fields) on top of the file itself.
export const MULTIPART_OVERHEAD = 64 * 1024;
export const MAX_FILES = 5000;

export const CATEGORIES = { article: '文章配圖', photo: '活動照片', meeting: '會議紀錄', receipt: '收據憑證', equipment: '設備資料', document: '一般文件', other: '其他' };
// Who may open a file: anybody, any signed-in account, or president / cadre / finance only.
export const VISIBILITIES = { public: '公開', member: '社員', cadre: '幹部限定' };

// The only types that can be stored. SVG, HTML and JS are deliberately absent: they can carry
// script. `ext` lists the accepted spellings; the first one is the canonical one.
export const FILE_TYPES = {
    jpeg: { mime: 'image/jpeg', ext: ['jpg', 'jpeg'], image: true },
    png: { mime: 'image/png', ext: ['png'], image: true },
    webp: { mime: 'image/webp', ext: ['webp'], image: true },
    gif: { mime: 'image/gif', ext: ['gif'], image: true },
    pdf: { mime: 'application/pdf', ext: ['pdf'], image: false },
    docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: ['docx'], image: false },
    xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: ['xlsx'], image: false },
    pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: ['pptx'], image: false },
    zip: { mime: 'application/zip', ext: ['zip'], image: false }
};

export const isImageType = type => FILE_TYPES[type]?.image === true;
export const sizeLimitFor = type => (isImageType(type) ? MAX_IMAGE_BYTES : MAX_FILE_BYTES);

const startsWith = (bytes, signature, offset = 0) => signature.every((value, index) => bytes[offset + index] === value);
const ascii = (bytes, start, end) => String.fromCharCode(...bytes.subarray(start, end));

// Names of the entries in a ZIP archive, read from its central directory (nothing is decompressed).
// Returns null when the archive is truncated or malformed.
export function zipEntryNames(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
        if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return null;
    const count = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    const names = [];
    for (let i = 0; i < count; i++) {
        if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) return null;
        const nameLength = view.getUint16(offset + 28, true), extraLength = view.getUint16(offset + 30, true), commentLength = view.getUint16(offset + 32, true);
        if (offset + 46 + nameLength > bytes.length) return null;
        names.push(new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength)));
        offset += 46 + nameLength + extraLength + commentLength;
    }
    return names;
}

// Identifies a file by its content, never by its name or declared Content-Type.
// Returns a key of FILE_TYPES, or null when the bytes are not an allowed type.
export function detectFileType(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 12) return null;
    if (startsWith(bytes, [0xFF, 0xD8, 0xFF])) return 'jpeg';
    if (startsWith(bytes, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) return 'png';
    if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return 'gif';
    if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'webp';
    if (ascii(bytes, 0, 5) === '%PDF-') return 'pdf';
    if (startsWith(bytes, [0x50, 0x4B, 0x03, 0x04])) {
        const names = zipEntryNames(bytes);
        if (!names) return null;
        if (names.includes('[Content_Types].xml')) {
            if (names.some(name => name.startsWith('word/'))) return 'docx';
            if (names.some(name => name.startsWith('xl/'))) return 'xlsx';
            if (names.some(name => name.startsWith('ppt/'))) return 'pptx';
        }
        return 'zip';
    }
    return null;
}

export function extensionOf(name) {
    const match = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || ''));
    return match ? match[1].toLowerCase() : '';
}

// A display name that is safe to store and show: no path parts, control or direction-override
// characters. The result is only ever a label — storage keys are random IDs.
export function cleanFileName(value, type) {
    let name = String(value ?? '').normalize('NFC')
        .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
        .replace(/[\\/:*?"<>|]+/g, '_')
        .replace(/\s+/g, ' ').trim()
        .replace(/^\.+/, '');
    const spec = FILE_TYPES[type];
    const ext = extensionOf(name);
    if (spec && !spec.ext.includes(ext)) name = `${name.replace(/\.[A-Za-z0-9]{1,8}$/, '')}.${spec.ext[0]}`;
    if (name.length > 120) {
        const keep = spec ? spec.ext.find(e => name.endsWith(`.${e}`)) || spec.ext[0] : '';
        name = `${Array.from(name.replace(/\.[A-Za-z0-9]{1,8}$/, '')).slice(0, 110).join('')}.${keep}`;
    }
    return name.replace(/^\.+/, '') || `file.${spec?.ext[0] || 'bin'}`;
}

export function cleanDescription(value) {
    const text = String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g, '').trim();
    if (text.length > 300) throw new FileError('說明不可超過 300 字');
    return text;
}

export function cleanCategory(value) {
    const category = String(value ?? 'other').trim() || 'other';
    if (!Object.hasOwn(CATEGORIES, category)) throw new FileError('分類無效');
    return category;
}

// Public files are served to anyone without a session, so only images may be public.
export function cleanVisibility(value, type) {
    const visibility = String(value ?? 'cadre').trim() || 'cadre';
    if (!Object.hasOwn(VISIBILITIES, visibility)) throw new FileError('可見範圍無效');
    if (visibility === 'public' && !isImageType(type)) throw new FileError('只有圖片可以設為公開；文件請選「社員」或「幹部限定」');
    return visibility;
}

// Checks one uploaded file end to end and returns what should be stored.
export function validateUpload({ bytes, originalName, category, visibility, description }) {
    if (!bytes || bytes.length === 0) throw new FileError('檔案是空的');
    if (bytes.length > MAX_FILE_BYTES) throw new FileError('檔案超過大小上限', 413);
    const type = detectFileType(bytes);
    if (!type) throw new FileError('不支援的檔案類型。允許：JPG、PNG、WebP、GIF、PDF、DOCX、XLSX、PPTX、ZIP（以檔案內容判斷）', 415);
    const ext = extensionOf(originalName);
    if (!FILE_TYPES[type].ext.includes(ext)) throw new FileError(`副檔名與檔案內容不符（內容為 ${FILE_TYPES[type].ext[0].toUpperCase()}）`, 415);
    if (bytes.length > sizeLimitFor(type)) throw new FileError(`${isImageType(type) ? '圖片' : '檔案'}不可超過 ${sizeLimitFor(type) / 1024 / 1024} MB`, 413);
    return {
        type, mime: FILE_TYPES[type].mime, size: bytes.length,
        name: cleanFileName(originalName, type),
        category: cleanCategory(category),
        visibility: cleanVisibility(visibility, type),
        description: cleanDescription(description)
    };
}

// Content-Disposition value with an ASCII fallback plus an RFC 5987 UTF-8 name.
export function contentDisposition(kind, name) {
    const fallback = String(name).replace(/[^\x20-\x7E]/g, '_').replace(/["\\%;]/g, '_') || 'file';
    const encoded = encodeURIComponent(name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
    return `${kind}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

import { canUploadFiles, canViewCms, hasPermission } from './auth.js';
export { canUploadFiles };
export const canSeeCadreFiles = canViewCms;
// Visibilities this viewer (null = not signed in) is allowed to open.
export function visibleLevels(user) {
    if (!user) return ['public'];
    return canSeeCadreFiles(user) ? ['public', 'member', 'cadre'] : ['public', 'member'];
}
export const canManageFile = (user, record) => !!user && (hasPermission(user, 'files.admin') || (canUploadFiles(user) && record?.uploadedBy === user.username));

// ---- Google Drive links (no file is stored; only a link, a title, a category and who may see it) ----
const DRIVE_ID = /^[A-Za-z0-9_-]{10,100}$/;
const DOC_KINDS = ['document', 'spreadsheets', 'presentation', 'forms'];
const segment = value => { try { return decodeURIComponent(value); } catch { return ''; } };

// Reads a Drive / Docs URL strictly: https only, host exactly drive.google.com or docs.google.com, no
// credentials or port, and the file id taken from a known path shape and checked against [A-Za-z0-9_-].
// The stored links are rebuilt from the id, so nothing else from the pasted text is kept.
// Returns { kind, id, viewUrl, embedUrl } (embedUrl is null when the item cannot be previewed) or null.
export function parseDriveUrl(input) {
    let url;
    try { url = new URL(String(input ?? '').trim()); } catch { return null; }
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (url.hostname !== 'drive.google.com' && url.hostname !== 'docs.google.com') return null;
    const parts = url.pathname.split('/').filter(Boolean).map(segment);
    if (parts[0] === 'u' && /^\d+$/.test(parts[1] || '')) parts.splice(0, 2);
    if (url.hostname === 'drive.google.com' && parts[0] === 'drive' && parts[1] === 'u' && /^\d+$/.test(parts[2] || '')) parts.splice(1, 2);
    let kind = null, id = null;
    if (url.hostname === 'drive.google.com') {
        if (parts[0] === 'file' && parts[1] === 'd') { kind = 'file'; id = parts[2]; }
        else if (parts[0] === 'drive' && parts[1] === 'folders') { kind = 'folder'; id = parts[2]; }
        else if ((parts[0] === 'open' || parts[0] === 'uc') && parts.length === 1) { kind = 'file'; id = url.searchParams.get('id'); }
    } else if (DOC_KINDS.includes(parts[0]) && parts[1] === 'd') { kind = parts[0]; id = parts[2]; }
    if (!kind || !DRIVE_ID.test(id || '')) return null;
    if (kind === 'file') return { kind, id, viewUrl: `https://drive.google.com/file/d/${id}/view`, embedUrl: `https://drive.google.com/file/d/${id}/preview` };
    if (kind === 'folder') return { kind, id, viewUrl: `https://drive.google.com/drive/folders/${id}`, embedUrl: null };
    return { kind, id, viewUrl: `https://docs.google.com/${kind}/d/${id}/edit`, embedUrl: kind === 'forms' ? null : `https://docs.google.com/${kind}/d/${id}/preview` };
}

export const isDriveId = value => DRIVE_ID.test(String(value ?? ''));
// A folder given as a bare id or as a Drive folder URL.
export function parseFolderInput(input) {
    const text = String(input ?? '').trim();
    if (DRIVE_ID.test(text)) return text;
    const parsed = parseDriveUrl(text);
    return parsed?.kind === 'folder' ? parsed.id : null;
}

export function cleanTitle(value) {
    const title = String(value ?? '').normalize('NFC').replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
    if (!title) throw new FileError('請輸入標題');
    if (title.length > 120) throw new FileError('標題不可超過 120 字');
    return title;
}

export const isDriveLink = record => record?.type === 'drive';
// Link items may be seen by members or officers only (a link card is never an anonymous resource).
export function cleanLinkVisibility(value) {
    const visibility = String(value ?? 'member').trim() || 'member';
    if (visibility !== 'member' && visibility !== 'cadre') throw new FileError('Drive 連結的可見範圍只能是「社員」或「幹部限定」');
    return visibility;
}

export function validateDriveLink({ url, name, category, visibility, description }) {
    const parsed = parseDriveUrl(url);
    if (!parsed) throw new FileError('只接受 drive.google.com 或 docs.google.com 的檔案、資料夾或文件連結');
    return {
        type: 'drive', mime: '', size: 0, driveKind: parsed.kind, driveId: parsed.id, viewUrl: parsed.viewUrl, embedUrl: parsed.embedUrl,
        name: cleanTitle(name), category: cleanCategory(category), visibility: cleanLinkVisibility(visibility), description: cleanDescription(description)
    };
}
