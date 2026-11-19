// NTUT Drone Club - Cloudflare Worker entry point.
// Each *-routes.js module answers the paths it owns and returns null for the rest;
// this file applies the cross-origin check, tries the modules in turn and maps
// thrown errors to HTTP responses.
import { PasswordResetRequiredError } from './auth.js';
import { RegulationRuleError } from './regulation-rules.js';
import { FormValidationError, FormServiceError } from './forms.js';
import { MeetingError } from './meetings.js';
import { MessageError } from './messages.js';
import { PayloadTooLargeError, readJsonLimited } from './request.js';
import { ValidationError, parseStoredList } from './validation.js';
import { takeAttempt, giveBackAttempt, sessionUser, listUsers } from './session.js';
import { MEMBERS_KEY, REGULATIONS_KEY } from './kv-keys.js';
import { handlePageRequest } from './page-routes.js';
import { handleAuthRequest, loginPageResponse } from './auth-routes.js';
import { handleCmsRequest } from './cms-routes.js';
import { handleFinanceRequest } from './finance-routes.js';
import { handleMemberRequest } from './member-routes.js';
import { handleEquipmentRequest } from './equipment-routes.js';
import { handleRegulationRequest, parseRegulations } from './regulation-routes.js';
import { handleFormRequest, formStore, withAiQuota, aiDailyLimit } from './form-routes.js';
import { handleDesktopRequest } from './desktop-routes.js';
import { handleAiRequest, generateClubReport } from './ai-routes.js';
import { handleMeetingRequest } from './meeting-routes.js';
import { handleMessageRequest } from './message-routes.js';
import { handlePushRequest } from './push-routes.js';
import { equipmentStoreRequest } from './equipment-store.js';
export { EquipmentStore } from './equipment-store.js';
export { FormStore } from './form-store.js';
export { MeetingStore } from './meetings.js';
export { MessageStore } from './messages.js';
export { SiteStore } from './site-store.js';

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

// What the AI routes and the weekly report need from this module.
const aiDeps = {
    sessionUser, readJsonLimited, withAiQuota, formStore, equipmentStoreRequest, aiDailyLimit, takeAttempt, giveBackAttempt,
    readRegulations: async env => parseRegulations(await env.DRONE_DB.get(REGULATIONS_KEY)),
    listUsers, readMembers: async env => parseStoredList(await env.DRONE_DB.get(MEMBERS_KEY))
};

// Tried in order; the first module that recognises the path answers.
const ROUTES = [
    handlePageRequest,
    handleAuthRequest,
    (request, env) => handleAiRequest(request, env, aiDeps),
    (request, env) => handleMeetingRequest(request, env, aiDeps),
    (request, env, ctx) => handleMessageRequest(request, env, aiDeps, ctx),
    (request, env, ctx) => handlePushRequest(request, env, ctx, aiDeps),
    handleCmsRequest,
    handleFinanceRequest,
    handleEquipmentRequest,
    handleMemberRequest,
    handleRegulationRequest,
    handleFormRequest,
    handleDesktopRequest
];

export default {
    async fetch(request, env, ctx) {
        const response = await handleRequest(request, env, ctx);
        return addSecurityHeaders(response, request);
    },
    // Cron trigger (wrangler.toml): builds the weekly club report and posts it to REPORT_WEBHOOK_URL.
    async scheduled(controller, env, ctx) {
        ctx.waitUntil(generateClubReport(env, aiDeps, { trigger: 'cron' }).catch(error => console.error('Weekly report failed', error?.message || String(error))));
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

        for (const route of ROUTES) {
            const response = await route(request, env, ctx);
            if (response) return response;
        }

        return new Response('Not Found', { status: 404 });
    } catch (e) {
        if (e instanceof PayloadTooLargeError) return Response.json({ error: e.message }, { status: 413 });
        if (e instanceof ValidationError || e instanceof FormValidationError || e instanceof RegulationRuleError) return Response.json({ error: e.message }, { status: 400 });
        if (e instanceof FormServiceError) return Response.json({ error: e.message }, { status: e.status });
        if (e instanceof MeetingError) return Response.json({ error: e.message }, { status: e.status });
        if (e instanceof MessageError) return Response.json({ error: e.message }, { status: e.status });
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
