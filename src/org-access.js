// Helpers shared by the account and organisation routes: who is a real president, what an actor may hand out,
// and how many presidents remain. Kept apart from the routes so both can use them without importing each other.
import { orgStoreRequest } from './org-store.js';
import { listUsers } from './session.js';
import { LEGACY_ROLE_POSITION, LEGACY_ROLE_PERMISSIONS, permissionsFromRole, positionCatalog, hasPermission, PRESIDENT_ONLY_PERMISSIONS } from './permissions.js';

// The 社長 (or the system administrator), as opposed to a 副社長 acting for them.
export const isRealPresident = user => Boolean(user) && (user.realPresident ?? user.role === 'president');

// Positions and permissions of accounts, from the OrgStore when there is one, else from their old roles.
export async function accessMap(env, users) {
    if (env.ORG_STORE) {
        const { body } = await orgStoreRequest(env, 'resolve-many', { users: users.map(item => ({ username: item.username, legacyRole: item.role })) });
        return body;
    }
    return Object.fromEntries(users.map(item => {
        const position = LEGACY_ROLE_POSITION[item.role];
        return [item.username, { username: item.username, positions: !position || position === 'member' ? [] : [position], standing: [], grants: [], revokes: [], permissions: permissionsFromRole(item.role), role: item.role, realPresident: item.role === 'president' || item.username === 'admin' }];
    }));
}

// An actor may only hand out permissions they hold themselves (the 社長 holds them all), and
// users.manage only ever by a real president.
export function missingPermissions(actor, permissions) {
    if (isRealPresident(actor)) return [];
    return permissions.filter(code => PRESIDENT_ONLY_PERMISSIONS.includes(code) || !hasPermission(actor, code));
}
export function positionPermissions(catalog, positionIds) {
    return [...new Set(positionIds.flatMap(id => catalog[id]?.permissions || []))];
}

// Active accounts other than `except` that are a real president right now.
export async function otherPresidents(env, except) {
    const users = (await listUsers(env)).filter(item => item.active !== false && item.username !== except);
    const access = await accessMap(env, users);
    return users.filter(item => access[item.username]?.realPresident || (item.username === 'admin'));
}
export { positionCatalog, LEGACY_ROLE_PERMISSIONS };

// 本屆法規監察委員（含主任委員）from the positions and the roster, as the committee meeting needs them:
// who may attend and vote, and who is also 總務 (章程第十二條第四款: cannot vote on the books they handle).
export async function currentCommittee(env) {
    if (!env.ORG_STORE) return null;
    const { body } = await orgStoreRequest(env, 'position-holders', { positions: ['committee', 'committee_chair', 'treasurer'] });
    const accounts = new Map((await listUsers(env)).filter(item => item.active !== false).map(item => [item.username, item]));
    let members = [];
    try { members = JSON.parse((await env.DRONE_DB.get('members:list')) || '[]'); } catch { /* no roster yet */ }
    const names = new Map(members.map(item => [item.id, item.name]));
    return body.holders.filter(holder => accounts.has(holder.username) && holder.positions.some(id => id === 'committee' || id === 'committee_chair')).map(holder => {
        const account = accounts.get(holder.username);
        return {
            username: holder.username, memberId: account.memberId || '', name: names.get(account.memberId) || holder.username,
            position: holder.positions.includes('committee_chair') ? 'committee_chair' : 'committee', treasurer: holder.positions.includes('treasurer')
        };
    }).sort((a, b) => a.username.localeCompare(b.username));
}
export const COMMITTEE_POSITIONS = ['committee', 'committee_chair'];
export const isCommitteeMember = user => Boolean(user) && (user.positions || []).some(id => COMMITTEE_POSITIONS.includes(id));
