const roles = ['president', 'finance', 'cadre', 'member'];
const encoder = new TextEncoder();

export async function passwordHash(password, salt = crypto.randomUUID()) {
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: 120000, hash: 'SHA-256' }, key, 256);
    return `pbkdf2:${salt}:${Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, '0')).join('')}`;
}

export async function verifyPassword(password, stored) {
    if (!stored?.startsWith('pbkdf2:')) return false;
    const [, salt] = stored.split(':');
    const actual = await passwordHash(password, salt);
    const a = encoder.encode(actual), b = encoder.encode(stored);
    if (a.length !== b.length) return false;
    let difference = 0;
    for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
    return difference === 0;
}

export function validRole(role) { return roles.includes(role); }
export function canManageUsers(user) { return user?.role === 'president'; }
export function canEditCms(user) { return ['president', 'cadre'].includes(user?.role); }
export function canViewCms(user) { return ['president', 'finance', 'cadre'].includes(user?.role); }
export function publicUser(user) {
    return { username: user.username, role: user.role, active: user.active !== false, createdAt: user.createdAt };
}
