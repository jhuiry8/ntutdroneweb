// HTTP routes for 問卷與回饋: the public fill page and API (/survey/<id>, /api/public/surveys/*), and the
// officers' pages and API (/admin/surveys*, /api/surveys*): editor, templates, report, CSV export.
import { canViewCms } from './auth.js';
import { parseCookies } from './request.js';
import { captchaStore, verifyTurnstile } from './session.js';
import { createCaptcha, verifyCaptcha } from './captcha.js';
import { confirmedOf } from './events.js';
import { classStore } from './class-routes.js';
import { surveyStore } from './survey-client.js';
import {
    SurveyError, SURVEY_AUDIENCES, QUESTION_TYPES, SURVEY_TEMPLATES, LIMITS, canFillSurvey, surveyState, validateAnswers,
    computeStats, surveyCsv, publicSurveyView, sha256Hex
} from './surveys.js';
import { renderSurveyPage, renderAdminSurveysPage, renderSurveyReportPage } from './templates/survey.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const html = body => new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } });
const randomHex = bytes => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), value => value.toString(16).padStart(2, '0')).join('');

// Visitors: at most this many submissions per IP per hour, and per survey per day.
const GUEST_PER_IP = 10;
const GUEST_PER_SURVEY_PER_DAY = 500;
const DEVICE_COOKIE_SECONDS = 365 * 86400;
const deviceCookieName = id => `svy_${id.replace(/-/g, '').slice(0, 24)}`;

async function actorFor(request, env, deps) {
    const user = await deps.sessionUser(request, env);
    if (!user) return { username: '', officer: false };
    const members = await deps.readMembers(env);
    const member = user.memberId ? members.find(entry => entry.id === user.memberId) : null;
    return { username: user.username, officer: canViewCms(user), name: member?.name || user.username };
}

function languageOf(request, url) {
    const query = url.searchParams.get('lang');
    if (query === 'en' || query === 'zh') return query;
    return parseCookies(request).lang === 'en' ? 'en' : 'zh';
}

// ---- views ------------------------------------------------------------------

function listRow(survey, responseCount, now) {
    return {
        id: survey.id, title: survey.title, state: surveyState(survey, now), enabled: survey.enabled, audience: survey.audience, audienceLabel: SURVEY_AUDIENCES[survey.audience],
        anonymous: survey.anonymous, opensAt: survey.opensAt, closesAt: survey.closesAt, link: survey.link, questionCount: survey.questions.length,
        responseCount, createdAt: survey.createdAt
    };
}
const adminView = (survey, responseCount, now) => {
    const { salt, ...rest } = survey;
    return { ...rest, state: surveyState(survey, now), responseCount };
};

// People who could have answered, for the response rate: class attendance, or confirmed event registrations.
async function denominatorFor(env, link) {
    if (!link) return { count: null, label: '' };
    try {
        if (link.type === 'class' && env.CLASS_STORE) {
            const found = await classStore(env, '/get', { id: link.id });
            if (found.status === 200) return { count: found.body.attendance.length, label: '簽到人數' };
        }
        if (link.type === 'event' && env.EVENT_STORE) {
            const stub = env.EVENT_STORE.get(env.EVENT_STORE.idFromName('club-events'));
            const response = await stub.fetch('https://event-store/get', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: link.id, actor: { officer: true } }) });
            const body = await response.json();
            if (response.status === 200) return { count: confirmedOf(body.regs).length, label: '報名人數' };
        }
    } catch (error) { console.error('Survey denominator failed', error?.message || String(error)); }
    return { count: null, label: '' };
}

// The linked class or event, to name a feedback survey after it.
async function linkTarget(env, type, id) {
    if (type === 'class') {
        if (!env.CLASS_STORE) throw new SurveyError('尚未設定社課簽到功能', 503);
        const found = await classStore(env, '/get', { id });
        if (found.status !== 200) throw new SurveyError('找不到這場社課', 404);
        const c = found.body;
        return { label: `${c.topic}（${c.date}）`, title: `社課回饋：${c.topic}`, template: 'class-feedback' };
    }
    if (type === 'event') {
        if (!env.EVENT_STORE) throw new SurveyError('尚未設定活動功能', 503);
        const stub = env.EVENT_STORE.get(env.EVENT_STORE.idFromName('club-events'));
        const response = await stub.fetch('https://event-store/get', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, actor: { officer: true } }) });
        const body = await response.json();
        if (response.status !== 200) throw new SurveyError('找不到這個活動', 404);
        return { label: body.event.title, title: `活動回饋：${body.event.title}`, template: 'event-satisfaction' };
    }
    throw new SurveyError('關聯類型必須是社課或活動');
}

// ---- routes -----------------------------------------------------------------

