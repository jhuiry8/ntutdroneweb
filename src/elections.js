// Club elections (社團選舉): candidate registration, the public election
// bulletin (選舉公報), voter verification by student ID + name against the
// member roster, and one-person-one-vote secret ballots.
// Storage and the atomic voting steps live in the ElectionStore Durable Object.
import { membershipStatus } from './membership.js';
import { safeUrl } from './html.js';
import { nameKey, studentIdKey } from './election-store.js';
import { renderElectionList, renderElectionPage } from './election-templates.js';

export class ElectionValidationError extends Error {}

const ID_PATTERN = /^[\w-]{1,80}$/;
const VERIFY_IP_LIMIT = { max: 20, windowSeconds: 900 };
const VERIFY_ID_LIMIT = { max: 6, windowSeconds: 900 };
const DEVICE_COOKIE = 'vote_device';
const ELIGIBILITY = { voting: '具表決權之社員（正式幹部，及已繳當學期或在學會籍之正式社員、籌備幹部）', roster: '社員名冊上所有人' };
export const ELECTION_STATUS = { draft: '草稿', published: '已公告（尚未投票）', open: '投票中', closed: '已結束' };

export function canManageElections(user) { return ['president', 'cadre'].includes(user?.role); }

function text(value, field, max, required = false) {
    const result = String(value ?? '').trim();
    if (required && !result) throw new ElectionValidationError(`請填寫${field}`);
    if (result.length > max) throw new ElectionValidationError(`${field}不可超過 ${max} 字`);
    return result;
}

// Accepts "2026-12-01T09:00" (Taipei time, from <input type="datetime-local">) or a full ISO time.
function dateTime(value, field) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const withZone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(raw) ? `${raw}+08:00` : raw;
    const time = Date.parse(withZone);
    if (!Number.isFinite(time)) throw new ElectionValidationError(`${field}格式無效`);
    return new Date(time).toISOString();
}

