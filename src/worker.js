// NTUT Drone Club - Cloudflare Worker Entry Point (with i18n support)
import { marked } from 'marked';
import { sanitizeContent } from './html.js';
import { MEMBER_LEVELS, semesterOf, parseMemberLevel, parseFeeStatus, validSemester, membershipStatus, receiptFeeType, applyFeeReceipt } from './membership.js';
import { DEFAULT_REGULATIONS } from './regulations.js';
import { REGULATION_KINDS, AMENDMENT_ACTIONS, RegulationRuleError, checkAssembly, checkProposalSource, requirementsFor } from './regulation-rules.js';
import { passwordHash, verifyPassword, constantTimeEqual, PasswordResetRequiredError, validRole, canManageUsers, canEditCms, canViewCms, canManageFinance, canManageMembers, canManageEquipment, publicUser } from './auth.js';
import {
    renderLandingPage,
    renderBlogList,
    renderBlogPost,
    renderCustomPage,
    renderLogin,
    renderAdminDashboard,
    renderPublicLoanForm
} from './templates.js';
import { createCaptcha, verifyCaptcha } from './captcha.js';
import {
    FORM_TYPES,
    LETTER_TYPES,
    MAX_FORM_RECORDS,
    MAX_PUBLIC_FORM_RECORDS,
    DEFAULT_FORM_SETTINGS,
    FormValidationError,
    FormServiceError,
    normalizeFormData,
    normalizePublicLoan,
    normalizeFormSettings,
    formNumberPrefix,
    taipeiToday,
    formTitle,
    renderFormPrint,
    draftOfficialLetter,
    fillFormWithAi,
    aiProvider
} from './forms.js';
export { FormStore } from './form-store.js';
export { SiteStore } from './site-store.js';

// Legacy unsalted admin hash format (migrated to PBKDF2 on first login)
const SALT = 'ntut_drone_salt_123';

// Helper: Hashing password
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + SALT);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const LOGIN_MAX_ATTEMPTS_PER_ACCOUNT = 5;
const LOGIN_MAX_ATTEMPTS_PER_IP = 20;
const LOGIN_LOCKOUT_SECONDS = 900;
const CAPTCHA_MAX_PER_IP = 60;

// CAPTCHA challenges, login counters and the CMS content lists go through one
// serialized Durable Object, so concurrent requests cannot race them.
async function siteStore(env, path, payload = {}) {
    const namespace = env.SITE_STORE;
    const stub = namespace.get(namespace.idFromName('site-security'));
    const response = await stub.fetch(`https://site-store${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const body = await response.json();
    if (response.status >= 500 || response.status === 400) throw new Error(body?.error || 'Site store failed');
    return { status: response.status, body };
}
const captchaStore = env => (path, payload) => siteStore(env, path, payload);

// Atomically takes one attempt from every listed counter; false once any is used up.
async function takeAttempt(env, limits) {
    return (await siteStore(env, '/limit/check', { limits, hit: true })).status === 200;
}
async function giveBackAttempt(env, keys) {
    for (const key of keys) await siteStore(env, '/limit/release', { key });
}

// Helper: Render the login page. When Cloudflare Turnstile is not configured,
// a self-hosted image CAPTCHA is attached so every login attempt needs one.
async function loginPageResponse(env, message = '', status = 200) {
    const captcha = env.TURNSTILE_SECRET_KEY ? null : await createCaptcha(captchaStore(env));
    return new Response(renderLogin(message, env.TURNSTILE_SITE_KEY, captcha), {
        status,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
    });
}

// Verified against when the account does not exist, so a login for an unknown
// username takes as long as one for a real account.
let dummyPasswordHash = null;
async function dummyHash() {
    dummyPasswordHash ??= await passwordHash(crypto.randomUUID());
    return dummyPasswordHash;
}

// Slugs become KV keys and URL path segments, so keep them to a safe charset.
const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

// Helper: Parse Cookies
function parseCookies(request) {
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

// Helper: Check Authentication
async function isAuthenticated(request, env) {
    return !!(await sessionUser(request, env));
}

const FINANCE_BUDGETS_KEY = 'finance:budgets';
const FINANCE_TRANSACTIONS_KEY = 'finance:transactions';
const MEMBERS_KEY = 'members:list';
const MEMBERSHIP_RECEIPTS_KEY = 'members:fee-receipts';
const REGULATIONS_KEY = 'club:regulations';
const REGULATION_AMENDMENTS_KEY = 'club:regulation-amendments';
const NOTES_KEY = 'club:class-notes';
const EQUIPMENT_KEY = 'equipment:assets';
const EQUIPMENT_MIGRATION_KEY = 'equipment:durable-object-migrated';
const FORM_SETTINGS_KEY = 'forms:settings';
const AI_DAILY_LIMIT = 30;

// Every signed-in account can fill in forms. Officers see everyone's forms;
// members see only their own. Only the author or the president may change one.
// Public loan slips (source 'public') have no author account; equipment managers may correct them.
function canSeeForm(user, record) { return canViewCms(user) || (Boolean(record.createdBy) && record.createdBy === user.username); }
function canChangeForm(user, record) {
    if (canManageUsers(user)) return true;
    if (record.source === 'public') return canManageEquipment(user);
    return Boolean(record.createdBy) && record.createdBy === user.username;
}
// The print token of a public slip never leaves the server except to its submitter.
function formRecordView(record) {
    const { accessToken, ...rest } = record;
    return rest;
}

const PUBLIC_LOAN_IP_DAILY_LIMIT = 5;
const PUBLIC_LOAN_DAILY_LIMIT = 200;
const PUBLIC_LOAN_PRINT_DAYS = 3;

async function verifyTurnstile(env, token, ip) {
    if (!env.TURNSTILE_SECRET_KEY) return false;
    if (!token) return false;
    const verification = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST', body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip || '' })
    });
    return verification.ok && (await verification.json()).success === true;
}

// All form records, numbers and quotas go through one serialized Durable Object.
async function formStore(env, path, payload = {}) {
    const namespace = env.FORM_STORE;
    const stub = namespace.get(namespace.idFromName('club-forms'));
    const response = await stub.fetch(`https://form-store${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const body = await response.json();
    if (response.status >= 500) throw new Error(body?.error || 'Form store failed');
    return { status: response.status, body };
}

// One shared daily AI quota per account, taken atomically and refunded if the AI call fails.
async function withAiQuota(env, user, run) {
    const quota = { key: `ai:${user.username}`, limit: AI_DAILY_LIMIT, day: taipeiToday() };
    const taken = await formStore(env, '/quota', quota);
    if (taken.status === 429) return Response.json({ error: `今日 AI 使用已達 ${AI_DAILY_LIMIT} 次上限，請明天再試` }, { status: 429 });
    try {
        return Response.json(await run());
    } catch (error) {
        await formStore(env, '/quota', { ...quota, release: true });
        throw error;
    }
}

async function readFormSettings(env) {
    const stored = await env.DRONE_DB.get(FORM_SETTINGS_KEY);
    return { ...DEFAULT_FORM_SETTINGS, ...(stored ? JSON.parse(stored) : {}) };
}

class FinanceValidationError extends Error {}
class PayloadTooLargeError extends Error {
    constructor(maxBytes) {
        super(`請求資料不可超過 ${maxBytes >= 1_000_000 ? `${Math.round(maxBytes / 1_000_000)} MB` : `${Math.round(maxBytes / 1024)} KB`}`);
    }
}
const DEFAULT_JSON_LIMIT = 256 * 1024;
const CONTENT_JSON_LIMIT = 1_000_000;

async function readJsonLimited(request, maxBytes) {
    const reader = request.body?.getReader();
    if (!reader) throw new FinanceValidationError('請提供 JSON 格式資料');
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
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new FinanceValidationError('JSON 格式錯誤'); }
}

// Reads a size-limited JSON body that must be an object.
async function readJsonObject(request, maxBytes = DEFAULT_JSON_LIMIT) {
    const body = await readJsonLimited(request, maxBytes);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new FinanceValidationError('請提供 JSON 物件');
    return body;
}

function financeAmount(value) {
    const amount = Number(value);
    return Number.isSafeInteger(amount) && amount >= 0 && amount <= 1000000000 ? amount : null;
}

function financeText(value, field, maxLength = 100) {
    const text = String(value ?? '').trim();
    if (!text || text.length > maxLength) throw new FinanceValidationError(`${field} 為必填，且不可超過 ${maxLength} 字`);
    return text;
}

function financeDate(value) {
    const date = String(value ?? '');
    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) throw new FinanceValidationError('日期格式必須為 YYYY-MM-DD');
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.getUTCFullYear() !== Number(match[1]) || parsed.getUTCMonth() + 1 !== Number(match[2]) || parsed.getUTCDate() !== Number(match[3])) throw new FinanceValidationError('日期不存在');
    return date;
}

function parseFinanceList(json) {
    if (!json) return [];
    const list = JSON.parse(json);
    if (!Array.isArray(list)) throw new Error('財務資料格式錯誤');
    return list;
}

function importedDate(value) {
    const match = String(value ?? '').trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
    if (!match) throw new FinanceValidationError('日期格式必須為 YYYY/MM/DD 或 YYYY-MM-DD');
    return financeDate(`${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`);
}

