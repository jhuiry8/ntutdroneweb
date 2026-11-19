// Field validation shared by the route modules. A ValidationError becomes an HTTP 400
// with its message (see the error handling in worker.js).
export class ValidationError extends Error {}

// Slugs become KV keys and URL path segments, so keep them to a safe charset.
export const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

export function financeAmount(value) {
    const amount = Number(value);
    return Number.isSafeInteger(amount) && amount >= 0 && amount <= 1000000000 ? amount : null;
}

export function financeText(value, field, maxLength = 100) {
    const text = String(value ?? '').trim();
    if (!text || text.length > maxLength) throw new ValidationError(`${field} 為必填，且不可超過 ${maxLength} 字`);
    return text;
}

export function financeDate(value) {
    const date = String(value ?? '');
    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) throw new ValidationError('日期格式必須為 YYYY-MM-DD');
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.getUTCFullYear() !== Number(match[1]) || parsed.getUTCMonth() + 1 !== Number(match[2]) || parsed.getUTCDate() !== Number(match[3])) throw new ValidationError('日期不存在');
    return date;
}

export function parseStoredList(json) {
    if (!json) return [];
    const list = JSON.parse(json);
    if (!Array.isArray(list)) throw new Error('財務資料格式錯誤');
    return list;
}

export function importedDate(value) {
    const match = String(value ?? '').trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
    if (!match) throw new ValidationError('日期格式必須為 YYYY/MM/DD 或 YYYY-MM-DD');
    return financeDate(`${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`);
}

export function importAmount(value, field) {
    if (value === '' || value === null || value === undefined) return 0;
    const normalized = String(value).replace(/[,$\s]/g, '');
    const amount = Number(normalized);
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1000000000) throw new ValidationError(`${field} 必須為 0 至 1,000,000,000 的整數`);
    return amount;
}