export async function handleSurveyRequest(request, env, deps) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const publicPage = /^\/survey\/([\w-]{1,80})$/.exec(path);
    if (!publicPage && !path.startsWith('/api/public/surveys') && !path.startsWith('/api/surveys') && !path.startsWith('/admin/surveys')) return null;

    // ---- public fill page ----
    if (publicPage && method === 'GET') {
        const lang = languageOf(request, url);
        const response = html(renderSurveyPage({ lang, id: publicPage[1], turnstileSiteKey: env.TURNSTILE_SECRET_KEY ? env.TURNSTILE_SITE_KEY || '' : '' }));
        if (url.searchParams.get('lang') === 'en' || url.searchParams.get('lang') === 'zh') response.headers.append('Set-Cookie', `lang=${lang}; Path=/; Max-Age=31536000; Secure; SameSite=Lax`);
        return response;
    }

    if (path === '/api/public/surveys/captcha' && method === 'GET') {
        if (env.TURNSTILE_SECRET_KEY) return json({ turnstile: env.TURNSTILE_SITE_KEY || '' });
        const captcha = await createCaptcha(captchaStore(env));
        return json({ captchaId: captcha.id, svg: captcha.svg });
    }

    const publicApi = /^\/api\/public\/surveys\/([\w-]{1,80})(\/respond)?$/.exec(path);
    if (publicApi) {
        const [, id, respond] = publicApi;
        const actor = await actorFor(request, env, deps);
        const now = new Date().toISOString();
        const found = await surveyStore(env, 'get', { id });
        if (found.status !== 200) return json({ error: '找不到問卷' }, 404);
        const survey = found.body.survey;
        const cookieName = deviceCookieName(id);
        const deviceToken = /^[a-f0-9]{64}$/.test(parseCookies(request)[cookieName] || '') ? parseCookies(request)[cookieName] : '';
        const identityOf = async token => (actor.username ? `u:${actor.username}` : (token ? `d:${await sha256Hex(token)}` : ''));

        if (!respond) {
            if (method !== 'GET') return json({ error: '方法不允許' }, 405);
            if (!canFillSurvey(survey, actor)) return json({ restricted: true, title: survey.title, requiresLogin: !actor.username, audienceLabel: SURVEY_AUDIENCES[survey.audience] });
            const identity = await identityOf(deviceToken);
            const mine = identity ? (await surveyStore(env, 'mine', { id, identity })).body : { submitted: false, answers: null };
            const { audience: _audience, ...view } = publicSurveyView(survey, now);
            return json({ ...view, signedIn: Boolean(actor.username), needCaptcha: !actor.username, me: mine });
        }

        if (method !== 'POST') return json({ error: '方法不允許' }, 405);
        if (!canFillSurvey(survey, actor)) return json({ error: actor.username ? '這份問卷不開放給您的身分填寫' : '請先登入後再填寫' }, actor.username ? 403 : 401);
        const state = surveyState(survey, now);
        if (state !== 'open') return json({ error: state === 'notStarted' ? '問卷尚未開放' : '問卷已截止' }, 403);
        const input = await deps.readJsonLimited(request, 64 * 1024);
        // Reject bad answers before spending a visitor's CAPTCHA.
        validateAnswers(survey, input?.answers);
        let token = deviceToken;
        if (!actor.username) {
            const ip = request.headers.get('CF-Connecting-IP') || '';
            const allowed = await deps.takeAttempt(env, [
                { key: `survey-guest:${id}:all`, max: GUEST_PER_SURVEY_PER_DAY, windowSeconds: 86400 },
                ...(ip ? [{ key: `survey-guest:ip:${ip}`, max: GUEST_PER_IP, windowSeconds: 3600 }] : [])
            ]);
            if (!allowed) return json({ error: '填寫次數過多，請稍後再試' }, 429);
            const human = env.TURNSTILE_SECRET_KEY
                ? await verifyTurnstile(env, String(input?.turnstileToken || ''), ip)
                : await verifyCaptcha(captchaStore(env), String(input?.captchaId || ''), input?.captcha);
            if (!human) return json({ error: '驗證碼錯誤或已過期，請重新輸入' }, 400);
            token = token || randomHex(32);
        }
        const result = await surveyStore(env, 'submit', { id, actor, answers: input.answers, identity: await identityOf(token) });
        if (result.status >= 400) return json(result.body, result.status);
        const response = json(result.body, result.status);
        if (!actor.username && token && token !== deviceToken) response.headers.append('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; Max-Age=${DEVICE_COOKIE_SECONDS}; Secure; SameSite=Lax`);
        return response;
    }
    if (path.startsWith('/api/public/surveys')) return json({ error: 'Not Found' }, 404);

    // ---- officers ----
    const actor = await actorFor(request, env, deps);
    if (path.startsWith('/admin/surveys')) {
        if (method !== 'GET') return json({ error: '方法不允許' }, 405);
        if (!actor.username) return Response.redirect(`${url.origin}/admin`, 302);
        if (!actor.officer) return new Response('只有幹部可以管理問卷', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        if (path === '/admin/surveys') return html(renderAdminSurveysPage());
        const report = /^\/admin\/surveys\/([\w-]{1,80})\/report$/.exec(path);
        if (report) return html(renderSurveyReportPage(report[1]));
        return new Response('Not Found', { status: 404 });
    }

    if (!actor.username) return json({ error: '未授權' }, 401);
    if (!actor.officer) return json({ error: '只有幹部可以管理問卷' }, 403);
    const now = new Date().toISOString();
    const body = () => deps.readJsonLimited(request, 160 * 1024);

    if (path === '/api/surveys/templates' && method === 'GET') {
        return json({ templates: Object.entries(SURVEY_TEMPLATES).map(([key, template]) => ({ key, name: template.name, description: template.description })) });
    }
    if (path === '/api/surveys' && method === 'GET') {
        const list = (await surveyStore(env, 'list')).body;
        return json({
            surveys: list.map(({ survey, responseCount }) => listRow(survey, responseCount, now)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
            meta: { audiences: SURVEY_AUDIENCES, types: QUESTION_TYPES, limits: LIMITS }
        });
    }
    if (path === '/api/surveys' && method === 'POST') {
        const input = await body();
        const template = input?.template ? SURVEY_TEMPLATES[String(input.template)] : null;
        if (input?.template && !template) return json({ error: '範本不存在' }, 400);
        const result = await surveyStore(env, 'create', { actor, fields: template ? { ...template.build(), ...(input.link ? { link: input.link } : {}) } : input });
        return json(result.status === 201 ? adminView(result.body.survey, 0, now) : result.body, result.status);
    }
    if (path === '/api/surveys/from-link' && method === 'POST') {
        const input = await body();
        const type = String(input?.type || ''), id = String(input?.id || '');
        if (!/^[\w-]{1,80}$/.test(id)) return json({ error: '關聯編號錯誤' }, 400);
        const target = await linkTarget(env, type, id);
        const templateKey = input?.template ? String(input.template) : target.template;
        const template = SURVEY_TEMPLATES[templateKey];
        if (!template) return json({ error: '範本不存在' }, 400);
        const existing = (await surveyStore(env, 'by-link', { type, linkId: id })).body.find(survey => survey.templateKey === templateKey);
        if (existing) return json({ survey: adminView(existing, 0, now), existing: true, url: `${url.origin}/survey/${existing.id}` });
        const result = await surveyStore(env, 'create', { actor, fields: { ...template.build(), title: target.title, link: { type, id, label: target.label } } });
        if (result.status !== 201) return json(result.body, result.status);
        return json({ survey: adminView(result.body.survey, 0, now), existing: false, url: `${url.origin}/survey/${result.body.survey.id}` }, 201);
    }

    const match = /^\/api\/surveys\/([\w-]{1,80})(?:\/(duplicate|report|export\.csv|responses))?$/.exec(path);
    if (!match) return json({ error: 'Not Found' }, 404);
    const [, id, action] = match;

    if (!action) {
        if (method === 'GET') {
            const found = await surveyStore(env, 'get', { id });
            return json(found.status === 200 ? adminView(found.body.survey, found.body.responseCount, now) : found.body, found.status);
        }
        if (method === 'PATCH') {
            const result = await surveyStore(env, 'update', { id, actor, fields: await body() });
            return json(result.status === 200 ? adminView(result.body.survey, result.body.responseCount, now) : result.body, result.status);
        }
        if (method === 'DELETE') { const result = await surveyStore(env, 'delete', { id }); return json(result.body, result.status); }
        return json({ error: '方法不允許' }, 405);
    }
    if (action === 'duplicate' && method === 'POST') {
        const result = await surveyStore(env, 'duplicate', { id, actor });
        return json(result.status === 201 ? adminView(result.body.survey, 0, now) : result.body, result.status);
    }
    if (action === 'responses' && method === 'DELETE') {
        const result = await surveyStore(env, 'clear-responses', { id });
        return json(result.body, result.status);
    }
    if ((action === 'report' || action === 'export.csv') && method === 'GET') {
        const found = await surveyStore(env, 'responses', { id });
        if (found.status !== 200) return json(found.body, found.status);
        const { survey } = found.body;
        // Anonymous surveys: strip identity here too, whatever the store holds.
        const responses = found.body.responses
            .map(response => (survey.anonymous ? { id: response.id, at: response.at, answers: response.answers } : response))
            .sort((a, b) => (survey.anonymous ? 0 : a.at.localeCompare(b.at)));
        if (action === 'export.csv') {
            const name = survey.title.replace(/[^\w一-鿿-]+/g, '_').slice(0, 40) || 'survey';
            return new Response(surveyCsv(survey, responses), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="survey-${encodeURIComponent(name)}.csv"`, 'Cache-Control': 'no-store' } });
        }
        const denominator = await denominatorFor(env, survey.link);
        const { salt, ...publicSurvey } = survey;
        return json({ survey: { ...publicSurvey, state: surveyState(survey, now) }, denominatorLabel: denominator.label, stats: computeStats(survey, responses, denominator.count) });
    }
    return json({ error: '方法不允許' }, 405);
}
