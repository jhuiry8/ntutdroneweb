// Update check and release announcements for the desktop program (desktop/).
import { canManageUsers, constantTimeEqual } from './auth.js';
import { readJsonObject } from './request.js';
import { sessionUser } from './session.js';
import { ValidationError } from './validation.js';
import { DESKTOP_RELEASE_KEY } from './kv-keys.js';
import { renderDownloadPage } from './templates/download.js';

// Latest desktop program release (desktop/). Installers are published as GitHub
// release assets; the program checks the SHA-256 before running a download.
function normalizeDesktopRelease(body, username) {
    const version = String(body.version ?? '').trim();
    if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version)) throw new ValidationError('版本號格式須為「1.2.0」');
    const url = String(body.url ?? '').trim();
    let parsed;
    try { parsed = new URL(url); } catch { throw new ValidationError('下載網址格式無效'); }
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' || url.length > 500) throw new ValidationError('下載網址必須是 https://github.com/ 的 Release 檔案');
    const sha256 = String(body.sha256 ?? '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new ValidationError('SHA-256 必須是 64 位十六進位字元');
    const notes = String(body.notes ?? '').trim();
    if (notes.length > 2000) throw new ValidationError('更新說明不可超過 2000 字');
    return { version, url: parsed.href, sha256, notes, mandatory: body.mandatory === true, publishedBy: username, publishedAt: new Date().toISOString() };
}

function compareVersions(a, b) {
    const left = String(a).split('.').map(Number), right = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((left[i] || 0) !== (right[i] || 0)) return (left[i] || 0) - (right[i] || 0);
    return 0;
}

function parseDesktopRelease(json) {
    if (!json) return null;
    try {
        const release = JSON.parse(json);
        return release && typeof release.version === 'string' ? release : null;
    } catch { return null; }
}

const GITHUB_LATEST_RELEASE_API = 'https://api.github.com/repos/jhuiry8/ntutdroneweb/releases/latest';

// Newest GitHub Release as {version, url, win7Url, apkUrl}, or null when GitHub cannot be reached.
// Cached by Cloudflare for 10 minutes to stay far below GitHub's unauthenticated rate limit.
export async function latestGithubRelease() {
    try {
        const response = await fetch(GITHUB_LATEST_RELEASE_API, {
            headers: { 'User-Agent': 'ntut-drone-web', Accept: 'application/vnd.github+json' },
            cf: { cacheTtl: 600, cacheEverything: true },
            signal: AbortSignal.timeout(3000)
        });
        if (!response.ok) return null;
        const data = await response.json();
        const version = /^desktop-v(\d{1,4}\.\d{1,4}\.\d{1,4})$/.exec(String(data?.tag_name || ''))?.[1];
        if (!version || data.draft) return null;
        const assets = Array.isArray(data.assets) ? data.assets : [];
        const asset = pattern => {
            const link = assets.find(item => pattern.test(String(item?.name || '')))?.browser_download_url;
            return typeof link === 'string' && link.startsWith('https://github.com/') ? link : null;
        };
        const url = asset(/^ClubDesk-Setup-.*\.exe$/i);
        return url ? { version, url, win7Url: asset(/^ClubDesk-Win7-Setup-.*\.exe$/i), apkUrl: asset(/\.apk$/i) } : null;
    } catch {
        return null;
    }
}

// Returns a Response for /api/desktop/version and the public /download page, or null for any other path.
export async function handleDesktopRequest(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // ==================== Desktop program update check ====================
    // The desktop program (desktop/) asks this on start-up. Public, so it can be
    // checked before signing in; only the president publishes a new release.
    if (path === '/api/desktop/version' && ['GET', 'PUT'].includes(method)) {
        if (method === 'GET') {
            const release = parseDesktopRelease(await env.DRONE_DB.get(DESKTOP_RELEASE_KEY));
            return Response.json(release || { version: null }, { headers: { 'Cache-Control': 'no-store' } });
        }
        // GitHub Actions announces each automatic release with DESKTOP_RELEASE_TOKEN
        // (a Worker secret, at least 32 characters); people still need a president session.
        const bearer = /^Bearer (.+)$/.exec(request.headers.get('Authorization') || '')?.[1] || '';
        const token = String(env.DESKTOP_RELEASE_TOKEN || '');
        const automated = bearer !== '' && token.length >= 32 && constantTimeEqual(bearer, token);
        let publisher = 'github-actions';
        if (!automated) {
            if (bearer) return Response.json({ error: '發布權杖無效' }, { status: 401 });
            const user = await sessionUser(request, env);
            if (!user) return Response.json({ error: '未授權' }, { status: 401 });
            if (!canManageUsers(user)) return Response.json({ error: '只有社長可以發布桌面程式更新' }, { status: 403 });
            publisher = user.username;
        }
        const release = normalizeDesktopRelease(await readJsonObject(request, 16 * 1024), publisher);
        const current = parseDesktopRelease(await env.DRONE_DB.get(DESKTOP_RELEASE_KEY));
        // An automatic release never replaces a newer one (the president can still roll back by hand).
        if (automated && current && compareVersions(release.version, current.version) < 0) {
            return Response.json({ error: `網站上已是較新的 ${current.version}`, current }, { status: 409 });
        }
        // Keep "required update" when the president had set it for the same version.
        if (automated && current?.version === release.version && current.mandatory) release.mandatory = true;
        await env.DRONE_DB.put(DESKTOP_RELEASE_KEY, JSON.stringify(release));
        return Response.json(release);
    }

    // ==================== Public download page ====================
    if ((path === '/download' || path === '/download/') && method === 'GET') {
        const stored = parseDesktopRelease(await env.DRONE_DB.get(DESKTOP_RELEASE_KEY));
        const announced = stored && /^https:\/\/github\.com\//.test(String(stored.url || '')) ? stored : null;
        // The announced version lags whenever the automatic announcement fails, so the page
        // also asks GitHub and shows whichever is newer.
        const github = await latestGithubRelease();
        const release = github && (!announced || compareVersions(github.version, announced.version) >= 0)
            ? github : announced && { ...announced, ...(github ? { win7Url: github.win7Url, apkUrl: github.apkUrl } : {}) };
        const html = renderDownloadPage({ lang: url.searchParams.get('lang'), release });
        return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    }

    return null;
}
