import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { EquipmentStore, FormStore } from '../src/worker.js';
import { requestAiJson } from '../src/forms.js';
import { sanitizeContentResult, sanitizeMemberRows, sanitizeAssistantActions, normalizeConversation, financeChecks, slugify } from '../src/ai.js';
import { withSiteStore } from './helpers/site-store.js';

function createStorage() {
    const values = new Map();
    let tail = Promise.resolve();
    const storage = {
        async get(key) { return structuredClone(values.get(key)); },
        async put(key, value) { values.set(key, structuredClone(value)); },
        async delete(keys) { for (const key of [].concat(keys)) values.delete(key); },
        async list({ prefix = '', limit = Infinity } = {}) { return new Map([...values.entries()].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit)); },
        transaction(callback) { const result = tail.then(() => callback(storage)); tail = result.catch(() => {}); return result; }
    };
    return { storage, values };
}
function durableObject(Class) {
    const { storage, values } = createStorage();
    const object = new Class({ storage });
    return { idFromName: name => name, get: () => ({ fetch: (input, init) => object.fetch(input instanceof Request ? input : new Request(input, init)) }), values };
}

function fixture(extraEnv = {}) {
    const store = new Map();
    const db = {
        async get(key) { return store.get(key) ?? null; },
        async put(key, value) { store.set(key, typeof value === 'string' ? value : JSON.stringify(value)); },
        async delete(key) { store.delete(key); },
        async list({ prefix }) { return { keys: [...store.keys()].filter(name => name.startsWith(prefix)).map(name => ({ name })) }; }
    };
    for (const role of ['president', 'finance', 'cadre', 'member']) {
        store.set(`user:${role}`, JSON.stringify({ username: role, role, active: true, version: 'v1' }));
        store.set(`session:${role}`, JSON.stringify({ username: role, version: 'v1' }));
    }
    const env = withSiteStore({ DRONE_DB: db, FORM_STORE: durableObject(FormStore), EQUIPMENT_STORE: durableObject(EquipmentStore), ...extraEnv });
    const request = (path, who, method = 'GET', body) => worker.fetch(new Request(`https://example.com${path}`, {
        method,
        headers: { ...(who ? { Cookie: `session=${who}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }), env);
    return { store, request, env };
}

const groq = payload => Response.json({ choices: [{ message: { content: JSON.stringify(payload) } }] });
// Replies with the given model outputs in order and records each request body.
function mockAi(t, replies) {
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(init.body) });
        const next = replies.shift();
        if (!next) throw new Error('unexpected AI call');
        return groq(next);
    });
    return calls;
}

const members = [
    { id: 'm1', name: '王小明', studentId: 'B11234567', phone: '0912345678', email: 'a@example.com', level: 'member', feeStatus: 'unpaid' },
    { id: 'm2', name: '李小華', studentId: 'B11234568', level: 'member', feeStatus: 'lifetime' }
];

test('requestAiJson sends multi-turn conversations to both providers', async (t) => {
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(init.body) });
        return String(url).includes('groq') ? groq({ ok: 1 }) : Response.json({ candidates: [{ content: { parts: [{ text: '{"ok":2}' }] } }] });
    });
    const turns = [{ role: 'user', content: 'Q1' }, { role: 'assistant', content: 'A1' }, { role: 'user', content: 'Q2' }];
    assert.deepEqual(await requestAiJson({ GROQ_API_KEY: 'k' }, 'sys', turns, fetch, { maxTokens: 999 }), { ok: 1 });
    assert.deepEqual(calls[0].body.messages.map(m => m.role), ['system', 'user', 'assistant', 'user']);
    assert.equal(calls[0].body.max_completion_tokens, 999);
    assert.deepEqual(await requestAiJson({ GEMINI_API_KEY: 'k' }, 'sys', turns), { ok: 2 });
    assert.deepEqual(calls[1].body.contents.map(c => c.role), ['user', 'model', 'user']);
    assert.equal(calls[1].body.generationConfig.maxOutputTokens, 4096);
});

test('AI writing assistant is limited to CMS editors and returns sanitized drafts', async (t) => {
    const { request } = fixture({ GROQ_API_KEY: 'gsk' });
    assert.equal((await request('/api/ai/content', null, 'POST', { action: 'draft', notes: 'x' })).status, 401);
    assert.equal((await request('/api/ai/content', 'finance', 'POST', { action: 'draft', notes: 'x' })).status, 403);
    assert.equal((await request('/api/ai/content', 'cadre', 'POST', { action: 'nope', notes: 'x' })).status, 400);
    assert.equal((await request('/api/ai/content', 'cadre', 'POST', { action: 'polish', content: '' })).status, 400);
    mockAi(t, [{ title: 'FPV 社課紀錄', slug: 'FPV 社課!!', summary: '摘要', content: '## 內容', notes: '缺地點' }]);
    const response = await request('/api/ai/content', 'cadre', 'POST', { action: 'translate', lang: 'zh', title: '社課', content: '內容' });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.lang, 'en');
    assert.equal(result.slug, 'fpv');
    assert.equal(result.content, '## 內容');
    const { request: noKey } = fixture();
    assert.equal((await noKey('/api/ai/content', 'cadre', 'POST', { action: 'draft', notes: 'x' })).status, 503);
});

test('content results never carry an invalid slug and require content', () => {
    assert.equal(sanitizeContentResult('draft', { title: 'Hello World', content: 'x', slug: '中文' }, 'zh').slug, 'hello-world');
    assert.equal(slugify('!!!'), '');
    assert.throws(() => sanitizeContentResult('polish', { content: '' }, 'zh'));
});

test('assistant calls only permitted read-only tools and drops actions the user cannot take', async (t) => {
    const { request, store } = fixture({ GROQ_API_KEY: 'gsk' });
    store.set('members:list', JSON.stringify(members));
    const calls = mockAi(t, [
        { tool: { name: 'query_members', args: { filter: 'unpaid' } } },
        { reply: '未繳費：王小明', actions: [{ type: 'finance_transaction', date: '2026-11-18', item: '社費', kind: 'income', amount: 500 }, { type: 'open_panel', panel: 'members' }, { type: 'open_panel', panel: 'evil' }] }
    ]);
    const response = await request('/api/ai/assistant', 'finance', 'POST', { messages: [{ role: 'user', content: '誰沒繳社費？' }] });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.reply, '未繳費：王小明');
    assert.deepEqual(body.tools, ['query_members']);
    assert.deepEqual(body.actions.map(a => a.type), ['finance_transaction', 'open_panel']);
    const toolResult = calls[1].body.messages.at(-1).content;
    assert.match(toolResult, /王小明/);
    assert.doesNotMatch(toolResult, /李小華/);
    assert.doesNotMatch(toolResult, /0912345678|a@example\.com/);

    // A cadre has no roster tool, and finance actions are stripped.
    const cadreCalls = mockAi(t, [
        { tool: { name: 'query_members', args: {} } },
        { reply: '無法查詢', actions: [{ type: 'finance_transaction', date: '2026-11-18', item: '社費', kind: 'income', amount: 500 }] }
    ]);
    const cadre = await (await request('/api/ai/assistant', 'cadre', 'POST', { messages: [{ role: 'user', content: '誰沒繳社費？' }] })).json();
    assert.deepEqual(cadre.actions, []);
    assert.deepEqual(cadre.tools, []);
    assert.doesNotMatch(cadreCalls[0].body.messages[0].content, /query_members/);
    assert.match(cadreCalls[1].body.messages.at(-1).content, /沒有權限/);
});

test('assistant stops after the tool-call limit and counts one quota per question', async (t) => {
    const { request } = fixture({ GROQ_API_KEY: 'gsk', AI_DAILY_LIMIT: '2' });
    mockAi(t, Array.from({ length: 5 }, () => ({ tool: { name: 'open_amendments', args: {} } })));
    const body = await (await request('/api/ai/assistant', 'member', 'POST', { messages: [{ role: 'user', content: 'loop' }] })).json();
    assert.match(body.reply, /上限/);
    mockAi(t, [{ reply: 'ok' }]);
    assert.equal((await request('/api/ai/assistant', 'member', 'POST', { messages: [{ role: 'user', content: 'hi' }] })).status, 200);
    assert.equal((await request('/api/ai/assistant', 'member', 'POST', { messages: [{ role: 'user', content: 'hi' }] })).status, 429);
});

test('assistant input and actions are validated', () => {
    assert.throws(() => normalizeConversation([]));
    assert.throws(() => normalizeConversation([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }]));
    assert.deepEqual(normalizeConversation([{ role: 'assistant', content: 'hi' }, { role: 'user', content: 'q' }]), [{ role: 'user', content: 'q' }]);
    const actions = sanitizeAssistantActions([
        { type: 'post_draft', title: 'Hi There', content: 'body' },
        { type: 'post_draft', title: 'empty', content: '' },
        { type: 'finance_transaction', date: 'bad', item: 'x', amount: 1 },
        { type: 'finance_transaction', date: '2026-01-01', item: 'x', amount: -5 }
    ], { editCms: true, finance: true });
    assert.deepEqual(actions, [{ type: 'post_draft', title: 'Hi There', slug: 'hi-there', summary: '', content: 'body', lang: 'zh' }]);
});

test('finance review merges rule checks with AI suggestions limited to eligible expenses', async (t) => {
    const { request, store } = fixture({ GROQ_API_KEY: 'gsk' });
    const base = { kind: 'expense', income: 0, cashDelta: 0, postalDelta: 0, createdAt: '2026-01-01T00:00:00.000Z' };
    store.set('finance:budgets', JSON.stringify([{ id: 'b1', name: '器材', planned: 10000 }]));
    store.set('finance:transactions', JSON.stringify([
        { ...base, id: 't1', date: '2026-11-01', item: '電池', amount: 1200, expense: 1200, budgetId: '', status: 'pending' },
        { ...base, id: 't2', date: '2026-11-01', item: '電池', amount: 1200, expense: 1200, budgetId: '', status: 'pending' },
        { ...base, id: 't3', date: '2026-10-01', item: '槳', amount: 300, expense: 300, budgetId: 'b1', status: 'approved' }
    ]));
    assert.equal((await request('/api/ai/finance-review', 'cadre', 'POST', {})).status, 403);
    mockAi(t, [{ suggestions: [{ id: 't1', budgetId: 'b1', reason: '電池屬器材' }, { id: 't3', budgetId: 'b1', reason: 'x' }, { id: 'fake', budgetId: 'b1' }, { id: 't2', budgetId: 'nope' }], anomalies: [{ ids: ['t1', 'ghost'], issue: '事由太簡略' }], summary: '整體正常' }]);
    const review = await (await request('/api/ai/finance-review', 'finance', 'POST', {})).json();
    assert.deepEqual(review.suggestions.map(s => s.id), ['t1']);
    assert.ok(review.anomalies.some(a => a.source === 'rule' && a.issue.includes('可能重複')));
    assert.ok(review.anomalies.some(a => a.source === 'rule' && a.issue.includes('14 天')));
    assert.deepEqual(review.anomalies.find(a => a.source === 'ai').ids, ['t1']);
});

test('budget categories can be applied to expenses but not change approved ones', async () => {
    const { request, store } = fixture();
    store.set('finance:budgets', JSON.stringify([{ id: 'b1', name: '器材', planned: 10000 }, { id: 'b2', name: '活動', planned: 5000 }]));
    store.set('finance:transactions', JSON.stringify([
        { id: 't1', kind: 'expense', status: 'pending', budgetId: '' },
        { id: 't2', kind: 'expense', status: 'approved', budgetId: 'b1' },
        { id: 't3', kind: 'income', status: 'pending', budgetId: '' },
        { id: 't4', kind: 'expense', status: 'approved', budgetId: '' }
    ]));
    const patch = (id, budgetId, who = 'finance') => request(`/api/finance/transactions/${id}/budget`, who, 'PATCH', { budgetId });
    assert.equal((await patch('t1', 'b1', 'cadre')).status, 403);
    assert.equal((await patch('t1', 'zzz')).status, 400);
    assert.equal((await patch('t1', 'b2')).status, 200);
    assert.equal((await patch('t2', 'b2')).status, 409);
    assert.equal((await patch('t3', 'b1')).status, 400);
    assert.equal((await patch('t4', 'b1')).status, 200);
    assert.equal((await patch('missing', 'b1')).status, 404);
    const saved = JSON.parse(store.get('finance:transactions'));
    assert.equal(saved[0].budgetId, 'b2');
    assert.equal(saved[0].budgetSetBy, 'finance');
});

test('AI member import cleans rows and is limited to roster managers', async (t) => {
    const { request } = fixture({ GROQ_API_KEY: 'gsk' });
    assert.equal((await request('/api/ai/member-import', 'cadre', 'POST', { text: 'x' })).status, 403);
    assert.equal((await request('/api/ai/member-import', 'finance', 'POST', { text: '' })).status, 400);
    mockAi(t, [{ rows: [{ name: '王小明', studentId: ' b11 234567 ', level: '幹部', feeStatus: '學期會籍', feeSemester: '115-1', joinedAt: '昨天' }, { name: '', studentId: '' }], notes: '請確認學號' }]);
    const result = await (await request('/api/ai/member-import', 'finance', 'POST', { text: '王小明 b11234567' })).json();
    assert.equal(result.rows.length, 1);
    assert.deepEqual(result.rows[0], { name: '王小明', studentId: 'B11234567', email: '', phone: '', position: '', note: '', joinedAt: '', level: '正式社員', feeStatus: '學期會籍', feeSemester: '115-1' });
    assert.equal(sanitizeMemberRows({ rows: [{ name: 'a', feeStatus: '未繳費', feeSemester: '115-1' }] }).rows[0].feeSemester, '');
});

test('regulation review returns AI findings with the system-determined procedure', async (t) => {
    const { request } = fixture({ GROQ_API_KEY: 'gsk' });
    assert.equal((await request('/api/ai/regulation-review', 'member', 'POST', { regulationId: 'x' })).status, 403);
    const regulations = await (await request('/api/regulations', 'cadre')).json();
    const bylaw = regulations.find(item => item.kind === 'bylaw');
    const calls = mockAi(t, [{ summary: '調整社費', changes: ['第二條'], concerns: [{ level: 'urgent', text: '與章程牴觸' }, 'plain'], suggestions: [] }]);
    const response = await request('/api/ai/regulation-review', 'cadre', 'POST', { action: 'amend', regulationId: bylaw.id, content: `${bylaw.content}\n第九十九條 新增`, needsAssembly: true });
    assert.equal(response.status, 200);
    const review = await response.json();
    assert.deepEqual(review.concerns, [{ level: 'medium', text: '與章程牴觸' }, { level: 'medium', text: 'plain' }]);
    assert.equal(review.requirements.assembly, 'ordinary');
    assert.match(calls[0].body.messages[1].content, /參考法規/);
    assert.equal((await request('/api/ai/regulation-review', 'cadre', 'POST', { amendmentId: 'missing' })).status, 404);
});

test('weekly report runs without AI, hides restricted figures, and posts to the webhook', async (t) => {
    const { request, store, env } = fixture({ REPORT_WEBHOOK_URL: 'https://hooks.example.com/abc' });
    store.set('members:list', JSON.stringify(members));
    const posted = [];
    t.mock.method(globalThis, 'fetch', async (url, init) => { posted.push({ url: String(url), body: JSON.parse(init.body) }); return new Response('ok'); });
    assert.equal((await request('/api/ai/reports', 'cadre', 'POST', {})).status, 403);
    const created = await request('/api/ai/reports', 'president', 'POST', {});
    assert.equal(created.status, 201);
    const report = await created.json();
    assert.equal(report.stats.members.total, 2);
    assert.equal(report.stats.members.unpaid, 1);
    assert.equal(report.webhook, 'sent');
    assert.match(posted[0].body.content, /每週社務報告/);

    const forCadre = await (await request('/api/ai/reports', 'cadre')).json();
    assert.equal(forCadre[0].stats.members, undefined);
    assert.doesNotMatch(forCadre[0].text, /社員：/);
    const forPresident = await (await request('/api/ai/reports', 'president')).json();
    assert.match(forPresident[0].text, /社員：共 2 人/);
    assert.equal((await request('/api/ai/reports', 'member')).status, 403);

    // The Cron trigger stores another report.
    const pending = [];
    await worker.scheduled({ cron: '0 1 * * 1' }, env, { waitUntil: promise => pending.push(promise) });
    await Promise.all(pending);
    assert.equal(JSON.parse(store.get('ai:reports')).length, 2);
});

test('AI status reports provider and per-role features', async () => {
    const { request } = fixture({ GEMINI_API_KEY: 'g', AI_DAILY_LIMIT: '50' });
    const status = await (await request('/api/ai/status', 'cadre')).json();
    assert.deepEqual({ enabled: status.enabled, provider: status.provider, limit: status.dailyLimit }, { enabled: true, provider: 'gemini', limit: 50 });
    assert.equal(status.features.content, true);
    assert.equal(status.features.finance, false);
    assert.equal((await request('/api/ai/status', null)).status, 401);
});

test('rule-based finance checks find duplicates and stale items', () => {
    const findings = financeChecks([
        { id: 'a', date: '2026-11-01', item: '電池', amount: 1, kind: 'expense', status: 'approved' },
        { id: 'b', date: '2026-11-01', item: '電池 ', amount: 1, kind: 'expense', status: 'pending', createdAt: '2026-11-17T00:00:00Z' },
        { id: 'c', date: '2026-11-01', item: '電池', amount: 1, kind: 'expense', status: 'rejected' }
    ], '2026-11-18');
    assert.equal(findings.length, 1);
    assert.deepEqual(findings[0].ids, ['a', 'b']);
});
