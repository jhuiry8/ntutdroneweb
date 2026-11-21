// Scheduled backup of the KV data and every Durable Object to a private R2 bucket (binding BACKUPS).
// One JSON file per day, backups/YYYY-MM-DD.json; only the newest BACKUP_KEEP are kept.
// Sessions (session:*) are deliberately left out: they are short-lived login tokens.
import * as kvKeys from './kv-keys.js';
import { canManageUsers } from './auth.js';
import { sessionUser } from './session.js';
import { taipeiToday } from './forms.js';
import { EXPORT_PATH } from './do-export.js';
import { PUSH_SETTINGS_KEY } from './messages.js';

export const BACKUP_PREFIX = 'backups/';
export const BACKUP_KEEP = 30;
export const BACKUP_CRON = '0 19 * * *'; // 03:00 Taipei every day
export const BACKUP_FORMAT = 1;

// Fixed KV keys: everything in kv-keys.js plus the CMS/login keys defined elsewhere.
const EXTRA_KEYS = ['posts_list', 'pages_list', 'homepage_content', 'admin_password_hash', PUSH_SETTINGS_KEY];
// KV prefixes copied whole (accounts, posts, custom pages). session:* is not among them.
const KV_PREFIXES = ['user:', 'post:', 'page:'];

// [binding, Durable Object name used by its routes]
export const DURABLE_OBJECTS = [
    ['EQUIPMENT_STORE', 'club-equipment-inventory'],
    ['FORM_STORE', 'club-forms'],
    ['SITE_STORE', 'site-security'],
    ['MEETING_STORE', 'club-meetings'],
    ['MESSAGE_STORE', 'club-messages']
];

export const backupKey = date => `${BACKUP_PREFIX}${date}.json`;
const BACKUP_KEY_PATTERN = /^backups\/\d{4}-\d{2}-\d{2}\.json$/;

async function listKvKeys(kv, prefix) {
    const names = [];
    let cursor;
    for (;;) {
        const page = await kv.list(cursor ? { prefix, cursor } : { prefix });
        names.push(...page.keys.map(key => key.name));
        if (page.list_complete !== false || !page.cursor) break;
        cursor = page.cursor;
    }
    return names;
}

export async function exportKv(kv) {
    const names = new Set(Object.values(kvKeys).concat(EXTRA_KEYS));
    for (const prefix of KV_PREFIXES) for (const name of await listKvKeys(kv, prefix)) names.add(name);
    const data = {};
    for (const name of [...names].sort()) {
        if (name.startsWith('session:')) continue;
        const value = await kv.get(name);
        if (value !== null && value !== undefined) data[name] = value;
    }
    return data;
}

export async function exportDurableObject(namespace, name) {
    const stub = namespace.get(namespace.idFromName(name));
    const response = await stub.fetch(`https://backup${EXPORT_PATH}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!response.ok) throw new Error(`${name} export failed (${response.status})`);
    return (await response.json()).entries;
}

export async function collectBackup(env, now = new Date()) {
    const durableObjects = {};
    for (const [binding, name] of DURABLE_OBJECTS) {
        if (env[binding]) durableObjects[binding] = await exportDurableObject(env[binding], name);
    }
    return { format: BACKUP_FORMAT, createdAt: now.toISOString(), kv: await exportKv(env.DRONE_DB), durableObjects };
}

async function listBackupKeys(bucket) {
    const keys = [];
    let cursor;
    for (;;) {
        const page = await bucket.list({ prefix: BACKUP_PREFIX, cursor });
        keys.push(...page.objects.map(object => object.key).filter(key => BACKUP_KEY_PATTERN.test(key)));
        if (!page.truncated) break;
        cursor = page.cursor;
    }
    return keys.sort();
}

// Deletes every backup beyond the newest `keep` (at least one). Names sort by date.
export async function pruneBackups(bucket, keep = BACKUP_KEEP) {
    const stale = (await listBackupKeys(bucket)).reverse().slice(Math.max(1, keep));
    if (stale.length) await bucket.delete(stale);
    return stale;
}

export async function latestBackupKey(bucket) {
    return (await listBackupKeys(bucket)).pop() || null;
}

// Writes today's backup (same-day runs overwrite), then prunes. The new file is written first so a failure never loses old backups.
export async function runBackup(env, now = new Date()) {
    if (!env.BACKUPS) throw new Error('BACKUPS R2 binding is not configured');
    const backup = await collectBackup(env, now);
    const key = backupKey(taipeiToday(now));
    const body = JSON.stringify(backup);
    await env.BACKUPS.put(key, body, { httpMetadata: { contentType: 'application/json' } });
    const pruned = await pruneBackups(env.BACKUPS, Number(env.BACKUP_KEEP) >= 1 ? Math.floor(Number(env.BACKUP_KEEP)) : BACKUP_KEEP);
    return { key, bytes: body.length, kvKeys: Object.keys(backup.kv).length, pruned };
}

// President-only: POST /api/backup/run (back up now), GET /api/backup/latest (download the newest file).
export async function handleBackupRequest(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname !== '/api/backup/run' && pathname !== '/api/backup/latest') return null;
    const wanted = pathname === '/api/backup/run' ? 'POST' : 'GET';
    if (request.method !== wanted) return Response.json({ error: '方法不允許' }, { status: 405 });
    const user = await sessionUser(request, env);
    if (!user) return Response.json({ error: '未授權' }, { status: 401 });
    if (!canManageUsers(user)) return Response.json({ error: '只有社長可以使用備份功能' }, { status: 403 });
    if (!env.BACKUPS) return Response.json({ error: '尚未設定 BACKUPS R2 bucket' }, { status: 503 });
    if (wanted === 'POST') return Response.json(await runBackup(env), { status: 201 });
    const key = await latestBackupKey(env.BACKUPS);
    const object = key && await env.BACKUPS.get(key);
    if (!object) return Response.json({ error: '尚無備份' }, { status: 404 });
    return new Response(object.body, { headers: {
        'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${key.slice(BACKUP_PREFIX.length)}"`, 'Cache-Control': 'no-store'
    } });
}
