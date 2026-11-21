import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import worker, { SurveyStore, ClassStore, EventStore } from '../src/worker.js';
import { validateAnswers, computeStats, surveyCsv, csvCell, normalizeSurveyFields, surveyState, canFillSurvey, SURVEY_TEMPLATES, SurveyError } from '../src/surveys.js';
import { withSiteStore } from './helpers/site-store.js';

function durableObject(Class) {
    const values = new Map();
    let tail = Promise.resolve();
    const storage = {
        async get(key) { return structuredClone(values.get(key)); },
        async put(key, value) { values.set(key, structuredClone(value)); },
        async delete(keys) { for (const key of [].concat(keys)) values.delete(key); },
        async list({ prefix = '' } = {}) {
            return new Map([...values.entries()].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, structuredClone(v)]));
        },
        transaction(callback) { const result = tail.then(() => callback(storage)); tail = result.catch(() => {}); return result; }
    };
    const object = new Class({ storage });
    return { idFromName: name => name, get: () => ({ fetch: (input, init) => object.fetch(input instanceof Request ? input : new Request(input, init)) }), values };
}

function fixture() {
    const store = new Map();
    const db = {
        async get(key) { return store.get(key) ?? null; },
        async put(key, value) { store.set(key, typeof value === 'string' ? value : JSON.stringify(value)); },
        async delete(key) { store.delete(key); },
        async list({ prefix }) { return { keys: [...store.keys()].filter(name => name.startsWith(prefix)).map(name => ({ name })) }; }
    };
    for (const [username, role] of Object.entries({ president: 'president', cadre1: 'cadre', alice: 'member', bob: 'member' })) {
        store.set(`user:${username}`, JSON.stringify({ username, role, active: true, version: 'v1' }));
        store.set(`session:${username}`, JSON.stringify({ username, version: 'v1' }));
    }
    const env = withSiteStore({ DRONE_DB: db, SURVEY_STORE: durableObject(SurveyStore), CLASS_STORE: durableObject(ClassStore), EVENT_STORE: durableObject(EventStore) });
    const raw = (path, who, method = 'GET', body, headers = {}) => worker.fetch(new Request(`https://example.com${path}`, {
        method,
        headers: { ...(who ? { Cookie: `session=${who}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }), env);
    const request = async (path, who, method = 'GET', body, headers) => {
        const response = await raw(path, who, method, body, headers);
        const type = response.headers.get('Content-Type') || '';
        return { status: response.status, body: type.includes('json') ? await response.json() : await response.text(), headers: response.headers };
    };
    return { request, raw, env };
}

const sampleFields = (extra = {}) => ({
    title: '測試問卷',
    questions: [
        { type: 'single', title: '單選', options: ['甲', '乙', '丙'], required: true },
        { type: 'multi', title: '多選', options: ['A', 'B', 'C'] },
        { type: 'dropdown', title: '下拉', options: ['X', 'Y'] },
        { type: 'short', title: '簡答' },
        { type: 'paragraph', title: '段落' },
        { type: 'rating', title: '星等', scale: 5, style: 'star' },
        { type: 'rating', title: '量表', scale: 10, style: 'scale' },
        { type: 'date', title: '日期' }
    ],
    ...extra
});
const normalized = extra => ({ id: 'sv', salt: 's', ...normalizeSurveyFields(sampleFields(extra)) });
const optionId = (survey, qIndex, label) => survey.questions[qIndex].options.find(o => o.label === label).id;

// ---------- validation ----------

test('question types are validated when a survey is saved', () => {
    assert.throws(() => normalizeSurveyFields({ title: 'x', questions: [{ type: 'nope', title: 'q' }] }), SurveyError);
    assert.throws(() => normalizeSurveyFields({ title: 'x', questions: [{ type: 'single', title: 'q', options: [] }] }), /選項/);
    assert.throws(() => normalizeSurveyFields({ title: 'x', questions: [{ type: 'single', title: 'q', options: ['a', 'a'] }] }), /重複/);
    assert.throws(() => normalizeSurveyFields({ title: 'x', questions: [{ type: 'rating', title: 'q', scale: 7 }] }), /1～5 或 1～10/);
    assert.throws(() => normalizeSurveyFields({ title: '', questions: [{ type: 'short', title: 'q' }] }), /標題/);
    assert.throws(() => normalizeSurveyFields({ title: 'x', questions: [] }), /至少需要一個題目/);
    assert.throws(() => normalizeSurveyFields({ title: 'x', questions: Array.from({ length: 51 }, () => ({ type: 'short', title: 'q' })) }), /最多/);
    assert.throws(() => normalizeSurveyFields({ title: 'x', questions: [{ type: 'short', title: 'q' }], opensAt: '2026-05-02T10:00', closesAt: '2026-05-02T09:00' }), /截止時間/);
    const survey = normalizeSurveyFields(sampleFields({ anonymous: true, allowEdit: true }));
    assert.equal(survey.allowEdit, false, 'anonymous surveys cannot be edited after submit');
    assert.equal(normalizeSurveyFields(sampleFields({ limitOnce: false, allowEdit: true })).allowEdit, false);
    assert.equal(survey.questions[5].scale, 5);
    assert.equal(survey.questions[6].style, 'scale');
});

test('answers are checked per question type, with required questions and length limits', () => {
    const survey = normalized();
    const a = optionId(survey, 0, '甲');
    assert.throws(() => validateAnswers(survey, {}), /必填題目：單選/);
    assert.throws(() => validateAnswers(survey, { [survey.questions[0].id]: '' }), /必填/);
    assert.throws(() => validateAnswers(survey, { [survey.questions[0].id]: 'forged' }), /格式錯誤/);
    assert.throws(() => validateAnswers(survey, { nope: 1, [survey.questions[0].id]: a }), /不存在的題目/);
    const q = i => survey.questions[i].id;
    assert.throws(() => validateAnswers(survey, { [q(0)]: a, [q(1)]: 'A' }), /格式錯誤/);
    assert.throws(() => validateAnswers(survey, { [q(0)]: a, [q(1)]: ['zzz'] }), /格式錯誤/);
    assert.throws(() => validateAnswers(survey, { [q(0)]: a, [q(5)]: 6 }), /格式錯誤/);
    assert.throws(() => validateAnswers(survey, { [q(0)]: a, [q(5)]: 0 }), /格式錯誤/);
    assert.throws(() => validateAnswers(survey, { [q(0)]: a, [q(5)]: 2.5 }), /格式錯誤/);
    assert.throws(() => validateAnswers(survey, { [q(0)]: a, [q(5)]: '3' }), /格式錯誤/);
    assert.throws(() => validateAnswers(survey, { [q(0)]: a, [q(6)]: 11 }), /格式錯誤/);
    assert.throws(() => validateAnswers(survey, { [q(0)]: a, [q(7)]: '2026-02-30' }), /日期/);
    assert.throws(() => validateAnswers(survey, { [q(0)]: a, [q(7)]: '2026/02/01' }), /日期/);
    assert.throws(() => validateAnswers(survey, { [q(0)]: a, [q(3)]: 'x'.repeat(201) }), /不可超過 200/);
    assert.throws(() => validateAnswers(survey, { [q(0)]: a, [q(3)]: 'two\nlines' }), /單行/);
    assert.throws(() => validateAnswers(survey, { [q(0)]: a, [q(4)]: 'x'.repeat(2001) }), /不可超過 2000/);
    assert.throws(() => validateAnswers(survey, { [q(0)]: a, [q(4)]: 'bad\u0000text' }), /格式錯誤/);
    assert.throws(() => validateAnswers(survey, [a]), /答案格式/);
    const clean = validateAnswers(survey, { [q(0)]: a, [q(1)]: [optionId(survey, 1, 'A'), optionId(survey, 1, 'A')], [q(3)]: '  hi  ', [q(5)]: 4, [q(6)]: 10, [q(7)]: '2026-05-01', [q(2)]: '' });
    assert.deepEqual(clean[q(1)], [optionId(survey, 1, 'A')], 'duplicates collapse');
    assert.equal(clean[q(3)], 'hi');
    assert.equal(q(2) in clean, false);
});

test('survey window and audience decide who may fill', () => {
    const survey = { enabled: true, opensAt: '2026-05-01T00:00:00.000Z', closesAt: '2026-05-02T00:00:00.000Z', audience: 'members' };
    assert.equal(surveyState(survey, '2026-04-30T00:00:00.000Z'), 'notStarted');
    assert.equal(surveyState(survey, '2026-05-01T12:00:00.000Z'), 'open');
    assert.equal(surveyState(survey, '2026-05-02T00:00:01.000Z'), 'closed');
    assert.equal(surveyState({ ...survey, enabled: false }, '2026-05-01T12:00:00.000Z'), 'closed');
    assert.equal(canFillSurvey(survey, { username: '' }), false);
    assert.equal(canFillSurvey(survey, { username: 'alice' }), true);
    assert.equal(canFillSurvey({ audience: 'officers' }, { username: 'alice', officer: false }), false);
    assert.equal(canFillSurvey({ audience: 'officers' }, { username: 'c', officer: true }), true);
    assert.equal(canFillSurvey({ audience: 'public' }, { username: '' }), true);
});

test('built-in templates are valid surveys', () => {
    assert.deepEqual(Object.keys(SURVEY_TEMPLATES).sort(), ['class-feedback', 'event-satisfaction', 'join-interest']);
    for (const template of Object.values(SURVEY_TEMPLATES)) assert.ok(normalizeSurveyFields(template.build()).questions.length >= 5);
});

// ---------- statistics ----------

test('statistics: choice counts, multi-select percentages, rating average and distribution', () => {
    const survey = normalized();
    const q = i => survey.questions[i].id;
    const [a, b] = ['甲', '乙'].map(label => optionId(survey, 0, label));
    const responses = [
        { at: '2026-05-01', answers: { [q(0)]: a, [q(1)]: [optionId(survey, 1, 'A'), optionId(survey, 1, 'B')], [q(5)]: 5, [q(3)]: 'great' } },
        { at: '2026-05-01', answers: { [q(0)]: a, [q(1)]: [optionId(survey, 1, 'A')], [q(5)]: 4 } },
        { at: '2026-05-02', answers: { [q(0)]: b, [q(5)]: 4, [q(7)]: '2026-05-09' } },
        { at: '2026-05-02', answers: { [q(0)]: 'removed-option' } }
    ];
    const stats = computeStats(survey, responses, 8);
    assert.equal(stats.responseCount, 4);
    assert.equal(stats.responseRate, 50);
    const single = stats.questions[0];
    assert.equal(single.answered, 4);
    assert.deepEqual(single.options.map(o => [o.label, o.count, o.percent]), [['甲', 2, 50], ['乙', 1, 25], ['丙', 0, 0], ['（已刪除的選項）', 1, 25]]);
    const multi = stats.questions[1];
    assert.equal(multi.answered, 2);
    assert.deepEqual(multi.options.map(o => [o.label, o.count, o.percent]), [['A', 2, 100], ['B', 1, 50], ['C', 0, 0]]);
    const rating = stats.questions[5];
    assert.equal(rating.average, 4.33);
    assert.deepEqual(rating.distribution.map(d => d.count), [0, 0, 0, 2, 1]);
    assert.equal(stats.questions[6].average, null);
    assert.deepEqual(stats.questions[7].dates, [{ date: '2026-05-09', count: 1, percent: 100 }]);
    assert.equal(stats.questions[3].texts[0].text, 'great');
    assert.equal(computeStats(survey, responses, null).responseRate, null);
    assert.equal(computeStats(survey, [], 5).responseRate, 0);
    assert.equal(computeStats(survey, responses, 2).responseRate, 100, 'rate is capped at 100%');
});

test('statistics never include names on anonymous surveys', () => {
    const survey = normalized({ anonymous: true });
    const q = survey.questions[3].id;
    const responses = [{ at: '2026-05-01', by: { username: 'alice', name: '王小明' }, answers: { [survey.questions[0].id]: optionId(survey, 0, '甲'), [q]: 'hello' } }];
    assert.equal(JSON.stringify(computeStats(survey, responses)).includes('王小明'), false);
    const named = normalized();
    assert.equal(computeStats(named, [{ ...responses[0], answers: { [named.questions[3].id]: 'hello' } }]).questions[3].texts[0].by, '王小明');
});

// ---------- CSV ----------

test('csv cells escape quotes and neutralise spreadsheet formulas', () => {
    assert.equal(csvCell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
    for (const lead of ['=', '+', '-', '@']) assert.equal(csvCell(`${lead}1+1`), `'${lead}1+1`);
    assert.equal(csvCell('\t=1'), "'\t=1");
    assert.equal(csvCell('a,b'), '"a,b"');
    assert.equal(csvCell('line1\nline2'), '"line1\nline2"');
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(csvCell('safe'), 'safe');
    assert.equal(csvCell(null), '');
    const survey = normalized();
    const csv = surveyCsv(survey, [{ at: '2026-05-01T02:00:00.000Z', by: { username: 'alice', name: '=cmd|x' }, answers: { [survey.questions[0].id]: optionId(survey, 0, '甲'), [survey.questions[3].id]: '@evil', [survey.questions[1].id]: [optionId(survey, 1, 'A'), optionId(survey, 1, 'C')] } }]);
    assert.ok(csv.startsWith('﻿填寫時間,填寫者,單選'));
    assert.ok(csv.includes("'=cmd|x"));
    assert.ok(csv.includes("'@evil"));
    assert.ok(csv.includes('A; C'));
    assert.ok(csv.includes('2026-05-01 10:00'), 'shown in Taipei time');
});

test('anonymous csv has no respondent column and keeps only the date', () => {
    const survey = normalized({ anonymous: true });
    const csv = surveyCsv(survey, [{ at: '2026-05-01', by: { username: 'alice', name: '王小明' }, answers: { [survey.questions[0].id]: optionId(survey, 0, '乙') } }]);
    assert.equal(csv.includes('填寫者'), false);
    assert.equal(csv.includes('alice') || csv.includes('王小明'), false);
    assert.ok(csv.includes('\r\n2026-05-01,乙'));
});

// ---------- charts ----------

test('charts.js draws labelled inline SVG for pie, bar and column charts', () => {
    const context = vm.createContext({});
    vm.runInContext(fs.readFileSync(new URL('../public/charts.js', import.meta.url), 'utf8'), context);
    const { Charts } = context;
    const pie = Charts.pie([{ label: '甲<script>', value: 3 }, { label: '乙', value: 1 }], { title: '題目', unit: ' 人' });
    assert.ok(pie.includes('<svg') && pie.includes('<path'));
    assert.ok(pie.includes('75%') && pie.includes('25%'), 'percentages are written as text');
    assert.ok(pie.includes('甲&lt;script&gt;') && !pie.includes('<script>'), 'labels are escaped');
    assert.ok(pie.includes('3 人'), 'values are written next to the legend');
    assert.ok(Charts.pie([{ label: 'only', value: 2 }], {}).includes('<circle'), 'a single slice is a full circle');
    assert.ok(Charts.pie([{ label: 'none', value: 0 }], { empty: '尚無資料' }).includes('尚無資料'));
    const bar = Charts.bar([{ label: 'A', value: 2 }, { label: 'B', value: 1 }], { total: 4, unit: ' 人' });
    assert.ok(bar.includes('2 人 · 50%') && bar.includes('1 人 · 25%'), 'percent uses the given total');
    const columns = Charts.columns([1, 2, 3, 4, 5].map((n, i) => ({ label: String(n), value: i })), {});
    assert.equal((columns.match(/<rect/g) || []).length, 4, 'zero-height columns draw no bar');
    assert.ok(Charts.table([{ label: 'A', value: 1 }], {}).includes('<table'));
    const css = Charts.css();
    assert.ok(css.includes('[data-theme="light"]') && css.includes('--ch-1:#3987e5'), 'dark default with a light override');
    assert.equal(Charts.palette.length, 8);
});

// ---------- routes ----------

async function createSurvey(f, fields = sampleFields()) {
    const created = await f.request('/api/surveys', 'cadre1', 'POST', fields);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    return created.body;
}
const answersFor = survey => ({
    [survey.questions[0].id]: survey.questions[0].options[0].id,
    [survey.questions[3].id]: 'nice',
    [survey.questions[5].id]: 5
});
const captchaFor = async f => { const c = f.env.SITE_STORE.issueCaptcha(); return { captchaId: c.captchaId, captcha: c.captcha }; };

test('only officers can manage surveys; the public page reveals no answers or salt', async () => {
    const f = fixture();
    assert.equal((await f.request('/api/surveys', '', 'GET')).status, 401);
    assert.equal((await f.request('/api/surveys', 'alice', 'GET')).status, 403);
    assert.equal((await f.request('/api/surveys', 'alice', 'POST', sampleFields())).status, 403);
    assert.equal((await f.request('/admin/surveys', 'alice')).status, 403);
    assert.equal((await f.raw('/admin/surveys', '')).status, 302);
    assert.equal((await f.request('/admin/surveys', 'cadre1')).status, 200);
    const survey = await createSurvey(f);
    assert.equal('salt' in survey, false);
    for (const path of [`/api/surveys/${survey.id}/report`, `/api/surveys/${survey.id}/export.csv`]) {
        assert.equal((await f.request(path, 'alice')).status, 403);
        assert.equal((await f.request(path, '')).status, 401);
    }
    assert.equal((await f.request(`/api/surveys/${survey.id}`, 'alice', 'PATCH', { title: 'hijack' })).status, 403);
    assert.equal((await f.request(`/api/surveys/${survey.id}`, 'alice', 'DELETE')).status, 403);
    const view = await f.request(`/api/public/surveys/${survey.id}`, '');
    assert.equal(view.status, 200);
    assert.equal(view.body.salt, undefined);
    assert.equal(view.body.createdBy, undefined);
    assert.equal(view.body.me.submitted, false);
    assert.equal((await f.request('/api/public/surveys/nope', '')).status, 404);
    assert.equal((await f.request('/survey/' + survey.id, '')).status, 200);
});

test('audience: members-only and officers-only surveys hide their questions from outsiders', async () => {
    const f = fixture();
    const members = await createSurvey(f, sampleFields({ audience: 'members' }));
    const officers = await createSurvey(f, sampleFields({ audience: 'officers' }));
    const guest = await f.request(`/api/public/surveys/${members.id}`, '');
    assert.equal(guest.body.restricted, true);
    assert.equal(guest.body.requiresLogin, true);
    assert.equal(guest.body.questions, undefined);
    assert.equal((await f.request(`/api/public/surveys/${members.id}`, 'alice')).body.questions.length, 8);
    assert.equal((await f.request(`/api/public/surveys/${officers.id}`, 'alice')).body.restricted, true);
    assert.equal((await f.request(`/api/public/surveys/${officers.id}`, 'cadre1')).body.questions.length, 8);
    const answers = answersFor(members);
    assert.equal((await f.request(`/api/public/surveys/${members.id}/respond`, '', 'POST', { answers })).status, 401);
    assert.equal((await f.request(`/api/public/surveys/${officers.id}/respond`, 'alice', 'POST', { answers: answersFor(officers) })).status, 403);
    assert.equal((await f.request(`/api/public/surveys/${members.id}/respond`, 'alice', 'POST', { answers })).status, 201);
});

test('one response per account; editing only when allowed', async () => {
    const f = fixture();
    const once = await createSurvey(f, sampleFields({ audience: 'members' }));
    const path = `/api/public/surveys/${once.id}/respond`;
    assert.equal((await f.request(path, 'alice', 'POST', { answers: answersFor(once) })).status, 201);
    const again = await f.request(path, 'alice', 'POST', { answers: answersFor(once) });
    assert.equal(again.status, 409);
    assert.match(again.body.error, /填寫過/);
    assert.equal((await f.request(path, 'bob', 'POST', { answers: answersFor(once) })).status, 201);
    assert.equal((await f.request(`/api/public/surveys/${once.id}`, 'alice')).body.me.submitted, true);
    assert.equal((await f.request(`/api/surveys/${once.id}/report`, 'cadre1')).body.stats.responseCount, 2);

    const editable = await createSurvey(f, sampleFields({ audience: 'members', allowEdit: true }));
    const editPath = `/api/public/surveys/${editable.id}/respond`;
    await f.request(editPath, 'alice', 'POST', { answers: answersFor(editable) });
    const prefill = await f.request(`/api/public/surveys/${editable.id}`, 'alice');
    assert.equal(prefill.body.me.answers[editable.questions[3].id], 'nice');
    const changed = await f.request(editPath, 'alice', 'POST', { answers: { ...answersFor(editable), [editable.questions[3].id]: 'changed' } });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.edited, true);
    const report = await f.request(`/api/surveys/${editable.id}/report`, 'cadre1');
    assert.equal(report.body.stats.responseCount, 1, 'an edit replaces the answer instead of adding one');
    assert.equal(report.body.stats.questions[3].texts[0].text, 'changed');

    const repeatable = await createSurvey(f, sampleFields({ audience: 'members', limitOnce: false }));
    for (let i = 0; i < 2; i++) assert.equal((await f.request(`/api/public/surveys/${repeatable.id}/respond`, 'alice', 'POST', { answers: answersFor(repeatable) })).status, 201);
});

test('visitors need the CAPTCHA, are limited once per device and per IP', async () => {
    const f = fixture();
    const survey = await createSurvey(f);
    const path = `/api/public/surveys/${survey.id}/respond`;
    const ip = { 'CF-Connecting-IP': '203.0.113.9' };
    const noCaptcha = await f.request(path, '', 'POST', { answers: answersFor(survey) }, ip);
    assert.equal(noCaptcha.status, 400);
    assert.match(noCaptcha.body.error, /驗證碼/);
    const badAnswers = await f.request(path, '', 'POST', { answers: {} }, ip);
    assert.equal(badAnswers.status, 400, 'answers are checked before the CAPTCHA is spent');
    assert.match(badAnswers.body.error, /必填/);
    const first = await f.request(path, '', 'POST', { answers: answersFor(survey), ...(await captchaFor(f)) }, ip);
    assert.equal(first.status, 201);
    const cookie = first.headers.get('Set-Cookie');
    assert.match(cookie, /svy_[a-f0-9]+=[a-f0-9]{64}; Path=\/; HttpOnly; .*Secure; SameSite=Lax/);
    const deviceCookie = cookie.split(';')[0];
    const second = await f.request(path, '', 'POST', { answers: answersFor(survey), ...(await captchaFor(f)) }, { ...ip, Cookie: deviceCookie });
    assert.equal(second.status, 409);
    assert.equal((await f.request(`/api/public/surveys/${survey.id}`, '', 'GET', undefined, { Cookie: deviceCookie })).body.me.submitted, true);
    // CAPTCHA answers are single use.
    const used = await captchaFor(f);
    await f.request(path, '', 'POST', { answers: answersFor(survey), ...used }, { 'CF-Connecting-IP': '203.0.113.50' });
    assert.equal((await f.request(path, '', 'POST', { answers: answersFor(survey), ...used }, { 'CF-Connecting-IP': '203.0.113.51' })).status, 400);
    // Per-IP rate limit (10 an hour); the 11th attempt is refused before the CAPTCHA is looked at.
    const flood = { 'CF-Connecting-IP': '198.51.100.7' };
    let last;
    for (let i = 0; i < 11; i++) last = await f.request(path, '', 'POST', { answers: answersFor(survey), ...(await captchaFor(f)) }, flood);
    assert.equal(last.status, 429);
});

test('deadline and opening time are enforced', async () => {
    const f = fixture();
    const future = await createSurvey(f, sampleFields({ audience: 'members', opensAt: new Date(Date.now() + 3600000).toISOString() }));
    const past = await createSurvey(f, sampleFields({ audience: 'members', closesAt: new Date(Date.now() - 1000).toISOString(), opensAt: new Date(Date.now() - 7200000).toISOString() }));
    const manual = await createSurvey(f, sampleFields({ audience: 'members', enabled: false }));
    for (const [survey, text] of [[future, /尚未開放/], [past, /已截止/], [manual, /已截止/]]) {
        const response = await f.request(`/api/public/surveys/${survey.id}/respond`, 'alice', 'POST', { answers: answersFor(survey) });
        assert.equal(response.status, 403);
        assert.match(response.body.error, text);
    }
    assert.equal((await f.request(`/api/public/surveys/${past.id}`, 'alice')).body.state, 'closed');
    assert.equal((await f.request(`/api/public/surveys/${future.id}`, 'alice')).body.state, 'notStarted');
    // 'YYYY-MM-DDTHH:mm' from the editor is Taipei time.
    const taipei = await createSurvey(f, sampleFields({ closesAt: '2030-01-01T09:00' }));
    assert.equal(taipei.closesAt, '2030-01-01T01:00:00.000Z');
});

test('anonymous surveys keep nobody\'s identity in storage, report or CSV', async () => {
    const f = fixture();
    const survey = await createSurvey(f, sampleFields({ audience: 'members', anonymous: true, allowEdit: true }));
    assert.equal(survey.allowEdit, false);
    const path = `/api/public/surveys/${survey.id}/respond`;
    assert.equal((await f.request(path, 'alice', 'POST', { answers: answersFor(survey) })).status, 201);
    assert.equal((await f.request(path, 'alice', 'POST', { answers: answersFor(survey) })).status, 409, 'still once per person');
    assert.equal((await f.request(path, 'bob', 'POST', { answers: answersFor(survey) })).status, 201);
    const stored = JSON.stringify([...f.env.SURVEY_STORE.values.entries()].filter(([key]) => key.startsWith('resp:') || key.startsWith('uniq:')));
    assert.equal(/alice|bob/.test(stored), false, 'no username anywhere in responses or markers');
    for (const [key, value] of f.env.SURVEY_STORE.values) if (key.startsWith('resp:')) assert.match(value.at, /^\d{4}-\d{2}-\d{2}$/, 'only the date is kept');
    const report = await f.request(`/api/surveys/${survey.id}/report`, 'cadre1');
    assert.equal(report.body.survey.salt, undefined);
    assert.equal(/alice|bob/.test(JSON.stringify(report.body)), false);
    const csv = await f.request(`/api/surveys/${survey.id}/export.csv`, 'cadre1');
    assert.equal(csv.status, 200);
    assert.equal(/alice|bob|填寫者/.test(csv.body), false);
    assert.equal((await f.request(`/api/public/surveys/${survey.id}`, 'alice')).body.me.answers, null);
});

test('named surveys show who answered in the report and CSV, and the CSV is formula-safe', async () => {
    const f = fixture();
    const survey = await createSurvey(f, sampleFields({ audience: 'members' }));
    await f.request(`/api/public/surveys/${survey.id}/respond`, 'alice', 'POST', { answers: { ...answersFor(survey), [survey.questions[3].id]: '=1+1' } });
    const report = await f.request(`/api/surveys/${survey.id}/report`, 'cadre1');
    assert.equal(report.body.stats.questions[3].texts[0].by, 'alice');
    const csv = await f.request(`/api/surveys/${survey.id}/export.csv`, 'cadre1');
    assert.match(csv.headers.get('Content-Type'), /text\/csv/);
    assert.ok(csv.body.includes(',alice,'));
    assert.ok(csv.body.includes("'=1+1"));
});

test('templates, copy, edit lock and delete', async () => {
    const f = fixture();
    const templates = await f.request('/api/surveys/templates', 'cadre1');
    assert.equal(templates.body.templates.length, 3);
    for (const key of ['class-feedback', 'event-satisfaction', 'join-interest']) {
        const made = await f.request('/api/surveys', 'cadre1', 'POST', { template: key });
        assert.equal(made.status, 201);
        assert.equal(made.body.templateKey, key);
    }
    assert.equal((await f.request('/api/surveys', 'cadre1', 'POST', { template: 'nope' })).status, 400);
    const survey = await createSurvey(f, sampleFields({ link: { type: 'class', id: 'c1', label: 'x' } }));
    await f.request(`/api/public/surveys/${survey.id}/respond`, '', 'POST', { answers: answersFor(survey), ...(await captchaFor(f)) });
    const copy = await f.request(`/api/surveys/${survey.id}/duplicate`, 'cadre1', 'POST', {});
    assert.equal(copy.status, 201);
    assert.equal(copy.body.title, '測試問卷（副本）');
    assert.equal(copy.body.link, null, 'a copy is not linked to the class');
    assert.equal(copy.body.responseCount, 0);
    assert.notEqual(copy.body.questions[0].id, survey.questions[0].id);
    // Answered questions keep their type.
    const locked = await f.request(`/api/surveys/${survey.id}`, 'cadre1', 'PATCH', { questions: survey.questions.map((q, i) => (i === 3 ? { ...q, type: 'paragraph' } : q)) });
    assert.equal(locked.status, 409);
    const relabel = await f.request(`/api/surveys/${survey.id}`, 'cadre1', 'PATCH', { title: '新標題', questions: survey.questions });
    assert.equal(relabel.status, 200);
    assert.equal(relabel.body.title, '新標題');
    assert.equal((await f.request(`/api/surveys/${survey.id}`, 'cadre1', 'DELETE')).status, 200);
    assert.equal((await f.request(`/api/surveys/${survey.id}`, 'cadre1')).status, 404);
    assert.equal([...f.env.SURVEY_STORE.values.keys()].some(key => key.includes(survey.id)), false, 'responses and markers go with the survey');
});

test('response rate uses class attendance; feedback link appears on the check-in page', async () => {
    const f = fixture();
    const classes = f.env.CLASS_STORE.get('club-classes');
    const post = (path, payload) => classes.fetch(`https://class-store${path}`, { method: 'POST', body: JSON.stringify(payload) }).then(r => r.json());
    const session = await post('/create', { fields: { date: '2026-05-06', topic: 'FPV 入門', instructor: '王', location: '北科' }, actor: { username: 'cadre1' } });
    await post('/op', { id: session.id, op: 'token', actor: { officer: true }, ttlMinutes: 30 });
    for (const [i, studentId] of ['112590001', '112590002', '112590003', '112590004'].entries()) {
        await post('/op', { id: session.id, op: 'add', actor: { officer: true, username: 'cadre1' }, attendee: { kind: 'guest', memberId: '', studentId, name: `訪客${i}`, level: '', paid: null } });
    }
    const made = await f.request('/api/surveys/from-link', 'cadre1', 'POST', { type: 'class', id: session.id });
    assert.equal(made.status, 201);
    assert.equal(made.body.survey.link.type, 'class');
    assert.match(made.body.survey.title, /社課回饋：FPV 入門/);
    assert.equal(made.body.url, `https://example.com/survey/${made.body.survey.id}`);
    const again = await f.request('/api/surveys/from-link', 'cadre1', 'POST', { type: 'class', id: session.id });
    assert.equal(again.body.existing, true);
    assert.equal(again.body.survey.id, made.body.survey.id);
    assert.equal((await f.request('/api/surveys/from-link', 'alice', 'POST', { type: 'class', id: session.id })).status, 403);
    assert.equal((await f.request('/api/surveys/from-link', 'cadre1', 'POST', { type: 'class', id: 'missing' })).status, 404);
    assert.equal((await f.request('/api/surveys/from-link', 'cadre1', 'POST', { type: 'bogus', id: 'x' })).status, 400);

    const survey = (await f.request(`/api/surveys/${made.body.survey.id}`, 'cadre1')).body;
    for (const who of ['alice', 'bob']) {
        const response = await f.request(`/api/public/surveys/${survey.id}/respond`, who, 'POST', { answers: { [survey.questions[0].id]: 5, [survey.questions[1].id]: 4, [survey.questions[2].id]: survey.questions[2].options[2].id } });
        assert.equal(response.status, 201, JSON.stringify(response.body));
    }
    const report = await f.request(`/api/surveys/${survey.id}/report`, 'cadre1');
    assert.equal(report.body.stats.denominator, 4);
    assert.equal(report.body.stats.responseRate, 50);
    assert.equal(report.body.denominatorLabel, '簽到人數');

    // The public class page hands a signed-in attendee the feedback link.
    const token = (await post('/get', { id: session.id })).token;
    const checkin = await f.request(`/api/public/classes/${session.id}/checkin`, '', 'POST', { t: token, studentId: '112590009', name: '新同學', asGuest: true });
    assert.equal(checkin.status, 200, JSON.stringify(checkin.body));
    assert.equal(checkin.body.feedbackUrl, `/survey/${survey.id}`);
    const before = await f.request(`/api/public/classes/${session.id}?t=${token}`, '');
    assert.equal(before.body.feedbackUrl, '', 'no link before checking in');
});

test('event feedback surveys use confirmed registrations as the denominator', async () => {
    const f = fixture();
    const created = await f.request('/api/events', 'cadre1', 'POST', { title: '飛行日', startsAt: new Date(Date.now() + 86400000).toISOString(), audience: 'members' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    await f.request(`/api/events/${created.body.id}/register`, 'alice', 'POST', {});
    await f.request(`/api/events/${created.body.id}/register`, 'bob', 'POST', {});
    const made = await f.request('/api/surveys/from-link', 'cadre1', 'POST', { type: 'event', id: created.body.id });
    assert.equal(made.status, 201);
    assert.match(made.body.survey.title, /活動回饋：飛行日/);
    const survey = (await f.request(`/api/surveys/${made.body.survey.id}`, 'cadre1')).body;
    await f.request(`/api/public/surveys/${survey.id}/respond`, 'alice', 'POST', { answers: { [survey.questions[0].id]: 5, [survey.questions[1].id]: 5, [survey.questions[4].id]: survey.questions[4].options[0].id } });
    const report = await f.request(`/api/surveys/${survey.id}/report`, 'cadre1');
    assert.equal(report.body.stats.denominator, 2);
    assert.equal(report.body.stats.responseRate, 50);
});

test('response size and count are capped', async () => {
    const f = fixture();
    const survey = await createSurvey(f, sampleFields({ audience: 'members' }));
    const long = await f.request(`/api/public/surveys/${survey.id}/respond`, 'alice', 'POST', { answers: { ...answersFor(survey), [survey.questions[4].id]: 'x'.repeat(2001) } });
    assert.equal(long.status, 400);
    const huge = await f.raw(`/api/public/surveys/${survey.id}/respond`, 'alice', 'POST', { answers: { [survey.questions[4].id]: 'x'.repeat(70000) } });
    assert.equal(huge.status, 413);
});
