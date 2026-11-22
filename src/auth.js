import { hasPermission, hasAnyPermission, ROLES } from './permissions.js';

const roles = ROLES;
const encoder = new TextEncoder();
// Production Workers rejects PBKDF2 calls above 100,000 iterations, even
// though Node.js and local workerd may accept them.
const PASSWORD_ITERATIONS = 100000;

export class PasswordResetRequiredError extends Error {
    constructor() {
        super('此帳號的舊密碼格式不支援 Cloudflare，請由社長重設密碼後再登入。');
        this.name = 'PasswordResetRequiredError';
    }
}

export async function passwordHash(password, salt = crypto.randomUUID()) {
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: PASSWORD_ITERATIONS, hash: 'SHA-256' }, key, 256);
    return `pbkdf2:${PASSWORD_ITERATIONS}:${salt}:${Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, '0')).join('')}`;
}

export async function verifyPassword(password, stored) {
    if (typeof stored !== 'string') return false;
    // The previous unversioned format always used 120,000 iterations. Never
    // reinterpret it as a 100,000-iteration hash or reset credentials implicitly.
    if (/^pbkdf2:[^:]+:[a-f0-9]{64}$/.test(stored)) throw new PasswordResetRequiredError();
    const match = /^pbkdf2:100000:([^:]+):([a-f0-9]{64})$/.exec(stored);
    if (!match) return false;
    const salt = match[1];
    return constantTimeEqual(await passwordHash(password, salt), stored);
}

// Compares two secrets without leaking where they first differ.
export function constantTimeEqual(left, right) {
    const a = encoder.encode(String(left)), b = encoder.encode(String(right));
    if (a.length !== b.length) return false;
    let difference = 0;
    for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
    return difference === 0;
}

export function validRole(role) { return roles.includes(role); }

// Permission checks. Everything is decided by permission codes (see permissions.js); the
// old role-named helpers below are kept so existing routes and other modules keep working.
// `user.permissions` (set by sessionUser) wins; a user object without it falls back to its legacy role.
export { hasPermission, hasAnyPermission };
export function canManageUsers(user) { return hasPermission(user, 'users.manage'); }
export function canEditCms(user) { return hasPermission(user, 'cms.edit'); }
export function canViewCms(user) { return hasPermission(user, 'cms.view'); }
export function canManageFinance(user) { return hasPermission(user, 'finance.edit'); }
export function canManageMembers(user) { return hasPermission(user, 'members.edit'); }
export function canManageEquipment(user) { return hasPermission(user, 'equipment.manage'); }
export function canUploadFiles(user) { return hasPermission(user, 'files.upload'); }
// What the API and the dashboard may tell the signed-in person about themself.
export function publicUser(user) {
    return {
        username: user.username, role: user.role, active: user.active !== false, createdAt: user.createdAt, memberId: user.memberId || '',
        ...(Array.isArray(user.permissions) ? { positions: user.positions || [], permissions: user.permissions } : {})
    };
}