function normalizeMemberInput(body, index = null, defaultJoinedAt = true) {
    const prefix = index === null ? '' : `第 ${index + 1} 筆：`;
    const name = String(body?.name ?? '').trim();
    const studentId = String(body?.studentId ?? '').trim().toUpperCase();
    const email = String(body?.email ?? '').trim().toLowerCase();
    const phone = String(body?.phone ?? '').trim();
    const position = String(body?.position ?? '').trim();
    const note = String(body?.note ?? '').trim();
    if ((!name && !studentId) || name.length > 50 || studentId.length > 30) throw new FinanceValidationError(`${prefix}請至少填寫姓名或學號，且姓名不可超過 50 字、學號不可超過 30 字`);
    if (email.length > 100 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new FinanceValidationError(`${prefix}Email 格式無效或超過 100 字`);
    if (phone.length > 30 || position.length > 60 || note.length > 1000) throw new FinanceValidationError(`${prefix}電話、職務或備註超過允許長度`);
    const joinedAt = String(body?.joinedAt ?? '').trim();
    const level = body?.level ? parseMemberLevel(body.level) : 'member';
    if (!level) throw new FinanceValidationError(`${prefix}社員身分無效（可填 非正式社員、正式社員、籌備幹部、正式幹部）`);
    const feeStatus = body?.feeStatus ? parseFeeStatus(body.feeStatus) : 'unpaid';
    if (!feeStatus) throw new FinanceValidationError(`${prefix}社費狀態無效（可填 未繳費、學期會籍、在學會籍）`);
    let feeSemester = String(body?.feeSemester ?? '').trim();
    if (feeStatus === 'semester' && !feeSemester) feeSemester = semesterOf();
    if (feeStatus !== 'semester') feeSemester = '';
    if (feeSemester && !validSemester(feeSemester)) throw new FinanceValidationError(`${prefix}會籍學期格式須為「115-1」`);
    const trialUses = body?.trialUses === undefined || body?.trialUses === '' || body?.trialUses === null ? 0 : Number(body.trialUses);
    if (!Number.isInteger(trialUses) || trialUses < 0 || trialUses > 99) throw new FinanceValidationError(`${prefix}體驗社課次數需為 0 至 99 的整數`);
    return { name, studentId, email, phone, position, note, joinedAt: joinedAt ? importedDate(joinedAt) : (defaultJoinedAt ? new Date().toISOString().slice(0, 10) : ''), level, feeStatus, feeSemester, trialUses };
}

// Roster entry as shown to officers: stored fields, derived status and the bound login account.
function memberView(member, accountsByMember) {
    return { ...member, status: membershipStatus(member), account: accountsByMember?.get(member.id) || '' };
}

async function listUsers(env) {
    const keys = await env.DRONE_DB.list({ prefix: 'user:' });
    const users = await Promise.all(keys.keys.map(async key => {
        try { return JSON.parse(await env.DRONE_DB.get(key.name)); } catch { return null; }
    }));
    return users.filter(user => user && typeof user.username === 'string');
}

async function accountsByMemberId(env) {
    return new Map((await listUsers(env)).filter(user => user.memberId).map(user => [user.memberId, user.username]));
}

function parseRegulations(json) {
    if (!json) return structuredClone(DEFAULT_REGULATIONS);
    const list = JSON.parse(json);
    if (!Array.isArray(list)) throw new Error('法規資料格式錯誤');
    return list;
}

function regulationKind(regulation) { return REGULATION_KINDS[regulation?.kind] ? regulation.kind : 'bylaw'; }

function rocDate(date) {
    const [year, month, day] = date.slice(0, 10).split('-');
    return `${Number(year) - 1911}.${month}.${day}`;
}

// A proposal to amend, create or repeal a regulation. Nothing changes until it is adopted.
function normalizeAmendmentInput(body, regulations) {
    const action = String(body?.action || 'amend');
    if (!AMENDMENT_ACTIONS[action]) throw new FinanceValidationError('修正案類型無效');
    const reason = String(body?.reason ?? '').trim();
    if (!reason || reason.length > 2000) throw new FinanceValidationError('請填寫修正理由（2,000 字以內）');
    let regulation = null, kind;
    if (action === 'create') {
        kind = String(body?.kind || 'bylaw');
        if (!['bylaw', 'school'].includes(kind)) throw new FinanceValidationError('只能制定新的施行細則，或登錄學校法規');
        if (regulations.length >= 50) throw new FinanceValidationError('法規最多 50 份');
    } else {
        regulation = regulations.find(item => item.id === body?.regulationId);
        if (!regulation) throw new FinanceValidationError('找不到要修正的法規');
        if (regulation.repealed) throw new FinanceValidationError('此法規已廢止');
        kind = regulationKind(regulation);
        if (action === 'repeal' && kind === 'charter') throw new FinanceValidationError('組織章程不可廢止；解散社團依章程第十條第四款另行決議');
    }
    const fields = { action, kind, reason, regulationId: regulation?.id || '', baseRevision: regulation ? (regulation.revision || 0) : null, ...checkProposalSource(kind, body?.source, body?.signers) };
    if (kind === 'bylaw') fields.needsAssembly = body?.needsAssembly === true;
    if (action === 'repeal') return { ...fields, title: regulation.title };
    const title = financeText(body?.title ?? regulation?.title, '法規名稱', 120);
    const category = String(body?.category ?? regulation?.category ?? '').trim() || (kind === 'school' ? '學校法規' : '本社規章');
    const content = String(body?.content ?? '').replace(/\r\n?/g, '\n').trim();
    if (category.length > 40) throw new FinanceValidationError('分類超過允許長度');
    if (!content || content.length > 50000) throw new FinanceValidationError('法規內容不可空白，且不可超過 50,000 字');
    if (regulation && content === regulation.content && title === regulation.title) throw new FinanceValidationError('條文沒有任何變更');
    return { ...fields, title, category, content, baseContent: regulation?.content || '' };
}

// The record of how an amendment was passed. Throws when a threshold is not met.
function resolutionFor(amendment, body) {
    const needs = requirementsFor(amendment.kind, amendment.needsAssembly);
    const resolution = {};
    try {
        if (needs.assembly) resolution.assembly = { date: financeDate(body?.assembly?.date), ...checkAssembly(body?.assembly, needs.assembly === 'major') };
        if (needs.officersMeeting) resolution.officersMeetingDate = financeDate(body?.officersMeetingDate);
        if (needs.presidentApproval) resolution.presidentApprovedAt = financeDate(body?.presidentApprovedAt);
        if (needs.schoolAnnouncement) {
            resolution.schoolAnnouncedAt = financeDate(body?.schoolAnnouncedAt);
            resolution.source = financeText(body?.source, '學校公告來源', 200);
        }
        if (needs.school && body?.schoolApprovedAt) resolution.schoolApprovedAt = financeDate(body.schoolApprovedAt);
    } catch (error) {
        if (error instanceof RegulationRuleError) throw new FinanceValidationError(error.message);
        throw error;
    }
    if (resolution.assembly && resolution.officersMeetingDate && resolution.assembly.date < resolution.officersMeetingDate) throw new FinanceValidationError('社員大會日期不可早於幹部會議日期');
    if (resolution.presidentApprovedAt && [resolution.officersMeetingDate, resolution.assembly?.date].some(date => date && resolution.presidentApprovedAt < date)) throw new FinanceValidationError('社長核定日期不可早於幹部會議或社員大會日期');
    if (resolution.schoolApprovedAt && resolution.assembly && resolution.schoolApprovedAt < resolution.assembly.date) throw new FinanceValidationError('學校核備日期不可早於社員大會日期');
    return resolution;
}

function applyAmendment(regulations, amendment, now) {
    const date = amendment.resolution.schoolApprovedAt || amendment.resolution.presidentApprovedAt || amendment.resolution.schoolAnnouncedAt || amendment.resolution.assembly?.date || now.slice(0, 10);
    const version = amendment.versionLabel || `${rocDate(date)} ${AMENDMENT_ACTIONS[amendment.action]}`;
    if (amendment.action === 'create') {
        regulations.push({ id: crypto.randomUUID(), kind: amendment.kind, title: amendment.title, category: amendment.category, version, content: amendment.content, revision: 1, history: [], lastAmendmentId: amendment.id, updatedAt: now });
        return;
    }
    const regulation = regulations.find(item => item.id === amendment.regulationId);
    const history = Array.isArray(regulation.history) ? regulation.history : [];
    history.push({ revision: regulation.revision || 0, version: regulation.version, title: regulation.title, content: regulation.content, replacedAt: now, replacedBy: amendment.id });
    if (history.length > 20) history.splice(0, history.length - 20);
    regulation.history = history;
    regulation.revision = (regulation.revision || 0) + 1;
    regulation.lastAmendmentId = amendment.id;
    regulation.updatedAt = now;
    if (amendment.action === 'repeal') { regulation.repealed = { date, amendmentId: amendment.id }; regulation.version = version; return; }
    Object.assign(regulation, { title: amendment.title, category: amendment.category, content: amendment.content, version });
}

function normalizeEquipmentInput(body) {
    const assetName = financeText(body?.assetName, '設備名稱', 100);
    const category = String(body?.category ?? '').trim() || '其他';
    const serialNo = String(body?.serialNo ?? '').trim();
    const location = String(body?.location ?? '').trim();
    const custodian = String(body?.custodian ?? '').trim();
    const note = String(body?.note ?? '').trim();
    if (category.length > 60 || serialNo.length > 100 || location.length > 100 || custodian.length > 50 || note.length > 1000) throw new FinanceValidationError('設備欄位超過允許長度');
    const purchaseDateRaw = String(body?.purchaseDate ?? '').trim();
    const purchaseDate = purchaseDateRaw ? importedDate(purchaseDateRaw) : '';
    const purchasePrice = body?.purchasePrice === '' || body?.purchasePrice === null || body?.purchasePrice === undefined ? 0 : financeAmount(body.purchasePrice);
    if (purchasePrice === null) throw new FinanceValidationError('購入金額需為 0 至 1,000,000,000 的整數');
    const condition = String(body?.condition || 'good');
    const status = String(body?.status || 'storage');
    if (!['good', 'fair', 'poor'].includes(condition)) throw new FinanceValidationError('設備狀況無效');
    if (!['storage', 'in_use', 'repair', 'retired'].includes(status)) throw new FinanceValidationError('設備狀態無效');
    return { assetName, category, serialNo, purchaseDate, purchasePrice, condition, status, location, custodian, note };
}

function createAssetNumber(existing) {
    const year = new Date().getUTCFullYear();
    for (let attempt = 0; attempt < 5; attempt++) {
        const suffix = Array.from(crypto.getRandomValues(new Uint8Array(5)), value => value.toString(16).padStart(2, '0')).join('').toUpperCase();
        const assetNo = `NTUT-DR-${year}-${suffix}`;
        if (!existing.some(item => item.assetNo === assetNo)) return assetNo;
    }
    throw new Error('Unable to allocate unique asset number');
}

async function equipmentStoreRequest(env, path, payload = {}) {
    const namespace = env.EQUIPMENT_STORE;
    const stub = namespace.get(namespace.idFromName('club-equipment-inventory'));
    if (await env.DRONE_DB.get(EQUIPMENT_MIGRATION_KEY) !== '1') {
        const legacyAssets = parseFinanceList(await env.DRONE_DB.get(EQUIPMENT_KEY));
        const initialized = await stub.fetch('https://equipment-store/initialize', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assets: legacyAssets })
        });
        if (!initialized.ok) return initialized;
        await env.DRONE_DB.put(EQUIPMENT_MIGRATION_KEY, '1');
    }
    return stub.fetch(`https://equipment-store${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
}

function importAmount(value, field) {
    if (value === '' || value === null || value === undefined) return 0;
    const normalized = String(value).replace(/[,$\s]/g, '');
    const amount = Number(normalized);
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1000000000) throw new FinanceValidationError(`${field} 必須為 0 至 1,000,000,000 的整數`);
    return amount;
}

function transactionTotals(transactions) {
    const approved = transactions.filter(item => item.status === 'approved');
    const pending = transactions.filter(item => item.status === 'pending');
    const sum = (items, key) => items.reduce((total, item) => total + (item[key] || 0), 0);
    return {
        cashBalance: sum(approved, 'cashDelta'), postalBalance: sum(approved, 'postalDelta'),
        income: sum(approved, 'income'), expense: sum(approved, 'expense'),
        pendingCount: pending.length, pendingIncome: sum(pending, 'income'), pendingExpense: sum(pending, 'expense')
    };
}

async function sessionUser(request, env) {
    const cookies = parseCookies(request);
    const sessionToken = cookies.session;
    if (!sessionToken) return null;

    const sessionUser = await env.DRONE_DB.get(`session:${sessionToken}`);
    if (!sessionUser) return null;
    if (sessionUser === 'admin') return await env.DRONE_DB.get('user:admin') ? null : { username: 'admin', role: 'president', active: true };
    const session = JSON.parse(sessionUser);
    const userJson = await env.DRONE_DB.get(`user:${session.username}`);
    const user = userJson ? JSON.parse(userJson) : null;
    return user?.active !== false && user?.version === session.version ? user : null;
}

// The pages still use inline scripts and onclick handlers, so 'unsafe-inline'
// is needed for scripts. The policy still blocks plugins, <base> hijacking,
// framing, cross-origin form posts and fetch() to other origins, and only
// loads scripts from this site and Cloudflare Turnstile.
const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' https: data:",
    "connect-src 'self'",
    'frame-src https://challenges.cloudflare.com',
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
].join('; ');

function addSecurityHeaders(response, request) {
    const headers = new Headers(response.headers);
    if (!headers.has('Content-Security-Policy')) headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('X-Frame-Options', 'DENY');
    if (!headers.has('Referrer-Policy')) headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (new URL(request.url).protocol === 'https:') headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
    async fetch(request, env, ctx) {
        const response = await handleRequest(request, env, ctx);
        return addSecurityHeaders(response, request);
    }
};

async function handleRequest(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        try {
            // SameSite cookies are the first CSRF barrier; reject explicit cross-origin
            // browser writes as a second barrier for every state-changing route.
            if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
                const origin = request.headers.get('Origin');
                const fetchSite = request.headers.get('Sec-Fetch-Site');
                let originIsForeign = false;
                if (origin) {
                    try { originIsForeign = new URL(origin).origin !== url.origin; }
                    catch { originIsForeign = true; }
                }
                if (originIsForeign || fetchSite === 'cross-site') return Response.json({ error: '跨來源請求已拒絕' }, { status: 403 });
            }

            // ==================== LANGUAGE DETECTION ====================
            const cookieLang = parseCookies(request).lang;
            const queryLang = url.searchParams.get('lang');
            
            let lang = 'zh';
            if (queryLang === 'en' || queryLang === 'zh') {
                lang = queryLang;
            } else if (cookieLang === 'en' || cookieLang === 'zh') {
                lang = cookieLang;
            }
            // Always default to 'zh' for all visitors unless explicitly toggled

            // Headers helper to append language cookie if updated via query
            const getResponseHeaders = (contentType = 'text/html; charset=utf-8') => {
                const headers = { 'Content-Type': contentType };
                if (queryLang === 'en' || queryLang === 'zh') {
                    // Set language cookie (expires in 1 year)
                    headers['Set-Cookie'] = `lang=${lang}; Path=/; Max-Age=31536000; Secure; SameSite=Lax`;
                }
                return headers;
            };

            // ==================== ROUTE: Home Landing Page ====================
            if (path === '/' && method === 'GET') {
                const postsListJson = await env.DRONE_DB.get('posts_list');
                const postsList = postsListJson ? JSON.parse(postsListJson) : [];
                
                // Filter posts by language
                const filteredPosts = postsList.filter(p => (p.lang || 'zh') === lang);
                const latestPosts = filteredPosts.slice(0, 3);

                // Read homepage content override from KV
                const homepageJson = await env.DRONE_DB.get('homepage_content');
                const homepageOverride = homepageJson ? JSON.parse(homepageJson) : {};
                
                return new Response(renderLandingPage(latestPosts, lang, homepageOverride), {
                    headers: getResponseHeaders()
                });
            }

            // ==================== ROUTE: Blog List ====================
            if (path === '/blog' && method === 'GET') {
                const postsListJson = await env.DRONE_DB.get('posts_list');
                const postsList = postsListJson ? JSON.parse(postsListJson) : [];
                
                // Filter by language
                const filteredPosts = postsList.filter(p => (p.lang || 'zh') === lang);
                
                return new Response(renderBlogList(filteredPosts, lang), {
                    headers: getResponseHeaders()
                });
            }

            // ==================== ROUTE: Blog Post Detail ====================
            if (path.startsWith('/blog/') && method === 'GET') {
                const slug = path.substring(6);
                let postJson = await env.DRONE_DB.get(`post:${slug}`);
                if (!postJson) {
                    const postsListJson = await env.DRONE_DB.get('posts_list');
                    if (postsListJson) {
                        try {
                            const postsList = JSON.parse(postsListJson);
                            const found = postsList.find(p => p.slug === slug);
                            if (found) {
                                postJson = JSON.stringify({
                                    title: found.title || '',
                                    lang: found.lang || 'zh',
                                    slug: found.slug || slug,
                                    summary: found.summary || '',
                                    content: found.content || found.summary || '',
                                    date: found.date || new Date().toISOString()
                                });
                            }
                        } catch (e) {}
                    }
                }

                if (!postJson) {
                    return new Response('文章未找到 Article Not Found', { status: 404 });
                }
                const post = JSON.parse(postJson);
                
                // Set page lang from post lang if available
                const postLang = post.lang || 'zh';
                
                const contentHtml = marked.parse(post.content || '');
                return new Response(renderBlogPost(post, contentHtml, postLang), {
                    headers: getResponseHeaders()
                });
            }

            // ==================== ROUTE: Custom Dynamic Page ====================
            if (path.startsWith('/page/') && method === 'GET') {
                const slug = path.substring(6);
                const pageJson = await env.DRONE_DB.get(`page:${slug}`);
                if (!pageJson) {
                    return new Response('頁面未找到 Page Not Found', { status: 404 });
                }
                const page = JSON.parse(pageJson);
                const pageLang = page.lang || 'zh';
                const contentHtml = marked.parse(page.content || '');
                return new Response(renderCustomPage(page, contentHtml, pageLang), {
                    headers: getResponseHeaders()
                });
            }

            // ==================== ROUTE: Admin Login / Dashboard ====================
            if (path === '/admin' && method === 'GET') {
                const authed = await isAuthenticated(request, env);
                if (authed) {
                    return Response.redirect(`${url.origin}/admin/dashboard`, 302);
                }
                return loginPageResponse(env);
            }

            if (path === '/admin/dashboard' && method === 'GET') {
                const user = await sessionUser(request, env);
                if (!user) {
                    return Response.redirect(`${url.origin}/admin`, 302);
                }

                if (!canViewCms(user)) {
                    return new Response(renderAdminDashboard([], [], publicUser(user)), {
                        headers: { 'Content-Type': 'text/html; charset=utf-8' }
                    });
                }

                const postsListJson = await env.DRONE_DB.get('posts_list');
                const postsList = postsListJson ? JSON.parse(postsListJson) : [];
                
                const pagesListJson = await env.DRONE_DB.get('pages_list');
                const pagesList = pagesListJson ? JSON.parse(pagesListJson) : [];

                return new Response(renderAdminDashboard(postsList, pagesList, publicUser(user)), {
                    headers: { 'Content-Type': 'text/html; charset=utf-8' }
                });
            }

            // Use the same server-side sanitizer for editor previews and published content.
            if (path === '/api/preview' && method === 'POST') {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                if (!canViewCms(user)) return Response.json({ error: '權限不足' }, { status: 403 });
                const { content } = await readJsonObject(request, CONTENT_JSON_LIMIT);
                if (typeof content !== 'string') return Response.json({ error: '內容格式錯誤' }, { status: 400 });
                return Response.json({ html: sanitizeContent(marked.parse(content)) });
            }

            // ==================== API: Login Action ====================
            if (path === '/api/captcha' && method === 'POST') {
                if (env.TURNSTILE_SECRET_KEY) return Response.json({ error: '未啟用' }, { status: 404 });
                const genKey = `captcha-gen:${request.headers.get('CF-Connecting-IP') || 'unknown'}`;
                if (!(await takeAttempt(env, [{ key: genKey, max: CAPTCHA_MAX_PER_IP, windowSeconds: LOGIN_LOCKOUT_SECONDS }]))) {
                    return Response.json({ error: '請求過於頻繁，請稍後再試' }, { status: 429 });
                }
                return Response.json(await createCaptcha(captchaStore(env)), { headers: { 'Cache-Control': 'no-store' } });
            }

            if (path === '/api/login' && method === 'POST') {
                const formData = await request.formData();
                const username = String(formData.get('username') || '').trim().toLowerCase();
                const password = String(formData.get('password') || '');
                const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
                const attemptsKey = `login-attempts:${username.slice(0, 100)}:${clientIp}`;
                const ipAttemptsKey = `login-attempts-ip:${clientIp}`;
                // Every attempt is counted atomically before anything is checked, so
                // parallel requests cannot all slip in under the limit.
                if (!(await takeAttempt(env, [
                    { key: attemptsKey, max: LOGIN_MAX_ATTEMPTS_PER_ACCOUNT, windowSeconds: LOGIN_LOCKOUT_SECONDS },
                    { key: ipAttemptsKey, max: LOGIN_MAX_ATTEMPTS_PER_IP, windowSeconds: LOGIN_LOCKOUT_SECONDS }
                ]))) {
                    return loginPageResponse(env, '登入嘗試過多，請 15 分鐘後再試。', 429);
                }
                if (env.TURNSTILE_SECRET_KEY) {
                    const token = String(formData.get('cf-turnstile-response') || '');
                    if (!token) {
                        await giveBackAttempt(env, [attemptsKey, ipAttemptsKey]);
                        return loginPageResponse(env, '請完成驗證碼。', 400);
                    }
                    if (!(await verifyTurnstile(env, token, clientIp === 'unknown' ? '' : clientIp))) {
                        await giveBackAttempt(env, [attemptsKey]);
                        return loginPageResponse(env, '驗證碼無效，請重試。', 400);
                    }
                } else if (!(await verifyCaptcha(captchaStore(env), String(formData.get('captcha_id') || ''), formData.get('captcha')))) {
                    // A wrong CAPTCHA still counts against the IP, not against the account.
                    await giveBackAttempt(env, [attemptsKey]);
                    return loginPageResponse(env, '驗證碼錯誤或已過期，請重新輸入。', 400);
                }
                let userJson = await env.DRONE_DB.get(`user:${username}`);
                let user = userJson ? JSON.parse(userJson) : null;
                if (username === 'admin' && !user) {
                    const legacyHash = await env.DRONE_DB.get('admin_password_hash');
                    const initialPassword = env.ADMIN_INITIAL_PASSWORD;
                    if ((legacyHash && await hashPassword(password) === legacyHash) || (!legacyHash && initialPassword?.length >= 8 && password === initialPassword)) {
                        user = { username: 'admin', role: 'president', active: true, passwordHash: await passwordHash(password), version: crypto.randomUUID(), createdAt: new Date().toISOString() };
                        await env.DRONE_DB.put('user:admin', JSON.stringify(user));
                        await env.DRONE_DB.delete('admin_password_hash');
                    }
                }
                // Always run one PBKDF2 derivation so unknown usernames are not faster.
                const passwordOk = await verifyPassword(password, user ? user.passwordHash : await dummyHash());
                if (user && user.active !== false && passwordOk) {
                    await siteStore(env, '/limit/clear', { key: attemptsKey });
                    await giveBackAttempt(env, [ipAttemptsKey]);
                    const token = crypto.randomUUID();
                    await env.DRONE_DB.put(`session:${token}`, JSON.stringify({ username: user.username, version: user.version }), { expirationTtl: 86400 });

                    return new Response('', {
                        status: 302,
                        headers: {
                            'Location': '/admin/dashboard',
                            'Set-Cookie': `session=${token}; Path=/; HttpOnly; Max-Age=86400; Secure; SameSite=Lax`
                        }
                    });
                } else {
                    return loginPageResponse(env, '帳號或密碼不正確，請重新輸入！');
                }
            }

            // ==================== API: Logout Action ====================
            if (path === '/api/logout' && method === 'POST') {
                const cookies = parseCookies(request);
                const sessionToken = cookies.session;
                if (sessionToken) {
                    await env.DRONE_DB.delete(`session:${sessionToken}`);
                }
                return new Response(JSON.stringify({ success: true }), {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/json',
                        'Set-Cookie': 'session=; Path=/; HttpOnly; Max-Age=0; Secure; SameSite=Lax'
                    }
                });
            }

            // ==================== API: Posts CRUD (Admin Auth required) ====================
            if (path.startsWith('/api/posts') && ['POST', 'DELETE', 'GET'].includes(method)) {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                if (method !== 'GET' ? !canEditCms(user) : !canViewCms(user)) return Response.json({ error: '權限不足' }, { status: 403 });

                if (method === 'GET') {
                    const slug = path.substring(11);
                    let postJson = await env.DRONE_DB.get(`post:${slug}`);
                    if (!postJson) {
                        const postsListJson = await env.DRONE_DB.get('posts_list');
                        if (postsListJson) {
                            try {
                                const postsList = JSON.parse(postsListJson);
                                const found = postsList.find(p => p.slug === slug);
                                if (found) {
                                    postJson = JSON.stringify({
                                        title: found.title || '',
                                        lang: found.lang || 'zh',
                                        slug: found.slug || slug,
                                        summary: found.summary || '',
                                        content: found.content || found.summary || '',
                                        date: found.date || new Date().toISOString()
                                    });
                                }
                            } catch (e) {}
                        }
                    }
                    if (!postJson) return new Response(JSON.stringify({ error: '文章不存在' }), { status: 404 });
                    return new Response(postJson, { headers: { 'Content-Type': 'application/json' } });
                }

                if (method === 'DELETE') {
                    const slug = path.substring(11);
                    await env.DRONE_DB.delete(`post:${slug}`);
                    await siteStore(env, '/content-index', { list: 'posts_list', remove: [slug] });
                    
                    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
                }

                if (method === 'POST') {
                    const { title, lang: postLang, slug, summary, content, originalSlug } = await readJsonObject(request, CONTENT_JSON_LIMIT);
                    
                    if (!title || !slug || !content) {
                        return new Response(JSON.stringify({ error: '標題、路徑與內容為必填！' }), { status: 400 });
                    }
                    if (typeof title !== 'string' || typeof content !== 'string' || (summary !== undefined && typeof summary !== 'string') || typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) {
                        return Response.json({ error: '網址代稱只能使用英文字母、數字、底線或連字號（最多 100 字），且需以英數字開頭' }, { status: 400 });
                    }
                    if (originalSlug !== undefined && originalSlug !== null && typeof originalSlug !== 'string') return Response.json({ error: '原網址代稱格式錯誤' }, { status: 400 });

                    if (!originalSlug || originalSlug !== slug) {
                        const existing = await env.DRONE_DB.get(`post:${slug}`);
                        if (existing) {
                            return new Response(JSON.stringify({ error: '該網址代稱已存在。' }), { status: 400 });
                        }
                    }

                    const postData = {
                        title,
                        lang: postLang === 'en' ? 'en' : 'zh',
                        slug,
                        summary,
                        content,
                        date: new Date().toISOString()
                    };

                    await env.DRONE_DB.put(`post:${slug}`, JSON.stringify(postData));
                    if (originalSlug && originalSlug !== slug) await env.DRONE_DB.delete(`post:${originalSlug}`);
                    await siteStore(env, '/content-index', {
                        list: 'posts_list',
                        remove: originalSlug ? [originalSlug] : [],
                        add: { title, lang: postData.lang, slug, summary, date: postData.date },
                        sortByDate: true
                    });

                    return new Response(JSON.stringify({ success: true, post: postData }), { headers: { 'Content-Type': 'application/json' } });
                }
            }

            // ==================== API: Pages CRUD (Admin Auth required) ====================
            if (path.startsWith('/api/pages') && ['POST', 'DELETE', 'GET'].includes(method)) {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                if (method !== 'GET' ? !canEditCms(user) : !canViewCms(user)) return Response.json({ error: '權限不足' }, { status: 403 });

                if (method === 'GET') {
                    const slug = path.substring(11);
                    let pageJson = await env.DRONE_DB.get(`page:${slug}`);
                    if (!pageJson) {
                        const pagesListJson = await env.DRONE_DB.get('pages_list');
                        if (pagesListJson) {
                            try {
                                const pagesList = JSON.parse(pagesListJson);
                                const found = pagesList.find(p => p.slug === slug);
                                if (found) {
                                    pageJson = JSON.stringify({
                                        title: found.title || '',
                                        lang: found.lang || 'zh',
                                        slug: found.slug || slug,
                                        content: found.content || '',
                                        date: found.date || new Date().toISOString()
                                    });
                                }
                            } catch (e) {}
                        }
                    }
                    if (!pageJson) return new Response(JSON.stringify({ error: '頁面不存在' }), { status: 404 });
                    return new Response(pageJson, { headers: { 'Content-Type': 'application/json' } });
                }

                if (method === 'DELETE') {
                    const slug = path.substring(11);
                    await env.DRONE_DB.delete(`page:${slug}`);
                    await siteStore(env, '/content-index', { list: 'pages_list', remove: [slug] });
                    
                    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
                }

                if (method === 'POST') {
                    const { title, lang: pageLang, slug, content, originalSlug } = await readJsonObject(request, CONTENT_JSON_LIMIT);
                    
                    if (!title || !slug || !content) {
                        return new Response(JSON.stringify({ error: '標題、路徑與內容為必填！' }), { status: 400 });
                    }
                    if (typeof title !== 'string' || typeof content !== 'string' || typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) {
                        return Response.json({ error: '頁面路徑只能使用英文字母、數字、底線或連字號（最多 100 字），且需以英數字開頭' }, { status: 400 });
                    }
                    if (originalSlug !== undefined && originalSlug !== null && typeof originalSlug !== 'string') return Response.json({ error: '原頁面路徑格式錯誤' }, { status: 400 });

                    if (!originalSlug || originalSlug !== slug) {
                        const existing = await env.DRONE_DB.get(`page:${slug}`);
                        if (existing) {
                            return new Response(JSON.stringify({ error: '該頁面路徑已存在！' }), { status: 400 });
                        }
                    }

                    const pageData = {
                        title,
                        lang: pageLang === 'en' ? 'en' : 'zh',
                        slug,
                        content
                    };
                    await env.DRONE_DB.put(`page:${slug}`, JSON.stringify(pageData));
                    if (originalSlug && originalSlug !== slug) await env.DRONE_DB.delete(`page:${originalSlug}`);
                    await siteStore(env, '/content-index', {
                        list: 'pages_list',
                        remove: originalSlug ? [originalSlug] : [],
                        add: { title, lang: pageData.lang, slug }
                    });

                    return new Response(JSON.stringify({ success: true, page: pageData }), { headers: { 'Content-Type': 'application/json' } });
                }
            }

            // ==================== API: Change Password ====================
            if (path === '/api/change-password' && method === 'POST') {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                const { oldPassword, newPassword } = await readJsonObject(request);
                if (!await verifyPassword(oldPassword, user.passwordHash)) {
                    return new Response(JSON.stringify({ error: '舊密碼輸入錯誤！' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
                }
                if (typeof newPassword !== 'string' || newPassword.length < 8) return Response.json({ error: '新密碼至少需要 8 個字元' }, { status: 400 });
                user.passwordHash = await passwordHash(newPassword);
                user.version = crypto.randomUUID();
                await env.DRONE_DB.put(`user:${user.username}`, JSON.stringify(user));

                return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
            }

            if (path === '/api/users' && ['GET', 'POST', 'PATCH'].includes(method)) {
                const actor = await sessionUser(request, env);
                if (!actor) return Response.json({ error: '未授權' }, { status: 401 });
                if (!canManageUsers(actor)) return Response.json({ error: '權限不足' }, { status: 403 });
                if (method === 'GET') {
                    const users = await listUsers(env);
                    const members = new Map(parseFinanceList(await env.DRONE_DB.get(MEMBERS_KEY)).map(member => [member.id, member]));
                    return Response.json(users.map(item => {
                        const member = item.memberId ? members.get(item.memberId) : null;
                        return { ...publicUser(item), member: member ? { id: member.id, name: member.name, studentId: member.studentId, status: membershipStatus(member) } : null };
                    }));
                }
                const body = await readJsonObject(request);
                const username = String(body.username || '').trim().toLowerCase();
                if (!/^[a-z0-9._-]{3,40}$/.test(username)) return Response.json({ error: '帳號須為 3–40 位英數字、點、底線或連字號' }, { status: 400 });
                // Binding an account to a roster entry (帳號與社員綁定). One roster entry per account.
                let memberId;
                if (body.memberId !== undefined) {
                    memberId = typeof body.memberId === 'string' ? body.memberId : '';
                    if (memberId) {
                        const members = parseFinanceList(await env.DRONE_DB.get(MEMBERS_KEY));
                        if (!members.some(member => member.id === memberId)) return Response.json({ error: '社員不存在' }, { status: 404 });
                        const owner = (await listUsers(env)).find(item => item.memberId === memberId && item.username !== username);
                        if (owner) return Response.json({ error: `此社員已綁定帳號 ${owner.username}` }, { status: 409 });
                    }
                }
                if (method === 'POST') {
                    if (!validRole(body.role) || typeof body.password !== 'string' || body.password.length < 8) return Response.json({ error: '角色無效或密碼少於 8 字元' }, { status: 400 });
                    if (await env.DRONE_DB.get(`user:${username}`)) return Response.json({ error: '帳號已存在' }, { status: 409 });
                    const user = { username, role: body.role, active: true, passwordHash: await passwordHash(body.password), version: crypto.randomUUID(), createdAt: new Date().toISOString(), ...(memberId ? { memberId } : {}) };
                    await env.DRONE_DB.put(`user:${username}`, JSON.stringify(user));
                    return Response.json(publicUser(user), { status: 201 });
                }
                const existing = await env.DRONE_DB.get(`user:${username}`);
                if (!existing) return Response.json({ error: '帳號不存在' }, { status: 404 });
                const user = JSON.parse(existing);
                // Changing only the binding does not sign the person out.
                const onlyBinding = memberId !== undefined && body.role === undefined && body.active === undefined && body.password === undefined;
                if (memberId !== undefined) {
                    if (memberId) user.memberId = memberId; else delete user.memberId;
                }
                if (onlyBinding) {
                    await env.DRONE_DB.put(`user:${username}`, JSON.stringify(user));
                    return Response.json(publicUser(user));
                }
                if (body.role !== undefined) {
                    if (!validRole(body.role)) return Response.json({ error: '角色無效' }, { status: 400 });
                    user.role = body.role;
                }
                if (body.active !== undefined) user.active = body.active === true;
                if (body.password !== undefined) {
                    if (typeof body.password !== 'string' || body.password.length < 8) return Response.json({ error: '密碼至少需要 8 個字元' }, { status: 400 });
                    user.passwordHash = await passwordHash(body.password);
                }
                if (username === 'admin' && (user.role !== 'president' || !user.active)) return Response.json({ error: '不可停用或降權主要管理員' }, { status: 400 });
                if (username === actor.username && !user.active) return Response.json({ error: '不可停用自己' }, { status: 400 });
                user.version = crypto.randomUUID();
                await env.DRONE_DB.put(`user:${username}`, JSON.stringify(user));
                return Response.json(publicUser(user));
            }

            // ==================== API: Finance ledger, budget, import, and review ====================
            if (path === '/api/finance/summary' && method === 'GET') {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                if (!canManageFinance(user)) return Response.json({ error: '權限不足' }, { status: 403 });
                const transactions = parseFinanceList(await env.DRONE_DB.get(FINANCE_TRANSACTIONS_KEY));
                const budgets = parseFinanceList(await env.DRONE_DB.get(FINANCE_BUDGETS_KEY));
                const approved = transactions.filter(item => item.status === 'approved');
                const spentByCategory = Object.fromEntries(budgets.map(item => [item.id, 0]));
                for (const item of approved) if (item.kind === 'expense' && item.budgetId && spentByCategory[item.budgetId] !== undefined) spentByCategory[item.budgetId] += item.expense;
                return Response.json({
                    transactions: transactions.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
                    budgets: budgets.map(item => ({ ...item, spent: spentByCategory[item.id] || 0 })),
                    totals: transactionTotals(transactions)
                });
            }

            if (path === '/api/finance/transactions' && method === 'POST') {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                if (!canManageFinance(user)) return Response.json({ error: '權限不足' }, { status: 403 });
                const body = await readJsonObject(request);
                const kind = String(body.kind || '');
                if (!['income', 'expense', 'transfer'].includes(kind)) return Response.json({ error: '收支類型無效' }, { status: 400 });
                const amount = financeAmount(body.amount);
                if (!amount) return Response.json({ error: '金額必須為 1 至 1,000,000,000 的整數' }, { status: 400 });
                const account = String(body.account || 'cash');
                if (!['cash', 'postal'].includes(account)) return Response.json({ error: '帳戶無效' }, { status: 400 });
                const item = financeText(body.item, '事由', 120);
                const date = financeDate(body.date);
                const transaction = {
                    id: crypto.randomUUID(), date, item, kind, amount,
                    income: kind === 'income' ? amount : 0, expense: kind === 'expense' ? amount : 0,
                    cashDelta: kind === 'transfer' ? (account === 'cash' ? -amount : amount) : (account === 'cash' ? (kind === 'income' ? amount : -amount) : 0),
                    postalDelta: kind === 'transfer' ? (account === 'cash' ? amount : -amount) : (account === 'postal' ? (kind === 'income' ? amount : -amount) : 0),
                    budgetId: typeof body.budgetId === 'string' ? body.budgetId : '', status: 'pending',
                    createdBy: user.username, createdAt: new Date().toISOString(), source: 'manual'
                };
                const transactions = parseFinanceList(await env.DRONE_DB.get(FINANCE_TRANSACTIONS_KEY));
                transactions.push(transaction);
                await env.DRONE_DB.put(FINANCE_TRANSACTIONS_KEY, JSON.stringify(transactions));
                return Response.json(transaction, { status: 201 });
            }

            if (path.startsWith('/api/finance/transactions/') && path.endsWith('/review') && method === 'PATCH') {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                if (!canManageUsers(user)) return Response.json({ error: '僅社長可審核收支' }, { status: 403 });
                const id = path.slice('/api/finance/transactions/'.length, -'/review'.length);
                const body = await readJsonObject(request);
                const status = body.status === 'approved' || body.status === 'rejected' ? body.status : null;
                if (!status) return Response.json({ error: '審核結果無效' }, { status: 400 });
                const transactions = parseFinanceList(await env.DRONE_DB.get(FINANCE_TRANSACTIONS_KEY));
                const transaction = transactions.find(item => item.id === id);
                if (!transaction) return Response.json({ error: '帳目不存在' }, { status: 404 });
                if (transaction.status !== 'pending') return Response.json({ error: '此帳目已完成審核' }, { status: 409 });
                transaction.status = status;
                transaction.reviewedBy = user.username;
                transaction.reviewedAt = new Date().toISOString();
                transaction.reviewNote = status === 'rejected' ? financeText(body.note, '退回原因', 200) : '';
                await env.DRONE_DB.put(FINANCE_TRANSACTIONS_KEY, JSON.stringify(transactions));
                return Response.json(transaction);
            }

            if (path.startsWith('/api/finance/transactions/') && method === 'DELETE') {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                if (!canManageFinance(user)) return Response.json({ error: '權限不足' }, { status: 403 });
                const id = path.slice('/api/finance/transactions/'.length);
                if (!id || id.includes('/')) return Response.json({ error: '帳目編號無效' }, { status: 400 });
                const transactions = parseFinanceList(await env.DRONE_DB.get(FINANCE_TRANSACTIONS_KEY));
                const transaction = transactions.find(item => item.id === id);
                if (!transaction) return Response.json({ error: '帳目不存在' }, { status: 404 });
                if (transaction.status !== 'rejected') return Response.json({ error: '只有已退回帳目可以刪除' }, { status: 409 });
                await env.DRONE_DB.put(FINANCE_TRANSACTIONS_KEY, JSON.stringify(transactions.filter(item => item.id !== id)));
                return Response.json({ success: true });
            }

            if (path === '/api/finance/budgets' && ['GET', 'PUT'].includes(method)) {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                if (!canManageFinance(user)) return Response.json({ error: '權限不足' }, { status: 403 });
                if (method === 'GET') return Response.json(parseFinanceList(await env.DRONE_DB.get(FINANCE_BUDGETS_KEY)));
                const { budgets } = await readJsonObject(request);
                if (!Array.isArray(budgets) || budgets.length > 100) return Response.json({ error: '預算最多 100 個分類' }, { status: 400 });
                const names = new Set();
                const normalized = budgets.map(item => {
                    const name = financeText(item.name, '分類名稱', 60);
                    if (names.has(name)) throw new FinanceValidationError('預算分類不可重複');
                    names.add(name);
                    const planned = financeAmount(item.planned);
                    if (planned === null) throw new FinanceValidationError('預算金額無效');
                    return { id: typeof item.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(item.id) ? item.id : crypto.randomUUID(), name, planned };
                });
                await env.DRONE_DB.put(FINANCE_BUDGETS_KEY, JSON.stringify(normalized));
                return Response.json(normalized);
            }

            if (path === '/api/finance/import' && method === 'POST') {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                if (!canManageFinance(user)) return Response.json({ error: '權限不足' }, { status: 403 });
                const { rows } = await readJsonObject(request);
                if (!Array.isArray(rows) || rows.length < 1 || rows.length > 1000) return Response.json({ error: '匯入資料需介於 1 至 1,000 筆' }, { status: 400 });
                let previousCash = 0, previousPostal = 0;
                const imported = rows.map((row, index) => {
                    const date = importedDate(row.date);
                    const item = financeText(row.item, `第 ${index + 1} 列事宜`, 120);
                    const income = importAmount(row.income, `第 ${index + 1} 列收入`);
                    const expense = importAmount(row.expense, `第 ${index + 1} 列支出`);
                    if (income && expense) throw new FinanceValidationError(`第 ${index + 1} 列不可同時填寫收入與支出`);
                    const cashBalance = importAmount(row.cashBalance, `第 ${index + 1} 列現金餘額`);
                    const postalBalance = importAmount(row.postalBalance, `第 ${index + 1} 列郵局餘額`);
                    const cashDelta = cashBalance - previousCash;
                    const postalDelta = postalBalance - previousPostal;
                    previousCash = cashBalance; previousPostal = postalBalance;
                    return { id: crypto.randomUUID(), date, item, kind: income ? 'income' : expense ? 'expense' : 'transfer', amount: income || expense || Math.abs(cashDelta) || Math.abs(postalDelta), income, expense, cashDelta, postalDelta, budgetId: '', status: 'pending', createdBy: user.username, createdAt: new Date().toISOString(), source: 'legacy-spreadsheet' };
                });
                const transactions = parseFinanceList(await env.DRONE_DB.get(FINANCE_TRANSACTIONS_KEY));
                await env.DRONE_DB.put(FINANCE_TRANSACTIONS_KEY, JSON.stringify([...transactions, ...imported]));
                return Response.json({ imported: imported.length, transactions: imported }, { status: 201 });
            }

            // ==================== API: Member directory ====================
            // ==================== API: Equipment inventory ====================
            if (path === '/api/equipment' && ['GET', 'POST'].includes(method)) {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                if (!canManageEquipment(user)) return Response.json({ error: '權限不足' }, { status: 403 });
                if (method === 'GET') {
                    const query = String(url.searchParams.get('q') || '').trim().toLowerCase();
                    return equipmentStoreRequest(env, '/list', { query });
                }
                const body = await readJsonObject(request);
                return equipmentStoreRequest(env, '/create', { fields: body, username: user.username });
            }

            if (path.startsWith('/api/equipment/') && method === 'PATCH') {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                if (!canManageEquipment(user)) return Response.json({ error: '權限不足' }, { status: 403 });
                const id = path.slice('/api/equipment/'.length);
                const body = await readJsonObject(request);
                return equipmentStoreRequest(env, `/update/${encodeURIComponent(id)}`, { fields: body, username: user.username });
            }

            // ==================== API: Club class notes ====================
            if (path === '/api/notes' && ['GET', 'POST'].includes(method)) {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                const notes = parseFinanceList(await env.DRONE_DB.get(NOTES_KEY));
                if (method === 'GET') {
                    if (!canViewCms(user)) return Response.json({ error: '權限不足' }, { status: 403 });
                    return Response.json(notes.sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt)));
                }
                if (!canEditCms(user)) return Response.json({ error: '權限不足' }, { status: 403 });
                const body = await readJsonObject(request);
                const title = financeText(body.title, '社課名稱', 120);
                const date = financeDate(body.date);
                const content = String(body.content ?? '').trim();
                if (content.length > 5000) return Response.json({ error: '備忘內容不可超過 5000 字' }, { status: 400 });
                const links = Array.isArray(body.links) ? body.links : [];
                if (links.length > 20) return Response.json({ error: '每則備忘最多 20 個網址' }, { status: 400 });
                const normalizedLinks = links.map((link, index) => {
                    const label = String(link?.label || '').trim().slice(0, 100);
                    const value = String(link?.url || '').trim();
                    let parsed;
                    try { parsed = new URL(value); } catch { throw new FinanceValidationError(`第 ${index + 1} 個網址格式無效`); }
                    if (!['http:', 'https:'].includes(parsed.protocol) || value.length > 2048) throw new FinanceValidationError(`第 ${index + 1} 個網址僅可使用 http 或 https，且不可超過 2048 字`);
                    return { label: label || value, url: parsed.href };
                });
                const now = new Date().toISOString();
                const note = { id: crypto.randomUUID(), title, date, content, links: normalizedLinks, createdBy: user.username, createdAt: now, updatedAt: now };
                notes.push(note);
                await env.DRONE_DB.put(NOTES_KEY, JSON.stringify(notes));
                return Response.json(note, { status: 201 });
            }

            if (path.startsWith('/api/notes/') && method === 'DELETE') {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                if (!canEditCms(user)) return Response.json({ error: '權限不足' }, { status: 403 });
                const id = path.slice('/api/notes/'.length);
                const notes = parseFinanceList(await env.DRONE_DB.get(NOTES_KEY));
                if (!notes.some(note => note.id === id)) return Response.json({ error: '備忘錄不存在' }, { status: 404 });
                await env.DRONE_DB.put(NOTES_KEY, JSON.stringify(notes.filter(note => note.id !== id)));
                return Response.json({ success: true });
            }

            if (path === '/api/members/import' && method === 'POST') {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                if (!canManageMembers(user)) return Response.json({ error: '權限不足' }, { status: 403 });
                if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) return Response.json({ error: 'Content-Type 必須為 application/json' }, { status: 415 });
                const contentLength = Number(request.headers.get('Content-Length') || 0);
                if (contentLength > 1_000_000) throw new PayloadTooLargeError(1_000_000);
                const body = await readJsonLimited(request, 1_000_000);
                if (!Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > 500) return Response.json({ error: '一次匯入需為 1 至 500 筆資料' }, { status: 400 });
                const members = parseFinanceList(await env.DRONE_DB.get(MEMBERS_KEY));
                const normalized = body.rows.map((row, index) => normalizeMemberInput(row, index));
                const seenIds = new Set(members.map(member => String(member.studentId || '').trim().toUpperCase()).filter(Boolean));
                const seenNames = new Set(members.map(member => String(member.name || '').trim().toLowerCase()).filter(Boolean));
                const seenNamesWithoutId = new Set(members.filter(member => !String(member.studentId || '').trim()).map(member => String(member.name || '').trim().toLowerCase()).filter(Boolean));
                const fresh = [], skipped = [];
                for (let index = 0; index < normalized.length; index++) {
                    const item = normalized[index];
                    const id = item.studentId, name = item.name.toLowerCase();
                    if (id ? (seenIds.has(id) || (name && seenNamesWithoutId.has(name))) : (name && seenNames.has(name))) { skipped.push({ row: index + 1, name: item.name, studentId: id }); continue; }
                    if (id) seenIds.add(id);
                    if (name) { seenNames.add(name); if (!id) seenNamesWithoutId.add(name); }
                    fresh.push(item);
                }
                const now = new Date().toISOString();
                const imported = fresh.map(item => ({ id: crypto.randomUUID(), ...item, createdAt: now, updatedAt: now }));
                if (imported.length) await env.DRONE_DB.put(MEMBERS_KEY, JSON.stringify([...members, ...imported]));
                return Response.json({ imported: imported.length, skipped: skipped.length, skippedRows: skipped }, { status: 201 });
            }

            if (path === '/api/members' && ['GET', 'POST'].includes(method)) {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                if (!canManageMembers(user)) return Response.json({ error: '權限不足' }, { status: 403 });
                const members = parseFinanceList(await env.DRONE_DB.get(MEMBERS_KEY));
                if (method === 'GET') {
                    const query = String(url.searchParams.get('q') || '').trim().toLowerCase();
                    const filter = String(url.searchParams.get('filter') || '');
                    const accounts = await accountsByMemberId(env);
                    let list = members.map(member => memberView(member, accounts));
                    if (query) list = list.filter(member => [member.name, member.studentId, member.email, member.phone, member.note, member.position, member.account].some(value => String(value || '').toLowerCase().includes(query)));
                    if (filter === 'unpaid') list = list.filter(member => member.status.unpaid);
                    else if (filter === 'paid') list = list.filter(member => member.status.paid);
                    else if (filter === 'voting') list = list.filter(member => member.status.voting);
                    else if (filter === 'unbound') list = list.filter(member => !member.account);
                    else if (MEMBER_LEVELS[filter]) list = list.filter(member => member.status.level === filter);
                    return Response.json(list);
                }
                const body = await readJsonObject(request);
                const fields = normalizeMemberInput(body);
                const studentId = fields.studentId;
                if (studentId && members.some(member => String(member.studentId || '').trim().toUpperCase() === studentId)) return Response.json({ error: '學號已存在' }, { status: 409 });
                const member = { id: crypto.randomUUID(), ...fields, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
                members.push(member);
                await env.DRONE_DB.put(MEMBERS_KEY, JSON.stringify(members));
                return Response.json(memberView(member), { status: 201 });
            }

            if (path.startsWith('/api/members/') && method === 'PATCH') {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                if (!canManageMembers(user)) return Response.json({ error: '權限不足' }, { status: 403 });
                const id = path.slice('/api/members/'.length);
                const members = parseFinanceList(await env.DRONE_DB.get(MEMBERS_KEY));
                const member = members.find(item => item.id === id);
                if (!member) return Response.json({ error: '社員不存在' }, { status: 404 });
                const body = await readJsonObject(request);
                const fields = normalizeMemberInput({ ...member, ...body }, null, false);
                const studentId = fields.studentId;
                if (studentId && members.some(item => item.id !== id && String(item.studentId || '').trim().toUpperCase() === studentId)) return Response.json({ error: '學號已存在' }, { status: 409 });
                Object.assign(member, fields, { updatedAt: new Date().toISOString() });
                await env.DRONE_DB.put(MEMBERS_KEY, JSON.stringify(members));
                return Response.json(memberView(member, await accountsByMemberId(env)));
            }

            if (path === '/api/member-fee-receipts' && ['GET', 'POST'].includes(method)) {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                if (!canManageMembers(user)) return Response.json({ error: '權限不足' }, { status: 403 });
                const receipts = parseFinanceList(await env.DRONE_DB.get(MEMBERSHIP_RECEIPTS_KEY));
                if (method === 'GET') return Response.json(receipts.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)));
                const body = await readJsonObject(request);
                let memberId = typeof body.memberId === 'string' ? body.memberId : '';
                const members = parseFinanceList(await env.DRONE_DB.get(MEMBERS_KEY));
                let member = memberId ? members.find(item => item.id === memberId) : null;
                if (memberId && !member) return Response.json({ error: '社員不存在' }, { status: 404 });
                const payerName = String(body.payerName || '').trim() || member?.name || '';
                const studentId = String(body.studentId || '').trim() || member?.studentId || '';
                if ((!payerName && !studentId) || payerName.length > 50 || studentId.length > 30) return Response.json({ error: '繳費者至少需填姓名或學號' }, { status: 400 });
                const amount = financeAmount(body.amount);
                if (!amount) return Response.json({ error: '社費金額必須為 1 至 1,000,000,000 的整數' }, { status: 400 });
                const receiver = financeText(body.receiver, '收款人', 50);
                const date = financeDate(body.date || new Date().toISOString().slice(0, 10));
                const receiptNumber = String(body.receiptNumber || '').trim().slice(0, 80);
                const note = String(body.note || '').trim().slice(0, 500);
                const feeType = receiptFeeType(body.feeType, amount);
                // A receipt for a roster entry (chosen, or matched by student ID) updates that
                // member's fee status, like Django's FeeRecord does for User.fee_status.
                if (!member && studentId) {
                    member = members.find(item => String(item.studentId || '').toUpperCase() === studentId.toUpperCase()) || null;
                    if (member) memberId = member.id;
                }
                const record = { id: crypto.randomUUID(), memberId, payerName, studentId, amount, feeType, semester: semesterOf(date), date, receiver, receiptNumber, note, recordedBy: user.username, createdAt: new Date().toISOString() };
                receipts.push(record);
                await env.DRONE_DB.put(MEMBERSHIP_RECEIPTS_KEY, JSON.stringify(receipts));
                if (member && applyFeeReceipt(member, feeType, date)) {
                    member.updatedAt = new Date().toISOString();
                    await env.DRONE_DB.put(MEMBERS_KEY, JSON.stringify(members));
                    record.memberStatus = membershipStatus(member);
                }
                return Response.json(record, { status: 201 });
            }

            if (path.startsWith('/api/member-fee-receipts/') && method === 'DELETE') {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                if (!canManageMembers(user)) return Response.json({ error: '權限不足' }, { status: 403 });
                const id = path.slice('/api/member-fee-receipts/'.length);
                const receipts = parseFinanceList(await env.DRONE_DB.get(MEMBERSHIP_RECEIPTS_KEY));
                if (!receipts.some(item => item.id === id)) return Response.json({ error: '簽收紀錄不存在' }, { status: 404 });
                await env.DRONE_DB.put(MEMBERSHIP_RECEIPTS_KEY, JSON.stringify(receipts.filter(item => item.id !== id)));
                return Response.json({ success: true });
            }

            if (path.startsWith('/api/members/') && method === 'DELETE') {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                if (!canManageMembers(user)) return Response.json({ error: '權限不足' }, { status: 403 });
                const id = path.slice('/api/members/'.length);
                const members = parseFinanceList(await env.DRONE_DB.get(MEMBERS_KEY));
                if (!members.some(member => member.id === id)) return Response.json({ error: '社員不存在' }, { status: 404 });
                await env.DRONE_DB.put(MEMBERS_KEY, JSON.stringify(members.filter(member => member.id !== id)));
                // Release any login account bound to the removed roster entry.
                for (const account of (await listUsers(env)).filter(item => item.memberId === id)) {
                    delete account.memberId;
                    await env.DRONE_DB.put(`user:${account.username}`, JSON.stringify(account));
                }
                return Response.json({ success: true });
            }

            // ==================== API: Own account and bound member record ====================
            if (path === '/api/me' && method === 'GET') {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                const member = user.memberId ? parseFinanceList(await env.DRONE_DB.get(MEMBERS_KEY)).find(item => item.id === user.memberId) : null;
                const receipts = member ? parseFinanceList(await env.DRONE_DB.get(MEMBERSHIP_RECEIPTS_KEY)).filter(item => item.memberId === member.id)
                    .sort((a, b) => b.date.localeCompare(a.date)).map(({ date, amount, feeType, semester, receiptNumber }) => ({ date, amount, feeType, semester, receiptNumber })) : [];
                return Response.json({
                    ...publicUser(user),
                    member: member ? { name: member.name, studentId: member.studentId, email: member.email, phone: member.phone, position: member.position, joinedAt: member.joinedAt, feeSemester: member.feeSemester || '', status: membershipStatus(member) } : null,
                    feeReceipts: receipts
                });
            }

            // ==================== API: Regulations lookup (法規查詢) ====================
            // Regulations are read-only here. They change only through an amendment that
            // records how it was passed (see regulation-rules.js).
            if (path === '/api/regulations' && method === 'GET') {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                return Response.json(parseRegulations(await env.DRONE_DB.get(REGULATIONS_KEY)));
            }

            if (path === '/api/regulation-amendments' && ['GET', 'POST'].includes(method)) {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                const amendments = parseFinanceList(await env.DRONE_DB.get(REGULATION_AMENDMENTS_KEY));
                if (method === 'GET') return Response.json(amendments.sort((a, b) => b.proposedAt.localeCompare(a.proposedAt)));
                // Officers file proposals on behalf of whoever raised them (committee, petition, officers' meeting).
                if (!canViewCms(user)) return Response.json({ error: '權限不足：修正案由幹部代為登錄' }, { status: 403 });
                if (amendments.filter(item => item.status === 'proposed' || item.status === 'awaiting_school').length >= 30) return Response.json({ error: '進行中的修正案最多 30 件，請先處理既有提案' }, { status: 400 });
                const regulations = parseRegulations(await env.DRONE_DB.get(REGULATIONS_KEY));
                const amendment = { id: crypto.randomUUID(), ...normalizeAmendmentInput(await readJsonObject(request, 300_000), regulations), status: 'proposed', proposedBy: user.username, proposedAt: new Date().toISOString() };
                amendments.push(amendment);
                if (amendments.length > 300) amendments.splice(0, amendments.length - 300);
                await env.DRONE_DB.put(REGULATION_AMENDMENTS_KEY, JSON.stringify(amendments));
                return Response.json(amendment, { status: 201 });
            }

            const amendmentAction = /^\/api\/regulation-amendments\/([^/]+)\/(adopt|school-approval|close)$/.exec(path);
            if (amendmentAction && method === 'POST') {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                const [, id, action] = amendmentAction;
                const amendments = parseFinanceList(await env.DRONE_DB.get(REGULATION_AMENDMENTS_KEY));
                const amendment = amendments.find(item => item.id === decodeURIComponent(id));
                if (!amendment) return Response.json({ error: '修正案不存在' }, { status: 404 });
                const body = await readJsonObject(request);
                const now = new Date().toISOString();
                if (action === 'close') {
                    const outcome = String(body.outcome || '');
                    if (!['rejected', 'withdrawn'].includes(outcome)) return Response.json({ error: '結案方式無效' }, { status: 400 });
                    if (amendment.status !== 'proposed' && !(amendment.status === 'awaiting_school' && outcome === 'rejected')) return Response.json({ error: '此修正案已結案' }, { status: 409 });
                    if (outcome === 'rejected' && !canManageUsers(user)) return Response.json({ error: '只有社長可以登錄未通過結果' }, { status: 403 });
                    if (outcome === 'withdrawn' && !canManageUsers(user) && amendment.proposedBy !== user.username) return Response.json({ error: '只有登錄者或社長可以撤回' }, { status: 403 });
                    const note = String(body.note || '').trim().slice(0, 500);
                    if (outcome === 'rejected' && !note) return Response.json({ error: '請填寫未通過的情形（例如社員大會出席或同意人數未達門檻、學校未核備）' }, { status: 400 });
                    Object.assign(amendment, { status: outcome, closedAt: now, closedBy: user.username, closeNote: note });
                    await env.DRONE_DB.put(REGULATION_AMENDMENTS_KEY, JSON.stringify(amendments));
                    return Response.json(amendment);
                }
                if (!canManageUsers(user)) return Response.json({ error: '只有社長可以登錄表決及核備結果' }, { status: 403 });
                const regulations = parseRegulations(await env.DRONE_DB.get(REGULATIONS_KEY));
                const target = amendment.regulationId ? regulations.find(item => item.id === amendment.regulationId) : null;
                if (amendment.regulationId && (!target || (target.revision || 0) !== amendment.baseRevision)) return Response.json({ error: '此法規在提案後已有其他修正生效，請以最新條文重新提案' }, { status: 409 });
                if (action === 'adopt') {
                    if (amendment.status !== 'proposed') return Response.json({ error: '只有提案中的修正案可以登錄通過' }, { status: 409 });
                    amendment.resolution = resolutionFor(amendment, body);
                    amendment.adoptedAt = now; amendment.adoptedBy = user.username;
                    amendment.versionLabel = String(body.version || '').trim().slice(0, 60);
                    if (amendment.kind === 'charter' && !amendment.resolution.schoolApprovedAt) amendment.status = 'awaiting_school';
                } else {
                    if (amendment.status !== 'awaiting_school') return Response.json({ error: '此修正案不在待學校核備階段' }, { status: 409 });
                    amendment.resolution.schoolApprovedAt = financeDate(body.schoolApprovedAt);
                }
                if (action === 'school-approval' || amendment.status !== 'awaiting_school') {
                    applyAmendment(regulations, amendment, now);
                    amendment.status = 'effective'; amendment.effectiveAt = now;
                    await env.DRONE_DB.put(REGULATIONS_KEY, JSON.stringify(regulations));
                }
                await env.DRONE_DB.put(REGULATION_AMENDMENTS_KEY, JSON.stringify(amendments));
                return Response.json(amendment);
            }

            // ==================== Public equipment loan slip (no login, no AI) ====================
            if (path === '/forms/equipment-loan' && method === 'GET') {
                const captcha = env.TURNSTILE_SECRET_KEY ? null : await createCaptcha(captchaStore(env));
                return new Response(renderPublicLoanForm(env.TURNSTILE_SITE_KEY, captcha), {
                    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
                });
            }

            if (path === '/api/public/equipment-loan' && method === 'POST') {
                const body = await readJsonLimited(request, 32 * 1024);
                const ip = request.headers.get('CF-Connecting-IP') || '';
                // Without Turnstile the self-hosted image CAPTCHA is required instead.
                const human = env.TURNSTILE_SECRET_KEY
                    ? await verifyTurnstile(env, String(body?.turnstileToken || ''), ip)
                    : await verifyCaptcha(captchaStore(env), String(body?.captchaId || ''), body?.captcha);
                if (!human) return Response.json({ error: '驗證碼錯誤或已過期，請重新輸入' }, { status: 400 });
                const day = taipeiToday();
                const data = normalizePublicLoan(body?.data, day);
                const now = new Date().toISOString();
                const accessToken = Array.from(crypto.getRandomValues(new Uint8Array(24)), value => value.toString(16).padStart(2, '0')).join('');
                // Cloudflare always sends CF-Connecting-IP; without it only the site-wide limit applies.
                const quotas = [{ key: 'public-loan:all', limit: PUBLIC_LOAN_DAILY_LIMIT }, ...(ip ? [{ key: `public-loan:ip:${ip}`, limit: PUBLIC_LOAN_IP_DAILY_LIMIT }] : [])];
                const created = await formStore(env, '/create', {
                    day, quotas,
                    numberPrefix: formNumberPrefix('equipment-loan', now),
                    cap: { limit: MAX_PUBLIC_FORM_RECORDS, message: '外部借據已達上限，請聯絡幹部' },
                    record: { id: crypto.randomUUID(), type: 'equipment-loan', source: 'public', title: formTitle('equipment-loan', data), data, createdBy: '', createdAt: now, updatedBy: '', updatedAt: now, accessToken }
                });
                if (created.status !== 201) return Response.json(created.body, { status: created.status });
                return Response.json({ number: created.body.number, printUrl: `/forms/print/${created.body.id}?token=${accessToken}`, printDays: PUBLIC_LOAN_PRINT_DAYS }, { status: 201 });
            }

            const publicPrint = /^\/forms\/print\/([\w-]{1,80})$/.exec(path);
            if (publicPrint && method === 'GET') {
                const found = await formStore(env, '/get', { id: publicPrint[1] });
                const record = found.status === 200 ? found.body : null;
                const token = url.searchParams.get('token') || '';
                const fresh = record && Date.now() - Date.parse(record.createdAt) < PUBLIC_LOAN_PRINT_DAYS * 86400000;
                if (!record || record.source !== 'public' || !record.accessToken || !fresh || !constantTimeEqual(token, record.accessToken)) {
                    return new Response('借據不存在或列印連結已失效，請聯絡幹部。', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
                }
                return new Response(renderFormPrint(record, await readFormSettings(env)), {
                    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' }
                });
            }

            // ==================== Paper forms (fill in online, review on paper) ====================
            if (path === '/api/forms/settings' && ['GET', 'PUT'].includes(method)) {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                if (method === 'GET') {
                    const provider = aiProvider(env);
                    return Response.json({ ...(await readFormSettings(env)), ai: provider ? { provider: provider.name, model: provider.model } : null });
                }
                if (!canManageUsers(user)) return Response.json({ error: '只有社長可以修改表單設定' }, { status: 403 });
                const settings = normalizeFormSettings(await readJsonLimited(request, 16 * 1024));
                await env.DRONE_DB.put(FORM_SETTINGS_KEY, JSON.stringify(settings));
                return Response.json(settings);
            }

            if (path === '/api/forms/ai-letter' && method === 'POST') {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                if (!canViewCms(user)) return Response.json({ error: '只有幹部可以使用 AI 公文產生' }, { status: 403 });
                const body = await readJsonLimited(request, 32 * 1024);
                const plainText = String(body?.text ?? '').trim();
                if (!plainText || plainText.length > 4000) return Response.json({ error: '請輸入 1 至 4000 字的白話內容' }, { status: 400 });
                const docType = LETTER_TYPES.includes(body?.docType) ? body.docType : '函';
                if (!aiProvider(env)) return Response.json({ error: '尚未設定 GROQ_API_KEY，無法使用 AI 公文產生' }, { status: 503 });
                return await withAiQuota(env, user, () => draftOfficialLetter(env, plainText, docType));
            }

            // AI turns a free-text description into form fields; the user reviews them before saving.
            if (path === '/api/forms/ai-fill' && method === 'POST') {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                const body = await readJsonLimited(request, 32 * 1024);
                const type = String(body?.type || '');
                if (!Object.hasOwn(FORM_TYPES, type)) return Response.json({ error: '表單類型無效' }, { status: 400 });
                if (type === 'official-letter' && !canViewCms(user)) return Response.json({ error: '只有幹部可以使用 AI 公文產生' }, { status: 403 });
                const description = String(body?.text ?? '').trim();
                if (!description || description.length > 4000) return Response.json({ error: '請輸入 1 至 4000 字的描述' }, { status: 400 });
                if (!aiProvider(env)) return Response.json({ error: '尚未設定 GROQ_API_KEY，無法使用 AI 協助填寫' }, { status: 503 });
                return await withAiQuota(env, user, () => fillFormWithAi(env, type, description));
            }

            if (path === '/api/forms' && ['GET', 'POST'].includes(method)) {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                if (method === 'GET') {
                    const type = url.searchParams.get('type');
                    const records = (await formStore(env, '/list')).body;
                    const visible = records.filter(record => canSeeForm(user, record) && (!type || record.type === type));
                    return Response.json(visible.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(formRecordView));
                }
                const body = await readJsonLimited(request, 64 * 1024);
                const type = String(body?.type || '');
                if (!Object.hasOwn(FORM_TYPES, type)) return Response.json({ error: '表單類型無效' }, { status: 400 });
                const data = normalizeFormData(type, body.data);
                const now = new Date().toISOString();
                const created = await formStore(env, '/create', {
                    numberPrefix: formNumberPrefix(type, now),
                    cap: { limit: MAX_FORM_RECORDS, message: `表單紀錄已達 ${MAX_FORM_RECORDS} 筆上限，請先刪除舊紀錄` },
                    record: { id: crypto.randomUUID(), type, title: formTitle(type, data), data, createdBy: user.username, createdAt: now, updatedBy: user.username, updatedAt: now }
                });
                return Response.json(created.body, { status: created.status });
            }

            if (path.startsWith('/api/forms/') && ['GET', 'PUT', 'DELETE'].includes(method)) {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                const id = path.slice('/api/forms/'.length);
                const found = await formStore(env, '/get', { id });
                const record = found.status === 200 ? found.body : null;
                if (!record || !canSeeForm(user, record)) return Response.json({ error: '表單不存在' }, { status: 404 });
                if (method === 'GET') return Response.json(formRecordView(record));
                if (!canChangeForm(user, record)) return Response.json({ error: '只有填表人或社長可以修改或刪除此表單' }, { status: 403 });
                if (method === 'DELETE') {
                    const deleted = await formStore(env, '/delete', { id });
                    return Response.json(deleted.body, { status: deleted.status });
                }
                const body = await readJsonLimited(request, 64 * 1024);
                const data = normalizeFormData(record.type, body?.data);
                const updated = await formStore(env, '/update', { id, fields: { data, title: formTitle(record.type, data), updatedBy: user.username, updatedAt: new Date().toISOString() } });
                return Response.json(updated.status === 200 ? formRecordView(updated.body) : updated.body, { status: updated.status });
            }

            if (path.startsWith('/admin/forms/') && method === 'GET') {
                const user = await sessionUser(request, env);
                if (!user) return Response.redirect(`${url.origin}/admin`, 302);
                const settings = await readFormSettings(env);
                const htmlHeaders = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' };
                const blank = /^\/admin\/forms\/blank\/([\w-]+)$/.exec(path);
                if (blank) {
                    if (!Object.hasOwn(FORM_TYPES, blank[1])) return new Response('表單類型不存在', { status: 404 });
                    return new Response(renderFormPrint({ type: blank[1], data: {} }, settings), { headers: htmlHeaders });
                }
                const print = /^\/admin\/forms\/print\/([\w-]{1,80})$/.exec(path);
                if (print) {
                    const found = await formStore(env, '/get', { id: print[1] });
                    if (found.status !== 200 || !canSeeForm(user, found.body)) return new Response('表單不存在', { status: 404 });
                    return new Response(renderFormPrint(found.body, settings), { headers: htmlHeaders });
                }
            }

            // ==================== API: Get Homepage Content ====================
            if (path === '/api/homepage' && method === 'GET') {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                if (!canViewCms(user)) return Response.json({ error: '權限不足' }, { status: 403 });
                const data = await env.DRONE_DB.get('homepage_content');
                return new Response(data || '{}', { headers: { 'Content-Type': 'application/json' } });
            }

            // ==================== API: Save Homepage Content ====================
            if (path === '/api/homepage' && method === 'POST') {
                const user = await sessionUser(request, env);
                if (!user) return Response.json({ error: '未授權' }, { status: 401 });
                if (!canEditCms(user)) return Response.json({ error: '權限不足' }, { status: 403 });
                const body = await readJsonObject(request);
                // Whitelist allowed keys for full homepage customization
                const allowed = [
                    'heroTitle', 'heroDesc', 'heroBadge',
                    'aboutTitle', 'aboutSubtitle',
                    'aboutCard1Title', 'aboutCard1Desc',
                    'aboutCard2Title', 'aboutCard2Desc',
                    'aboutCard3Title', 'aboutCard3Desc',
                    'featuresTitle', 'featuresSubtitle',
                    'feat1Title', 'feat1Desc',
                    'feat2Title', 'feat2Desc',
                    'feat3Title', 'feat3Desc',
                    'feat4Title', 'feat4Desc',
                    'ctaTitle', 'ctaDesc',
                    'lineLink', 'igLink', 'emailLink',
                    'igCard1Tag', 'igCard1Caption', 'igCard1Img', 'igCard1Likes', 'igCard1Comments',
                    'igCard2Tag', 'igCard2Caption', 'igCard2Img', 'igCard2Likes', 'igCard2Comments',
                    'igCard3Tag', 'igCard3Caption', 'igCard3Img', 'igCard3Likes', 'igCard3Comments',
                    'igCard4Tag', 'igCard4Caption', 'igCard4Img', 'igCard4Likes', 'igCard4Comments'
                ];
                const filtered = {};
                allowed.forEach(k => { if (body[k] !== undefined) filtered[k] = String(body[k]); });
                await env.DRONE_DB.put('homepage_content', JSON.stringify(filtered));
                return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
            }

            return new Response('Not Found', { status: 404 });

        } catch (e) {
            if (e instanceof PayloadTooLargeError) return Response.json({ error: e.message }, { status: 413 });
            if (e instanceof FinanceValidationError || e instanceof FormValidationError || e instanceof RegulationRuleError) return Response.json({ error: e.message }, { status: 400 });
            if (e instanceof FormServiceError) return Response.json({ error: e.message }, { status: e.status });
            if (e instanceof PasswordResetRequiredError) {
                if (path === '/api/login') {
                    return loginPageResponse(env, e.message, 409);
                }
                return Response.json({ error: e.message }, { status: 409 });
            }
            console.error('Worker request failed', { path, method, error: e?.message || String(e) });
            return Response.json({ error: '伺服器內部錯誤' }, { status: 500 });
        }
}

export class EquipmentStore {
    constructor(ctx) {
        this.ctx = ctx;
        this.storage = ctx.storage;
    }

    async listAssets(storage = this.storage) {
        const entries = await storage.list({ prefix: 'equipment:asset:', limit: 5001 });
        return [...entries.values()];
    }

    async fetch(request) {
        try {
            if (request.method !== 'POST') return Response.json({ error: '方法不允許' }, { status: 405 });
            const url = new URL(request.url);
            const payload = await request.json();
            const result = await this.storage.transaction(async storage => {
                    if (url.pathname === '/initialize') {
                        if (!(await storage.get('equipment:initialized'))) {
                            for (const asset of Array.isArray(payload.assets) ? payload.assets : []) {
                                if (!asset || typeof asset.id !== 'string' || !/^[\w-]{1,80}$/.test(asset.id) || typeof asset.assetNo !== 'string' || typeof asset.assetName !== 'string') continue;
                                await storage.put(`equipment:asset:${asset.id}`, asset);
                            }
                            await storage.put('equipment:initialized', true);
                        }
                        return { status: 200, body: { success: true } };
                    }
                    if (!(await storage.get('equipment:initialized'))) {
                        return { status: 503, body: { error: '設備儲存尚未初始化' } };
                    }
                    if (url.pathname === '/list') {
                        const query = String(payload.query || '').trim().toLowerCase();
                        const assets = await this.listAssets(storage);
                        return { status: 200, body: query ? assets.filter(asset => [asset.assetNo, asset.assetName, asset.category, asset.serialNo, asset.status, asset.location, asset.custodian, asset.note].some(value => String(value || '').toLowerCase().includes(query))) : assets };
                    }
                    if (url.pathname === '/create') {
                        const assets = await this.listAssets(storage);
                        if (assets.length >= 5000) return { status: 409, body: { error: '設備列管上限為 5,000 件' } };
                        const fields = normalizeEquipmentInput(payload.fields);
                        const serialNo = fields.serialNo.toUpperCase();
                        if (serialNo && assets.some(item => String(item.serialNo || '').trim().toUpperCase() === serialNo)) return { status: 409, body: { error: '原廠序號已列管' } };
                        const now = new Date().toISOString();
                        const asset = { id: crypto.randomUUID(), assetNo: createAssetNumber(assets), ...fields, createdBy: String(payload.username || ''), updatedBy: String(payload.username || ''), createdAt: now, updatedAt: now };
                        await storage.put(`equipment:asset:${asset.id}`, asset);
                        return { status: 201, body: asset };
                    }
                    const updateMatch = /^\/update\/([\w-]{1,80})$/.exec(url.pathname);
                    if (updateMatch) {
                        const id = updateMatch[1];
                        const asset = await storage.get(`equipment:asset:${id}`);
                        if (!asset) return { status: 404, body: { error: '設備不存在' } };
                        const fields = normalizeEquipmentInput({ ...asset, ...(payload.fields || {}) });
                        const serialNo = fields.serialNo.toUpperCase();
                        const previousSerial = String(asset.serialNo || '').trim().toUpperCase();
                        if (serialNo && serialNo !== previousSerial && (await this.listAssets(storage)).some(item => item.id !== id && String(item.serialNo || '').trim().toUpperCase() === serialNo)) return { status: 409, body: { error: '原廠序號已列管' } };
                        Object.assign(asset, fields, { updatedBy: String(payload.username || ''), updatedAt: new Date().toISOString() });
                        await storage.put(`equipment:asset:${id}`, asset);
                        return { status: 200, body: asset };
                    }
                    return { status: 404, body: { error: '設備操作不存在' } };
                });
            return Response.json(result.body, { status: result.status });
        } catch (error) {
            if (error instanceof FinanceValidationError || error instanceof RegulationRuleError) return Response.json({ error: error.message }, { status: 400 });
            console.error('Equipment store operation failed', error?.message || String(error));
            return Response.json({ error: '設備資料操作失敗' }, { status: 500 });
        }
    }
}
