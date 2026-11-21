// Request parsing shared by every route module: cookies and size-limited JSON bodies.
import { ValidationError } from './validation.js';

// Helper: Parse Cookies
export function parseCookies(request) {
    const list = {};
    const cookieHeader = request.headers.get('Cookie');
    if (!cookieHeader) return list;

    cookieHeader.split(';').forEach(cookie => {
        let [name, ...rest] = cookie.split('=');
        name = name.trim();
        if (!name) return;
        const value = rest.join('=').trim();
        try { list[name] = decodeURIComponent(value); }
        catch { list[name] = value; }
    });
    return list;
}

export class PayloadTooLargeError extends Error {
    constructor(maxBytes) {
        super(`請求資料不可超過 ${maxBytes >= 1_000_000 ? `${Math.round(maxBytes / 1_000_000)} MB` : `${Math.round(maxBytes / 1024)} KB`}`);
    }
}
export const DEFAULT_JSON_LIMIT = 256 * 1024;
export const CONTENT_JSON_LIMIT = 1_000_000;

// Reads a request body into memory, refusing anything over maxBytes (also when Content-Length is absent or wrong).
export async function readBytesLimited(request, maxBytes) {
    const declared = Number(request.headers.get('Content-Length'));
    if (Number.isFinite(declared) && declared > maxBytes) throw new PayloadTooLargeError(maxBytes);
    const reader = request.body?.getReader();
    if (!reader) throw new ValidationError('請提供資料內容');
    const chunks = [];
    let size = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
            await reader.cancel();
            throw new PayloadTooLargeError(maxBytes);
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
}

export async function readJsonLimited(request, maxBytes) {
    if (!request.body) throw new ValidationError('請提供 JSON 格式資料');
    const bytes = await readBytesLimited(request, maxBytes);
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new ValidationError('JSON 格式錯誤'); }
}

// Reads a size-limited JSON body that must be an object.
export async function readJsonObject(request, maxBytes = DEFAULT_JSON_LIMIT) {
    const body = await readJsonLimited(request, maxBytes);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('請提供 JSON 物件');
    return body;
}