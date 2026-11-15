import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import worker from '../src/worker.js';
import { renderAdminDashboard } from '../src/templates.js';
import { chineseAmount, nextFormNumber, normalizeFormData, renderFormPrint, parseLetterDraft, inclusiveDays, FormValidationError } from '../src/forms.js';

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
    const env = { DRONE_DB: db, ...extraEnv };
    const request = (path, who, method = 'GET', body) => worker.fetch(new Request(`https://example.com${path}`, {
        method,
        headers: { ...(who ? { Cookie: `session=${who}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }), env);
    return { store, request, env };
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

test('form numbers count up per type and ROC year', () => {
    const records = [{ number: '申115-001' }, { number: '申115-007' }, { number: '借115-003' }, { number: '申114-020' }];
    assert.equal(nextFormNumber('expense-request', records, '2026-11-15T00:00:00Z'), '申115-008');
    assert.equal(nextFormNumber('equipment-loan', records, '2026-11-15T00:00:00Z'), '借115-004');
    assert.equal(nextFormNumber('activity-report', records, '2027-01-02T00:00:00Z'), '報116-001');
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

test('AI letter route is officer-only, needs a key and is rate limited', async (t) => {
    let captured;
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        captured = { url: String(url), init };
        return Response.json({ candidates: [{ content: { parts: [{ text: '{"subject":"檢送成果展計畫，請 查照。","descriptions":["活動於12月19日辦理。"]}' }] } }] });
    });
    const withoutKey = fixture();
    assert.equal((await withoutKey.request('/api/forms/ai-letter', 'cadre', 'POST', { text: '想辦成果展' })).status, 503);

    const { request, store } = fixture({ GEMINI_API_KEY: 'test-key' });
    assert.equal((await request('/api/forms/ai-letter', 'member', 'POST', { text: '想辦成果展' })).status, 403);
    assert.equal((await request('/api/forms/ai-letter', 'cadre', 'POST', { text: '' })).status, 400);
    const response = await request('/api/forms/ai-letter', 'cadre', 'POST', { text: '想辦成果展', docType: '簽' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { subject: '檢送成果展計畫，請 查照。', descriptions: ['活動於12月19日辦理。'] });
    assert.match(captured.url, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.5-flash:generateContent$/);
    assert.equal(captured.init.headers['x-goog-api-key'], 'test-key');
    assert.match(JSON.parse(captured.init.body).contents[0].parts[0].text, /公文類型：簽/);

    store.set(`forms:ai-usage:cadre:${new Date().toISOString().slice(0, 10)}`, '30');
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