export function normalizeCandidates(list) {
    if (!Array.isArray(list)) throw new ElectionValidationError('候選人資料格式錯誤');
    if (list.length > 30) throw new ElectionValidationError('候選人最多 30 位');
    const numbers = new Set();
    return list.map((item, index) => {
        const label = `第 ${index + 1} 位候選人：`;
        const number = Number(item?.number ?? index + 1);
        if (!Number.isInteger(number) || number < 1 || number > 99) throw new ElectionValidationError(`${label}號次須為 1 至 99 的整數`);
        if (numbers.has(number)) throw new ElectionValidationError(`${label}號次 ${number} 重複`);
        numbers.add(number);
        const photoUrl = text(item?.photoUrl, `${label}照片網址`, 500);
        if (photoUrl && (!/^https:\/\//i.test(photoUrl) || safeUrl(photoUrl) === '#')) throw new ElectionValidationError(`${label}照片網址須為 https:// 開頭`);
        const id = ID_PATTERN.test(String(item?.id || '')) ? item.id : crypto.randomUUID();
        return {
            id,
            number,
            name: text(item?.name, `${label}姓名`, 50, true),
            department: text(item?.department, `${label}系級`, 50),
            memberId: ID_PATTERN.test(String(item?.memberId || '')) ? item.memberId : '',
            photoUrl,
            slogan: text(item?.slogan, `${label}競選標語`, 100),
            experience: text(item?.experience, `${label}經歷`, 2000),
            platform: text(item?.platform, `${label}政見`, 5000)
        };
    }).sort((a, b) => a.number - b.number);
}

export function normalizeElectionInput(body) {
    const startsAt = dateTime(body?.startsAt, '投票開始時間');
    const endsAt = dateTime(body?.endsAt, '投票截止時間');
    if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) throw new ElectionValidationError('投票截止時間須晚於開始時間');
    const eligibility = body?.eligibility === 'roster' ? 'roster' : 'voting';
    return {
        title: text(body?.title, '選舉名稱', 100, true),
        position: text(body?.position, '選舉職位', 50),
        description: text(body?.description, '選舉說明', 5000),
        startsAt,
        endsAt,
        eligibility,
        oneVotePerDevice: body?.oneVotePerDevice !== false,
        candidates: normalizeCandidates(body?.candidates ?? [])
    };
}

// The frozen electoral roll: who may vote, matched by student ID and name.
export function buildRoll(members, eligibility, today = new Date()) {
    const seen = new Set();
    const roll = [];
    for (const member of Array.isArray(members) ? members : []) {
        const studentId = studentIdKey(member?.studentId);
        const name = nameKey(member?.name);
        if (!studentId || !name || seen.has(studentId)) continue;
        if (eligibility !== 'roster' && !membershipStatus(member, today).voting) continue;
        seen.add(studentId);
        roll.push({ studentId, name, displayName: String(member.name).trim().slice(0, 50) });
    }
    return roll;
}

// What the public bulletin may show: no member IDs, audit data or internal notes.
export function publicElection(election) {
    return {
        id: election.id, title: election.title, position: election.position, description: election.description,
        status: election.status, startsAt: election.startsAt, endsAt: election.endsAt, eligibility: election.eligibility,
        eligibilityLabel: ELIGIBILITY[election.eligibility] || ELIGIBILITY.voting, oneVotePerDevice: election.oneVotePerDevice !== false,
        rollSize: election.rollSize || 0, voterCount: election.voterCount || 0, resultsPublic: Boolean(election.resultsPublic),
        publishedAt: election.publishedAt || '', openedAt: election.openedAt || '', closedAt: election.closedAt || '',
        candidates: (election.candidates || []).map(({ memberId, ...candidate }) => candidate)
    };
}

async function sha256Hex(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function deviceCookie(request) {
    const match = /(?:^|;\s*)vote_device=([a-f0-9]{32,64})(?:;|$)/.exec(request.headers.get('Cookie') || '');
    return match ? match[1] : '';
}

function clip(value, max) { return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max); }

// IP, network and device details recorded with every verification and vote.
// The device ID comes from an HttpOnly cookie; the fingerprint from the page's script.
export async function requestMeta(request, device = {}) {
    const cf = request.cf || {};
    const cookie = deviceCookie(request);
    const fingerprint = /^[a-f0-9]{16,64}$/.test(String(device?.fingerprint || '')) ? device.fingerprint : '';
    return {
        ip: clip(request.headers.get('CF-Connecting-IP') || '', 64),
        country: clip(cf.country || request.headers.get('CF-IPCountry') || '', 8),
        city: clip(cf.city || '', 60),
        asn: Number.isInteger(cf.asn) ? cf.asn : null,
        network: clip(cf.asOrganization || '', 100),
        userAgent: clip(request.headers.get('User-Agent') || '', 300),
        language: clip(request.headers.get('Accept-Language') || '', 100),
        deviceId: cookie ? (await sha256Hex(`vote-device:${cookie}`)).slice(0, 32) : '',
        fingerprint,
        screen: clip(device?.screen, 30),
        timezone: clip(device?.timezone, 60),
        platform: clip(device?.platform, 60),
        touch: Number.isInteger(device?.touch) ? Math.min(Math.max(device.touch, 0), 20) : null
    };
}

export async function electionStore(env, path, payload = {}) {
    const namespace = env.ELECTION_STORE;
    const stub = namespace.get(namespace.idFromName('elections'));
    const response = await stub.fetch(`https://election-store${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const body = await response.json();
    if (response.status >= 500) throw new Error(body?.error || 'Election store failed');
    return { status: response.status, body };
}

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const relay = result => json(result.body, result.status);

// Handles /vote pages and /api/elections, /api/vote routes. Returns null for other paths.
// deps: sessionUser, readJson, readMembers, verifyHuman, takeAttempt, createCaptcha
export async function handleElectionRoute(request, env, deps) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (!path.startsWith('/vote') && !path.startsWith('/api/elections') && !path.startsWith('/api/vote/')) return null;

    // ---------- Public pages ----------
    if (path === '/vote' && method === 'GET') {
        const list = (await electionStore(env, '/list')).body.filter(election => election.status !== 'draft').map(publicElection);
        return new Response(renderElectionList(list), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    const page = /^\/vote\/([\w-]{1,80})$/.exec(path);
    if (page && method === 'GET') {
        const found = await electionStore(env, '/get', { id: page[1] });
        if (found.status !== 200 || found.body.status === 'draft') return new Response('選舉不存在或尚未公告', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        const election = publicElection(found.body);
        const results = election.status === 'closed' && election.resultsPublic ? (await electionStore(env, '/results', { id: election.id })).body : null;
        const captcha = election.status === 'open' && !env.TURNSTILE_SECRET_KEY ? await deps.createCaptcha() : null;
        const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
        if (!deviceCookie(request)) {
            const value = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
            headers.append('Set-Cookie', `${DEVICE_COOKIE}=${value}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`);
        }
        return new Response(renderElectionPage(election, results, env.TURNSTILE_SITE_KEY, captcha), { headers });
    }

    // ---------- Public voting API ----------
    const voteApi = /^\/api\/vote\/([\w-]{1,80})\/(verify|cast)$/.exec(path);
    if (voteApi && method === 'POST') {
        const [, id, step] = voteApi;
        const body = await deps.readJson(request, 16 * 1024);
        const meta = await requestMeta(request, body?.device);
        if (!meta.deviceId) return json({ error: '請允許瀏覽器使用 Cookie 後重新整理頁面再投票（用於確保一台裝置一票）。' }, 400);
        if (step === 'verify') {
            const studentId = studentIdKey(body?.studentId);
            const name = String(body?.name ?? '').trim();
            if (!/^[A-Z0-9]{5,15}$/.test(studentId) || !name || name.length > 50) return json({ error: '請輸入正確的學號與姓名' }, 400);
            if (!(await deps.verifyHuman(body, meta.ip))) return json({ error: '驗證碼錯誤或已過期，請重新輸入' }, 400);
            const limits = [{ key: `vote-verify-id:${id}:${studentId}`, ...VERIFY_ID_LIMIT }];
            if (meta.ip) limits.push({ key: `vote-verify-ip:${meta.ip}`, ...VERIFY_IP_LIMIT });
            if (!(await deps.takeAttempt(limits))) return json({ error: '嘗試次數過多，請 15 分鐘後再試' }, 429);
            return relay(await electionStore(env, '/verify', { id, studentId, name, meta }));
        }
        return relay(await electionStore(env, '/cast', { id, token: String(body?.token || ''), choice: String(body?.choice || ''), meta }));
    }

    // ---------- Admin API ----------
    if (!path.startsWith('/api/elections')) return null;
    const user = await deps.sessionUser(request);
    if (!user) return json({ error: '未授權' }, 401);
    if (!canManageElections(user)) return json({ error: '權限不足' }, 403);

    if (path === '/api/elections' && method === 'GET') return relay(await electionStore(env, '/list'));
    if (path === '/api/elections' && method === 'POST') {
        const fields = normalizeElectionInput(await deps.readJson(request, 256 * 1024));
        const now = new Date().toISOString();
        const election = { id: crypto.randomUUID(), ...fields, status: 'draft', resultsPublic: false, createdBy: user.username, createdAt: now, updatedBy: user.username, updatedAt: now };
        return relay(await electionStore(env, '/create', { election }));
    }
    const item = /^\/api\/elections\/([\w-]{1,80})(?:\/(status|audit|results))?$/.exec(path);
    if (!item) return null;
    const [, id, action] = item;
    if (!action && method === 'PUT') {
        const fields = normalizeElectionInput(await deps.readJson(request, 256 * 1024));
        return relay(await electionStore(env, '/update', { id, fields: { ...fields, updatedBy: user.username, updatedAt: new Date().toISOString() } }));
    }
    if (!action && method === 'DELETE') return relay(await electionStore(env, '/delete', { id }));
    if (action === 'status' && method === 'POST') {
        const body = await deps.readJson(request, 4 * 1024);
        const statusAction = String(body?.action || '');
        // Opening, closing and publishing results are the president's call.
        if (['open', 'close', 'publish-results', 'hide-results'].includes(statusAction) && user.role !== 'president') return json({ error: '只有社長可以開始、結束投票或公布結果' }, 403);
        const payload = { id, action: statusAction, username: user.username };
        if (statusAction === 'open') {
            const found = await electionStore(env, '/get', { id });
            if (found.status !== 200) return relay(found);
            payload.roll = buildRoll(await deps.readMembers(), found.body.eligibility);
        }
        return relay(await electionStore(env, '/status', payload));
    }
    if (action === 'audit' && method === 'GET') return relay(await electionStore(env, '/audit', { id }));
    if (action === 'results' && method === 'GET') return relay(await electionStore(env, '/results', { id }));
    return null;
}
