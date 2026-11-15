import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import worker, { FormStore } from '../src/worker.js';
import { renderAdminDashboard } from '../src/templates.js';
import { chineseAmount, formNumberPrefix, taipeiToday, normalizePublicLoan, normalizeFormData, renderFormPrint, parseLetterDraft, inclusiveDays, FormValidationError, sanitizeFormFill, formFillPrompt } from '../src/forms.js';
import { createMockSiteStore, withSiteStore } from './helpers/site-store.js';

// In-memory Durable Object storage whose transactions run one at a time, like the real runtime.
function createMockFormStore() {
    const values = new Map();
    let tail = Promise.resolve();
    const storage = {
        async get(key) { return structuredClone(values.get(key)); },
        async put(key, value) { values.set(key, structuredClone(value)); },
        async delete(keys) { for (const key of [].concat(keys)) values.delete(key); },
        async list({ prefix = '' } = {}) { return new Map([...values.entries()].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b))); },
        transaction(callback) { const result = tail.then(() => callback(storage)); tail = result.catch(() => {}); return result; }
    };
    const object = new FormStore({ storage });
    return { idFromName: name => name, get: () => ({ fetch: (input, init) => object.fetch(new Request(input, init)) }), values };
}

const dayOffset = days => new Date(Date.parse(`${taipeiToday()}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

function fixture(extraEnv = {}) {
    const store = new Map();
    const db = {
        async get(key) { return store.get(key) ?? null; },
        async put(key, value) { store.set(key, typeof value === 'string' ? value : JSON.stringify(value)); },
        async delete(key) { store.delete(key); },
        async list({ prefix }) { return { keys: [...store.keys()].filter(name => name.startsWith(prefix)).map(name => ({ name })) }; }
    };
    for (const name of ['president', 'finance', 'cadre', 'member', 'member2']) {
        const role = name === 'member2' ? 'member' : name;
        store.set(`user:${name}`, JSON.stringify({ username: name, role, active: true, version: 'v1' }));
        store.set(`session:${name}`, JSON.stringify({ username: name, version: 'v1' }));
    }
    const formStore = createMockFormStore();
    const env = withSiteStore({ DRONE_DB: db, FORM_STORE: formStore, ...extraEnv });
    // Public loan posts get a solved image CAPTCHA unless the test supplies its own fields.
    const withCaptcha = (path, body) => path === '/api/public/equipment-loan' && body && !env.TURNSTILE_SECRET_KEY && !('captchaId' in body)
        ? { ...body, ...env.SITE_STORE.issueCaptcha() } : body;
    const request = (path, who, method = 'GET', rawBody, ip = '203.0.113.7', body = withCaptcha(path, rawBody)) => worker.fetch(new Request(`https://example.com${path}`, {
        method,
        headers: { 'CF-Connecting-IP': ip, ...(who ? { Cookie: `session=${who}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }), env);
    return { store, request, env, formStore };
}

const expenseRequest = {
    applicant: '林同學', studentId: 'b11234567', department: '機械三', position: '器材長', applyDate: '2026-11-15', category: 'consumable',
    items: [{ date: '2026-11-20', name: '6S 電池', quantity: 4, unitPrice: 1250, note: '社課' }, { name: '槳', quantity: 10, unitPrice: 85 }]
};
const loan = {
    borrower: '張同學', purpose: '成果展空拍', fillDate: '2026-11-15', startDate: '2026-11-18', startHour: 9, endDate: '2026-11-20', endHour: 18,
    items: [{ name: 'DJI Mini 4 Pro', assetNo: 'NTUT-DR-2026-AAAAAAAAAA', quantity: 1, accessories: '電池x3', condition: '良好' }]
};
const activity = {
    academicYear: 115, semester: 1, title: '期末飛行成果展', startDate: '2026-12-19', startTime: '13:00', endTime: '17:00', locationType: 'campus',
    location: '操場', content: '13:00 報到', internalCount: 40, externalCount: 10, virtues: ['團隊合作'], sdg: '優質教育', contactName: '林同學'
};

test('chineseAmount writes NT dollar amounts in formal characters', () => {
    assert.equal(chineseAmount(0), '零元整');
    assert.equal(chineseAmount(5850), '伍仟捌佰伍拾元整');
    assert.equal(chineseAmount(1005), '壹仟零伍元整');
    assert.equal(chineseAmount(100001000), '壹億零壹仟元整');
    assert.equal(chineseAmount(10001000), '壹仟萬壹仟元整');
    assert.equal(chineseAmount(200000), '貳拾萬元整');
    assert.equal(chineseAmount(1050000), '壹佰零伍萬元整');
});

test('form number prefixes use the type and ROC year', () => {
    assert.equal(formNumberPrefix('expense-request', '2026-11-15T00:00:00Z'), '申115');
    assert.equal(formNumberPrefix('activity-report', '2027-01-02T00:00:00Z'), '報116');
});

test('form validation rejects incomplete or inconsistent data', () => {
    assert.throws(() => normalizeFormData('expense-request', { ...expenseRequest, items: [] }), FormValidationError);
    assert.throws(() => normalizeFormData('expense-request', { ...expenseRequest, category: 'other' }), /其他支出類別說明/);
    assert.throws(() => normalizeFormData('equipment-loan', { ...loan, endDate: '2026-11-01' }), /歸還日期/);
    assert.throws(() => normalizeFormData('activity-application', { ...activity, sdg: '不存在' }), /永續發展/);
    assert.throws(() => normalizeFormData('activity-application', { ...activity, startDate: '2026-02-30' }), /YYYY-MM-DD/);
    assert.throws(() => normalizeFormData('nope', {}), /表單類型無效/);
    const normalized = normalizeFormData('equipment-loan', loan);
    assert.equal(inclusiveDays(normalized.startDate, normalized.endDate), 3);
});

test('printable forms escape user input and fill in totals', () => {
    const data = normalizeFormData('expense-request', { ...expenseRequest, applicant: '<script>alert(1)</script>' });
    const html = renderFormPrint({ type: 'expense-request', number: '申115-001', data });
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /伍仟捌佰伍拾元整/);
    assert.match(html, /\$ 5,850/);
    assert.match(html, /☑ 耗材支出/);
    const loanHtml = renderFormPrint({ type: 'equipment-loan', number: '借115-001', data: normalizeFormData('equipment-loan', loan) }, { presidentName: '王小明' });
    assert.match(loanHtml, /第一聯　社團存查/);
    assert.match(loanHtml, /第二聯　借用人收執/);
    assert.match(loanHtml, /社長（王小明）/);
    assert.match(loanHtml, /共3日/);
    const blank = renderFormPrint({ type: 'activity-application', data: {} });
    assert.match(blank, /學生活動申請表/);
    assert.match(blank, /113\.1\.16更新/);
    assert.doesNotMatch(blank, /☑/);
});

test('AI letter drafts are cleaned of numbering and labels', () => {
    const draft = parseLetterDraft('```json\n{"subject":"主旨：檢送活動計畫，請 查照。","descriptions":["一、依據本社規劃辦理。","2. 檢附計畫書1份。"]}\n```');
    assert.deepEqual(draft, { subject: '檢送活動計畫，請 查照。', descriptions: ['依據本社規劃辦理。', '檢附計畫書1份。'] });
    assert.throws(() => parseLetterDraft('not json'), /無法解析/);
});

test('every signed-in role can create forms; members only see their own', async () => {
    const { request } = fixture();
    assert.equal((await request('/api/forms', null, 'POST', { type: 'equipment-loan', data: loan })).status, 401);
    const created = await request('/api/forms', 'member', 'POST', { type: 'equipment-loan', data: loan });
    assert.equal(created.status, 201);
    const record = await created.json();
    assert.match(record.number, /^借\d{3}-001$/);
    assert.match(record.title, /張同學 借用 DJI Mini 4 Pro/);
    const second = await (await request('/api/forms', 'cadre', 'POST', { type: 'expense-request', data: expenseRequest })).json();
    assert.match(second.number, /^申\d{3}-001$/);

    assert.deepEqual((await (await request('/api/forms', 'member', 'GET')).json()).map(item => item.id), [record.id]);
    assert.equal((await (await request('/api/forms', 'member2', 'GET')).json()).length, 0);
    assert.equal((await (await request('/api/forms', 'finance', 'GET')).json()).length, 2);
    assert.equal((await (await request('/api/forms?type=expense-request', 'president', 'GET')).json()).length, 1);

    assert.equal((await request(`/api/forms/${record.id}`, 'member2', 'GET')).status, 404);
    assert.equal((await request(`/admin/forms/print/${record.id}`, 'member2', 'GET')).status, 404);
    const print = await request(`/admin/forms/print/${record.id}`, 'cadre', 'GET');
    assert.equal(print.status, 200);
    assert.match(await print.text(), /設備借據/);
    assert.equal((await request(`/admin/forms/print/${record.id}`, null, 'GET')).status, 302);
});

test('only the author or president can edit or delete a form', async () => {
    const { request } = fixture();
    const record = await (await request('/api/forms', 'member', 'POST', { type: 'activity-application', data: activity })).json();
    assert.equal((await request(`/api/forms/${record.id}`, 'cadre', 'PUT', { data: { ...activity, title: '改名' } })).status, 403);
    const updated = await request(`/api/forms/${record.id}`, 'member', 'PUT', { data: { ...activity, title: '改名後的活動' } });
    assert.equal(updated.status, 200);
    const body = await updated.json();
    assert.equal(body.title, '改名後的活動');
    assert.equal(body.number, record.number);
    assert.equal((await request(`/api/forms/${record.id}`, 'member', 'PUT', { data: { ...activity, title: '' } })).status, 400);
    assert.equal((await request(`/api/forms/${record.id}`, 'cadre', 'DELETE')).status, 403);
    assert.equal((await request(`/api/forms/${record.id}`, 'president', 'DELETE')).status, 200);
    assert.equal((await (await request('/api/forms', 'president', 'GET')).json()).length, 0);
});

test('blank forms print for any signed-in user; settings are president-only', async () => {
    const { request } = fixture();
    const blank = await request('/admin/forms/blank/activity-report', 'member', 'GET');
    assert.equal(blank.status, 200);
    assert.match(await blank.text(), /學生活動報告表/);
    assert.equal((await request('/admin/forms/blank/unknown', 'member', 'GET')).status, 404);
    assert.equal((await request('/api/forms/settings', 'cadre', 'PUT', { presidentName: '某人' })).status, 403);
    const saved = await request('/api/forms/settings', 'president', 'PUT', { presidentName: '王小明', propertyManager: '陳器材', clubName: '' });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).clubName, '國立臺北科技大學 無人機社');
    const record = await (await request('/api/forms', 'member', 'POST', { type: 'equipment-loan', data: loan })).json();
    const html = await (await request(`/admin/forms/print/${record.id}`, 'member', 'GET')).text();
    assert.match(html, /財產管理人（陳器材）/);
});

test('AI letter falls back to Gemini, is officer-only, needs a key and is rate limited', async (t) => {
    let captured;
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        captured = { url: String(url), init };
        return Response.json({ candidates: [{ content: { parts: [{ text: '{"subject":"檢送成果展計畫，請 查照。","descriptions":["活動於12月19日辦理。"]}' }] } }] });
    });
    const withoutKey = fixture();
    assert.equal((await withoutKey.request('/api/forms/ai-letter', 'cadre', 'POST', { text: '想辦成果展' })).status, 503);
    assert.equal([...withoutKey.formStore.values.keys()].some(key => key.startsWith('quota:')), false, 'a missing key must not use up the daily quota');

    const { request, store } = fixture({ GEMINI_API_KEY: 'test-key' });
    assert.equal((await request('/api/forms/ai-letter', 'member', 'POST', { text: '想辦成果展' })).status, 403);
    assert.equal((await request('/api/forms/ai-letter', 'cadre', 'POST', { text: '' })).status, 400);
    const response = await request('/api/forms/ai-letter', 'cadre', 'POST', { text: '想辦成果展', docType: '簽' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { subject: '檢送成果展計畫，請 查照。', descriptions: ['活動於12月19日辦理。'] });
    assert.match(captured.url, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.5-flash:generateContent$/);
    assert.equal(captured.init.headers['x-goog-api-key'], 'test-key');
    assert.match(JSON.parse(captured.init.body).contents[0].parts[0].text, /公文類型：簽/);

    for (let i = 0; i < 29; i++) assert.equal((await request('/api/forms/ai-letter', 'cadre', 'POST', { text: '想辦成果展' })).status, 200);
    assert.equal((await request('/api/forms/ai-letter', 'cadre', 'POST', { text: '想辦成果展' })).status, 429);
});

test('forms panel is available to every role and its script parses', () => {
    for (const role of ['president', 'finance', 'cadre', 'member']) {
        const html = renderAdminDashboard([], [], { username: role, role });
        assert.match(html, /id="panel-forms"/);
        assert.match(html, /<script src="\/admin-forms\.js" defer><\/script>/);
        assert.equal(/id="forms-settings"/.test(html), role === 'president');
    }
    const script = readFileSync(new URL('../public/admin-forms.js', import.meta.url), 'utf8');
    assert.doesNotThrow(() => new vm.Script(script));
});

test('Groq is preferred and receives an OpenAI-style JSON request', async (t) => {
    let captured;
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        captured = { url: String(url), init, body: JSON.parse(init.body) };
        return Response.json({ choices: [{ message: { content: '{"subject":"主旨：借用操場辦理成果展，敬請 核示。","descriptions":["一、時間為12月19日。"]}' } }] });
    });
    const { request } = fixture({ GROQ_API_KEY: 'gsk_test', GEMINI_API_KEY: 'unused' });
    const response = await request('/api/forms/ai-letter', 'president', 'POST', { text: '想借操場辦成果展' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { subject: '借用操場辦理成果展，敬請 核示。', descriptions: ['時間為12月19日。'] });
    assert.equal(captured.url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(captured.init.headers.Authorization, 'Bearer gsk_test');
    assert.equal(captured.body.model, 'openai/gpt-oss-120b');
    assert.equal(captured.body.reasoning_effort, 'low');
    assert.deepEqual(captured.body.response_format, { type: 'json_object' });
    assert.equal(captured.body.messages[0].role, 'system');
    const settings = await (await request('/api/forms/settings', 'member', 'GET')).json();
    assert.deepEqual(settings.ai, { provider: 'groq', model: 'openai/gpt-oss-120b' });
});

test('AI form fill keeps only valid known fields', () => {
    const { fields, notes } = sanitizeFormFill('equipment-loan', {
        fields: {
            borrower: '  張同學 ', startDate: '2026-11-20', endDate: '2026-13-01', startHour: 9, endHour: 30, phone: 912345678,
            items: [{ name: 'Mini 4 Pro', quantity: '1', accessories: '電池x3', bogus: 'x' }, { quantity: 2 }],
            password: 'should be dropped', purpose: ''
        },
        notes: '缺少學號'
    });
    assert.deepEqual(fields, { borrower: '張同學', phone: '912345678', startDate: '2026-11-20', startHour: 9, items: [{ name: 'Mini 4 Pro', quantity: 1, accessories: '電池x3' }] });
    assert.equal(notes, '缺少學號');
    const activity = sanitizeFormFill('activity-application', { fields: { semester: 3, virtues: ['團隊合作', '不存在'], sdg: '優質教育', locationType: 'mars', startTime: '9:05', budgetTotal: '5,000元' } });
    assert.deepEqual(activity.fields, { startTime: '09:05', virtues: ['團隊合作'], sdg: '優質教育', budgetTotal: 5000 });
    const prompt = formFillPrompt('expense-request', new Date('2026-11-15T03:00:00Z'));
    assert.match(prompt, /今天是 2026-11-15（星期日，民國 115 年/);
    assert.match(prompt, /unitPrice（整數）/);
});

test('AI form fill route returns sanitized fields for any signed-in user', async (t) => {
    let captured;
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        captured = JSON.parse(init.body);
        return Response.json({ choices: [{ message: { content: JSON.stringify({ fields: { applicant: '林小明', category: 'consumable', items: [{ name: '6S 電池', quantity: 4, unitPrice: 1250 }], studentId: 'B11234567' }, notes: '請補上申請日期' }) } }] });
    });
    const { request, store } = fixture({ GROQ_API_KEY: 'gsk_test' });
    assert.equal((await request('/api/forms/ai-fill', null, 'POST', { type: 'expense-request', text: '買電池' })).status, 401);
    assert.equal((await request('/api/forms/ai-fill', 'member', 'POST', { type: 'nope', text: '買電池' })).status, 400);
    assert.equal((await request('/api/forms/ai-fill', 'member', 'POST', { type: 'official-letter', text: '寫公文' })).status, 403);
    const response = await request('/api/forms/ai-fill', 'member', 'POST', { type: 'expense-request', text: '我是林小明，想買 4 顆電池每顆 1250' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { fields: { applicant: '林小明', studentId: 'B11234567', category: 'consumable', items: [{ name: '6S 電池', quantity: 4, unitPrice: 1250 }] }, notes: '請補上申請日期' });
    assert.match(captured.messages[0].content, /社費支出事前申請單/);
    assert.match(captured.messages[1].content, /林小明/);
    for (let i = 0; i < 29; i++) assert.equal((await request('/api/forms/ai-fill', 'member', 'POST', { type: 'expense-request', text: '買電池' })).status, 200);
    assert.equal((await request('/api/forms/ai-fill', 'member', 'POST', { type: 'expense-request', text: '買電池' })).status, 429);
    const noKey = fixture();
    assert.equal((await noKey.request('/api/forms/ai-fill', 'member', 'POST', { type: 'expense-request', text: '買電池' })).status, 503);
});

const publicLoan = { ...loan, studentId: 'b11200001', phone: '0912-345-678', startDate: dayOffset(1), endDate: dayOffset(3) };

test('public equipment loan page needs no login and offers no AI', async () => {
    const { request } = fixture({ GROQ_API_KEY: 'gsk_test' });
    const page = await request('/forms/equipment-loan', null, 'GET');
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /設備借用申請/);
    assert.match(html, /<script src="\/public-loan\.js" defer><\/script>/);
    assert.doesNotMatch(html, /AI/);
    assert.equal((await request('/api/forms/ai-fill', null, 'POST', { type: 'equipment-loan', text: '借空拍機' })).status, 401);
    assert.doesNotThrow(() => new vm.Script(readFileSync(new URL('../public/public-loan.js', import.meta.url), 'utf8')));
});

test('public loan requires student ID and phone, and prints only with its token', async () => {
    const { request, env } = fixture();
    assert.equal((await request('/api/public/equipment-loan', null, 'POST', { data: publicLoan, captchaId: '', captcha: '' })).status, 400, 'image CAPTCHA is required without Turnstile');
    assert.equal((await request('/api/public/equipment-loan', null, 'POST', { data: publicLoan, ...env.SITE_STORE.issueCaptcha(), captcha: 'WRONG' })).status, 400);
    assert.match(await (await request('/forms/equipment-loan')).text(), /id="pl-captcha"/);
    assert.equal((await request('/api/public/equipment-loan', null, 'POST', { data: { ...publicLoan, studentId: '' } })).status, 400);
    assert.equal((await request('/api/public/equipment-loan', null, 'POST', { data: { ...publicLoan, phone: '' } })).status, 400);
    const created = await request('/api/public/equipment-loan', null, 'POST', { data: publicLoan });
    assert.equal(created.status, 201);
    const result = await created.json();
    assert.match(result.number, /^借\d{3}-001$/);
    assert.deepEqual(Object.keys(result).sort(), ['number', 'printDays', 'printUrl']);
    const print = await request(result.printUrl, null, 'GET');
    assert.equal(print.status, 200);
    assert.match(await print.text(), /B11200001/);
    const [, id] = /\/forms\/print\/([\w-]+)/.exec(result.printUrl);
    assert.equal((await request(`/forms/print/${id}`, null, 'GET')).status, 404);
    assert.equal((await request(`/forms/print/${id}?token=${'0'.repeat(48)}`, null, 'GET')).status, 404);

    const list = await (await request('/api/forms', 'cadre', 'GET')).json();
    assert.equal(list.length, 1);
    assert.equal(list[0].source, 'public');
    assert.equal(list[0].createdBy, '');
    assert.equal(list[0].accessToken, undefined, 'the print token must not be exposed to officers');
    assert.equal((await (await request('/api/forms', 'member', 'GET')).json()).length, 0, 'members never see external slips');
    assert.equal((await request(`/api/forms/${id}`, 'cadre', 'PUT', { data: { ...publicLoan, items: [{ ...publicLoan.items[0], assetNo: 'NTUT-DR-2026-X' }] } })).status, 200);
    assert.equal((await request(`/api/forms/${id}`, 'member', 'DELETE')).status, 404);
});

test('public loans are rate limited per IP and verify Turnstile when configured', async (t) => {
    const { request } = fixture();
    for (let i = 0; i < 5; i++) assert.equal((await request('/api/public/equipment-loan', null, 'POST', { data: publicLoan })).status, 201);
    assert.equal((await request('/api/public/equipment-loan', null, 'POST', { data: publicLoan })).status, 429);

    t.mock.method(globalThis, 'fetch', async (url, init) => Response.json({ success: init.body.get('response') === 'good-token' }));
    const guarded = fixture({ TURNSTILE_SECRET_KEY: 'secret', TURNSTILE_SITE_KEY: 'site' });
    assert.match(await (await guarded.request('/forms/equipment-loan', null, 'GET')).text(), /cf-turnstile/);
    assert.equal((await guarded.request('/api/public/equipment-loan', null, 'POST', { data: publicLoan })).status, 400);
    assert.equal((await guarded.request('/api/public/equipment-loan', null, 'POST', { data: publicLoan, turnstileToken: 'bad' })).status, 400);
    assert.equal((await guarded.request('/api/public/equipment-loan', null, 'POST', { data: publicLoan, turnstileToken: 'good-token' })).status, 201);
});

test('form numbers are never reused, even after deleting the newest form', async () => {
    const { request } = fixture();
    const first = await (await request('/api/forms', 'cadre', 'POST', { type: 'equipment-loan', data: loan })).json();
    const second = await (await request('/api/forms', 'cadre', 'POST', { type: 'equipment-loan', data: loan })).json();
    assert.equal((await request(`/api/forms/${second.id}`, 'cadre', 'DELETE')).status, 200);
    const third = await (await request('/api/forms', 'cadre', 'POST', { type: 'equipment-loan', data: loan })).json();
    assert.match(first.number, /-001$/);
    assert.match(second.number, /-002$/);
    assert.match(third.number, /-003$/);
});

test('concurrent submissions keep every record with distinct numbers and respect limits', async () => {
    const { request } = fixture();
    const internal = await Promise.all(Array.from({ length: 8 }, () => request('/api/forms', 'cadre', 'POST', { type: 'expense-request', data: expenseRequest })));
    assert.deepEqual(internal.map(response => response.status), Array(8).fill(201));
    const numbers = await Promise.all(internal.map(response => response.json().then(body => body.number)));
    assert.equal(new Set(numbers).size, 8);
    const burst = await Promise.all(Array.from({ length: 12 }, () => request('/api/public/equipment-loan', null, 'POST', { data: publicLoan }, '198.51.100.9')));
    assert.equal(burst.filter(response => response.status === 201).length, 5, 'per-IP limit must hold under a parallel burst');
    assert.equal((await (await request('/api/forms', 'president', 'GET')).json()).length, 13);
});

test('public slips have their own cap and cannot block officers', async () => {
    const { request, formStore } = fixture();
    formStore.values.set('count:public', 1000);
    assert.equal((await request('/api/public/equipment-loan', null, 'POST', { data: publicLoan })).status, 409);
    assert.equal((await request('/api/forms', 'cadre', 'POST', { type: 'equipment-loan', data: loan })).status, 201);
});

test('public loans cannot start in the past or run too long, and fill date is set by the server', () => {
    const today = taipeiToday();
    assert.throws(() => normalizePublicLoan({ ...publicLoan, startDate: dayOffset(-1) }, today), /不可早於今天/);
    assert.throws(() => normalizePublicLoan({ ...publicLoan, endDate: dayOffset(40) }, today), /不可超過 30 天/);
    assert.equal(normalizePublicLoan({ ...publicLoan, fillDate: '2000-01-01' }, today).fillDate, today);
    assert.throws(() => normalizeFormData('equipment-loan', { ...loan, startDate: '2020-01-01', endDate: '2030-12-31' }), /不可超過 180 天/);
});

test('public print links expire after 3 days and send no referrer', async () => {
    const { request, formStore } = fixture();
    const { printUrl, printDays } = await (await request('/api/public/equipment-loan', null, 'POST', { data: publicLoan })).json();
    assert.equal(printDays, 3);
    const fresh = await request(printUrl, null, 'GET');
    assert.equal(fresh.status, 200);
    assert.equal(fresh.headers.get('Referrer-Policy'), 'no-referrer');
    const [, id] = /\/forms\/print\/([\w-]+)/.exec(printUrl);
    const key = `form:${id}`;
    formStore.values.set(key, { ...formStore.values.get(key), createdAt: new Date(Date.now() - 4 * 86400000).toISOString() });
    assert.equal((await request(printUrl, null, 'GET')).status, 404);
});

test('a failed AI call refunds the daily quota', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response('down', { status: 500 }));
    const { request, formStore } = fixture({ GROQ_API_KEY: 'gsk_test' });
    assert.equal((await request('/api/forms/ai-fill', 'member', 'POST', { type: 'expense-request', text: '買電池' })).status, 502);
    assert.equal(formStore.values.get('quota:ai:member'), 0);
});
