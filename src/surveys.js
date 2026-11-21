// 問卷／回饋表單：題目驗證、答案驗證、統計、CSV，以及 SurveyStore Durable Object。
//
// 問卷存成 `survey:<id>`，每份回覆存成 `resp:<surveyId>:<uuid>`（單一值上限 128 KiB，所以不放進問卷物件）。
// 「每人限填一次」用 `uniq:<surveyId>:<hash>` 標記，hash = sha256(問卷 salt + 身分)。
// 匿名問卷的回覆不帶任何身分，標記也不指向回覆，所以資料庫裡找不到「誰填了哪一份」；回覆時間只留日期，
// 回覆用隨機 id 當 key，列表順序也不洩漏填寫順序。因此匿名問卷不能修改答案。
import { parseEventTime, taipeiParts } from './events.js';
import { isExportRequest, exportStorage } from './do-export.js';

export class SurveyError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
}

export const SURVEY_AUDIENCES = { public: '公開', members: '社員', officers: '幹部' };
export const QUESTION_TYPES = { single: '單選', multi: '多選', dropdown: '下拉', short: '簡答', paragraph: '段落', rating: '評分', date: '日期' };
export const CHOICE_TYPES = ['single', 'multi', 'dropdown'];
export const RATING_SCALES = [5, 10];
export const RATING_STYLES = ['star', 'scale'];
export const LINK_TYPES = ['class', 'event'];

export const LIMITS = {
    surveys: 300, responses: 5000, questions: 50, options: 20,
    surveyTitle: 120, description: 2000, questionTitle: 200, questionDesc: 500, option: 80,
    short: 200, paragraph: 2000, totalAnswerChars: 20000, surveyBytes: 100000, link: 80
};

const text = (value, max) => String(value ?? '').trim().slice(0, max);
const newId = () => crypto.randomUUID();
const shortId = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), b => b.toString(36).padStart(2, '0')).join('').slice(0, 8);
const ID_PATTERN = /^[a-z0-9]{4,12}$/;
const randomHex = bytes => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), b => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

// ---- Survey definition -----------------------------------------------------

function pickId(value, used) {
    let id = typeof value === 'string' && ID_PATTERN.test(value) && !used.has(value) ? value : '';
    while (!id || used.has(id)) id = shortId();
    used.add(id);
    return id;
}

function normalizeQuestion(input, usedIds) {
    if (!input || typeof input !== 'object') throw new SurveyError('題目格式錯誤');
    const type = String(input.type || '');
    if (!QUESTION_TYPES[type]) throw new SurveyError('題型不存在');
    const title = text(input.title, LIMITS.questionTitle);
    if (!title) throw new SurveyError('每一題都需要題目文字');
    const question = { id: pickId(input.id, usedIds), type, title, description: text(input.description, LIMITS.questionDesc), required: input.required === true };
    if (CHOICE_TYPES.includes(type)) {
        if (!Array.isArray(input.options)) throw new SurveyError(`「${title}」需要選項`);
        if (input.options.length < 1 || input.options.length > LIMITS.options) throw new SurveyError(`「${title}」的選項必須是 1 至 ${LIMITS.options} 個`);
        const optionIds = new Set();
        const labels = new Set();
        question.options = input.options.map(option => {
            const label = text(typeof option === 'string' ? option : option?.label, LIMITS.option);
            if (!label) throw new SurveyError(`「${title}」有空白的選項`);
            if (labels.has(label)) throw new SurveyError(`「${title}」的選項不可重複：${label}`);
            labels.add(label);
            return { id: pickId(typeof option === 'object' ? option?.id : '', optionIds), label };
        });
    } else if (type === 'rating') {
        const scale = Number(input.scale ?? 5);
        if (!RATING_SCALES.includes(scale)) throw new SurveyError('評分題只能是 1～5 或 1～10');
        const style = input.style ?? 'star';
        if (!RATING_STYLES.includes(style)) throw new SurveyError('評分樣式必須是星等或量表');
        question.scale = scale;
        question.style = style;
    }
    return question;
}

// Fields an officer can set. `existing` (+ `responseCount`) lets an update keep ids stable and stops a
// question's type from changing once people have answered it.
export function normalizeSurveyFields(input, existing = null, responseCount = 0) {
    const pick = key => (input && input[key] !== undefined ? input[key] : existing?.[key]);
    const title = text(pick('title'), LIMITS.surveyTitle);
    if (!title) throw new SurveyError('請輸入問卷標題');
    const rawQuestions = pick('questions') ?? [];
    if (!Array.isArray(rawQuestions)) throw new SurveyError('題目必須是清單');
    if (rawQuestions.length < 1) throw new SurveyError('至少需要一個題目');
    if (rawQuestions.length > LIMITS.questions) throw new SurveyError(`題目最多 ${LIMITS.questions} 題`);
    const used = new Set();
    const questions = rawQuestions.map(question => normalizeQuestion(question, used));
    if (existing && responseCount > 0) {
        for (const question of questions) {
            const before = existing.questions.find(item => item.id === question.id);
            if (!before) continue;
            if (before.type !== question.type || (before.type === 'rating' && before.scale !== question.scale)) {
                throw new SurveyError(`「${before.title}」已有回覆，不能更改題型或評分範圍；請改為新增一題`, 409);
            }
        }
    }
    const opensAt = input?.opensAt !== undefined ? parseSurveyTime(input.opensAt, '開放時間') : (existing?.opensAt || null);
    const closesAt = input?.closesAt !== undefined ? parseSurveyTime(input.closesAt, '截止時間') : (existing?.closesAt || null);
    if (opensAt && closesAt && Date.parse(closesAt) <= Date.parse(opensAt)) throw new SurveyError('截止時間必須晚於開放時間');
    const audience = pick('audience') ?? 'public';
    if (!SURVEY_AUDIENCES[audience]) throw new SurveyError('對象必須是公開、社員或幹部');
    const anonymous = pick('anonymous') === true;
    const limitOnce = pick('limitOnce') === undefined ? true : pick('limitOnce') === true;
    // Without a once-per-person record there is nothing to edit against; anonymous answers cannot be traced back.
    const allowEdit = pick('allowEdit') === true && limitOnce && !anonymous;
    const enabled = pick('enabled') === undefined ? true : pick('enabled') !== false;
    let link = pick('link') ?? null;
    if (link) {
        if (typeof link !== 'object' || !LINK_TYPES.includes(link.type) || !/^[\w-]{1,80}$/.test(String(link.id || ''))) throw new SurveyError('關聯的社課或活動格式錯誤');
        link = { type: link.type, id: String(link.id), label: text(link.label, 160) };
    }
    const fields = { title, description: text(pick('description'), LIMITS.description), questions, opensAt, closesAt, enabled, audience, anonymous, limitOnce, allowEdit, link };
    if (JSON.stringify(fields).length > LIMITS.surveyBytes) throw new SurveyError('問卷內容太長，請減少題目或選項');
    return fields;
}

export function parseSurveyTime(value, label) {
    try { return parseEventTime(value, label); } catch (error) { throw new SurveyError(error.message); }
}

export function newSurvey(input, username, now) {
    return { id: newId(), salt: randomHex(16), ...normalizeSurveyFields(input), templateKey: String(input?.templateKey || '').slice(0, 40), createdBy: username, createdAt: now, updatedAt: now };
}

// Copy with fresh ids; starts disabled-free but unlinked so a copy never reports into someone else's class.
export function duplicateFields(survey) {
    return normalizeSurveyFields({
        ...survey, id: undefined, title: `${survey.title}（副本）`.slice(0, LIMITS.surveyTitle), link: null, opensAt: null, closesAt: null,
        questions: survey.questions.map(({ id, options, ...rest }) => ({ ...rest, ...(options ? { options: options.map(option => option.label) } : {}) }))
    });
}

// ---- Who may fill, and when -------------------------------------------------

// actor = { username, officer } (username '' = visitor)
export function canFillSurvey(survey, actor) {
    if (survey.audience === 'public') return true;
    if (survey.audience === 'members') return Boolean(actor?.username);
    return Boolean(actor?.officer);
}

export function surveyState(survey, now) {
    if (!survey.enabled) return 'closed';
    const at = Date.parse(now);
    if (survey.opensAt && at < Date.parse(survey.opensAt)) return 'notStarted';
    if (survey.closesAt && at > Date.parse(survey.closesAt)) return 'closed';
    return 'open';
}

// ---- Answers ---------------------------------------------------------------

function realDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
    if (!match) return false;
    const d = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.getUTCFullYear() === Number(match[1]) && d.getUTCMonth() + 1 === Number(match[2]) && d.getUTCDate() === Number(match[3]) && Number(match[1]) >= 1900 && Number(match[1]) <= 2200;
}

const blank = value => value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0) || (typeof value === 'string' && !value.trim());

// Checks `answers` ({ [questionId]: value }) against the questions and returns the cleaned copy.
export function validateAnswers(survey, answers) {
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new SurveyError('答案格式錯誤');
    const known = new Set(survey.questions.map(question => question.id));
    for (const key of Object.keys(answers)) if (!known.has(key)) throw new SurveyError('答案包含不存在的題目');
    const clean = {};
    let chars = 0;
    for (const question of survey.questions) {
        const value = answers[question.id];
        if (blank(value)) {
            if (question.required) throw new SurveyError(`請回答必填題目：${question.title}`);
            continue;
        }
        const bad = () => new SurveyError(`「${question.title}」的答案格式錯誤`);
        const optionIds = new Set((question.options || []).map(option => option.id));
        if (question.type === 'single' || question.type === 'dropdown') {
            if (typeof value !== 'string' || !optionIds.has(value)) throw bad();
            clean[question.id] = value;
        } else if (question.type === 'multi') {
            if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !optionIds.has(item))) throw bad();
            clean[question.id] = [...new Set(value)];
        } else if (question.type === 'rating') {
            if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > question.scale) throw bad();
            clean[question.id] = value;
        } else if (question.type === 'date') {
            if (typeof value !== 'string' || !realDate(value)) throw new SurveyError(`「${question.title}」的日期格式錯誤（YYYY-MM-DD）`);
            clean[question.id] = value;
        } else {
            if (typeof value !== 'string') throw bad();
            const max = question.type === 'short' ? LIMITS.short : LIMITS.paragraph;
            const trimmed = value.trim();
            if (trimmed.length > max) throw new SurveyError(`「${question.title}」不可超過 ${max} 字`);
            // eslint-disable-next-line no-control-regex
            if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(trimmed)) throw bad();
            if (question.type === 'short' && /[\r\n]/.test(trimmed)) throw new SurveyError(`「${question.title}」請填單行文字`);
            chars += trimmed.length;
            clean[question.id] = trimmed;
        }
    }
    if (chars > LIMITS.totalAnswerChars) throw new SurveyError('文字答案總長度過長');
    if (!Object.keys(clean).length) throw new SurveyError('請至少回答一題');
    return clean;
}

// ---- Statistics ------------------------------------------------------------

const round2 = n => Math.round(n * 100) / 100;

// responses: [{ answers, at, by? }]. denominator: people who could have answered (class attendance...) or null.
export function computeStats(survey, responses, denominator = null) {
    const count = responses.length;
    const questions = survey.questions.map(question => {
        const answered = responses.filter(response => !blank(response.answers?.[question.id]));
        const base = { id: question.id, type: question.type, title: question.title, required: question.required, answered: answered.length };
        if (CHOICE_TYPES.includes(question.type)) {
            const counts = new Map(question.options.map(option => [option.id, 0]));
            let removed = 0;
            for (const response of answered) {
                const value = response.answers[question.id];
                for (const id of question.type === 'multi' ? value : [value]) {
                    if (counts.has(id)) counts.set(id, counts.get(id) + 1); else removed++;
                }
            }
            const options = question.options.map(option => ({ id: option.id, label: option.label, count: counts.get(option.id), percent: percent(counts.get(option.id), answered.length) }));
            if (removed) options.push({ id: '', label: '（已刪除的選項）', count: removed, percent: percent(removed, answered.length) });
            return { ...base, options };
        }
        if (question.type === 'rating') {
            const distribution = Array.from({ length: question.scale }, (_, index) => ({ value: index + 1, count: 0 }));
            let sum = 0;
            for (const response of answered) {
                const value = response.answers[question.id];
                if (distribution[value - 1]) { distribution[value - 1].count++; sum += value; }
            }
            distribution.forEach(item => { item.percent = percent(item.count, answered.length); });
            return { ...base, scale: question.scale, style: question.style, average: answered.length ? round2(sum / answered.length) : null, distribution };
        }
        if (question.type === 'date') {
            const counts = new Map();
            for (const response of answered) counts.set(response.answers[question.id], (counts.get(response.answers[question.id]) || 0) + 1);
            return { ...base, dates: [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, n]) => ({ date, count: n, percent: percent(n, answered.length) })) };
        }
        // Text: the person's name only appears on non-anonymous surveys.
        return {
            ...base,
            texts: answered.map(response => ({ text: response.answers[question.id], at: response.at, ...(survey.anonymous ? {} : { by: response.by?.name || response.by?.username || '' }) }))
        };
    });
    return {
        responseCount: count,
        denominator: denominator > 0 ? denominator : null,
        responseRate: denominator > 0 ? Math.min(100, Math.round(count / denominator * 1000) / 10) : null,
        questions
    };
}
function percent(part, whole) { return whole > 0 ? Math.round(part / whole * 1000) / 10 : 0; }

// ---- CSV -------------------------------------------------------------------

// Spreadsheet programs run cells that start with = + - @ as formulas; answers are typed by strangers.
export function csvCell(value) {
    let cell = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
    return /[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

function answerText(question, value) {
    if (blank(value)) return '';
    if (CHOICE_TYPES.includes(question.type)) {
        const label = id => question.options.find(option => option.id === id)?.label ?? '（已刪除的選項）';
        return question.type === 'multi' ? value.map(label).join('; ') : label(value);
    }
    return String(value);
}

export function surveyCsv(survey, responses) {
    const header = ['填寫時間', ...(survey.anonymous ? [] : ['填寫者']), ...survey.questions.map(question => question.title)];
    const rows = responses.map(response => {
        const when = survey.anonymous ? String(response.at).slice(0, 10) : `${taipeiParts(response.at).date} ${taipeiParts(response.at).time}`;
        return [when, ...(survey.anonymous ? [] : [response.by?.name || response.by?.username || '']), ...survey.questions.map(question => answerText(question, response.answers?.[question.id]))];
    });
    // BOM so Excel reads the UTF-8 Chinese text correctly.
    return `﻿${[header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

// ---- Built-in templates ----------------------------------------------------

const opts = (...labels) => labels;
export const SURVEY_TEMPLATES = {
    'class-feedback': {
        name: '社課回饋', description: '課程滿意度、講師評分、難易度與建議。',
        build: () => ({
            title: '社課回饋', description: '謝謝你來上課！花一分鐘告訴我們你的感受，幫助我們把下一堂課做得更好。', templateKey: 'class-feedback',
            questions: [
                { type: 'rating', title: '課程整體滿意度', scale: 5, style: 'star', required: true },
                { type: 'rating', title: '講師評分（講解清楚、互動、準備充分）', scale: 5, style: 'star', required: true },
                { type: 'single', title: '課程難易度', options: opts('太簡單', '稍簡單', '剛剛好', '稍困難', '太困難'), required: true },
                { type: 'multi', title: '你希望之後多開哪些主題？', options: opts('模擬器練習', 'FPV 穿越機', '空拍與剪輯', '無人機組裝', '法規與考照', '其他') },
                { type: 'paragraph', title: '建議與想法', description: '任何想對講師或幹部說的話都歡迎。' }
            ]
        })
    },
    'event-satisfaction': {
        name: '活動滿意度', description: '活動整體評價、場地與安排、是否推薦朋友與建議。',
        build: () => ({
            title: '活動滿意度調查', description: '謝謝你參加活動！請告訴我們你的體驗。', templateKey: 'event-satisfaction',
            questions: [
                { type: 'rating', title: '活動整體滿意度', scale: 5, style: 'star', required: true },
                { type: 'rating', title: '活動安排與流程', scale: 5, style: 'star', required: true },
                { type: 'rating', title: '地點與交通便利度', scale: 5, style: 'star' },
                { type: 'multi', title: '你最喜歡活動的哪個部分？', options: opts('飛行體驗', '與社員交流', '講解與指導', '場地環境', '其他') },
                { type: 'single', title: '你會推薦朋友參加下一次活動嗎？', options: opts('會', '不確定', '不會'), required: true },
                { type: 'paragraph', title: '建議與想法' }
            ]
        })
    },
    'join-interest': {
        name: '入社意願調查', description: '了解新朋友的興趣、可參加時段與入社意願。',
        build: () => ({
            title: '入社意願調查', description: '想加入北科無人機社嗎？填寫這份問卷讓我們更認識你。', templateKey: 'join-interest',
            questions: [
                { type: 'single', title: '你目前的身分', options: opts('北科大學生', '其他學校學生', '教職員', '校友或其他'), required: true },
                { type: 'multi', title: '你對哪些領域有興趣？', options: opts('FPV 穿越機', '空拍與影像創作', '無人機組裝與調校', '模擬器練習', '證照與法規', '競賽'), required: true },
                { type: 'dropdown', title: '最方便參加社課的時段', options: opts('週一晚上', '週二晚上', '週三晚上', '週四晚上', '週五晚上', '週末白天'), required: true },
                { type: 'rating', title: '加入社團的意願（1 = 還在考慮，10 = 非常想加入）', scale: 10, style: 'scale', required: true },
                { type: 'short', title: '聯絡方式（Email 或 LINE ID，選填）' },
                { type: 'paragraph', title: '想對社團說的話' }
            ]
        })
    }
};

// ---- Durable Object --------------------------------------------------------

const respKey = (surveyId, id) => `resp:${surveyId}:${id}`;
const loadResponses = async (storage, surveyId) => [...(await storage.list({ prefix: `resp:${surveyId}:` })).values()];

async function loadSurvey(storage, id) {
    const survey = /^[\w-]{1,80}$/.test(String(id || '')) ? await storage.get(`survey:${id}`) : null;
    if (!survey) throw new SurveyError('找不到問卷', 404);
    return survey;
}

// Public view: no salt, no creator, no response data.
export function publicSurveyView(survey, now) {
    const { salt, createdBy, templateKey, ...rest } = survey;
    return { ...rest, state: surveyState(survey, now), audienceLabel: SURVEY_AUDIENCES[survey.audience] };
}

export async function surveyOp(storage, op, payload, now = new Date().toISOString()) {
    const actor = payload.actor || {};
    if (op === 'list') {
        const surveys = [...(await storage.list({ prefix: 'survey:' })).values()];
        const out = [];
        for (const survey of surveys) {
            const count = (await storage.list({ prefix: `resp:${survey.id}:` })).size;
            out.push({ survey, responseCount: count });
        }
        return { status: 200, body: out };
    }
    if (op === 'create') {
        if ((await storage.list({ prefix: 'survey:' })).size >= LIMITS.surveys) throw new SurveyError(`問卷已達 ${LIMITS.surveys} 份上限`, 409);
        const survey = newSurvey(payload.fields, actor.username || '', now);
        await storage.put(`survey:${survey.id}`, survey);
        return { status: 201, body: { survey, responseCount: 0 } };
    }
    if (op === 'by-link') {
        const found = [...(await storage.list({ prefix: 'survey:' })).values()].filter(survey => survey.link && survey.link.type === payload.type && survey.link.id === payload.linkId);
        return { status: 200, body: found };
    }
    const survey = await loadSurvey(storage, payload.id);
    const responses = op === 'get' || op === 'update' ? await loadResponses(storage, survey.id) : null;

    if (op === 'get') return { status: 200, body: { survey, responseCount: responses.length } };
    if (op === 'responses') return { status: 200, body: { survey, responses: await loadResponses(storage, survey.id) } };
    if (op === 'update') {
        const fields = normalizeSurveyFields(payload.fields, survey, responses.length);
        const updated = { ...survey, ...fields, updatedAt: now };
        await storage.put(`survey:${survey.id}`, updated);
        return { status: 200, body: { survey: updated, responseCount: responses.length } };
    }
    if (op === 'delete') {
        const keys = [`survey:${survey.id}`, ...(await storage.list({ prefix: `resp:${survey.id}:` })).keys(), ...(await storage.list({ prefix: `uniq:${survey.id}:` })).keys()];
        for (const key of keys) await storage.delete(key);
        return { status: 200, body: { success: true } };
    }
    if (op === 'duplicate') {
        if ((await storage.list({ prefix: 'survey:' })).size >= LIMITS.surveys) throw new SurveyError(`問卷已達 ${LIMITS.surveys} 份上限`, 409);
        const copy = newSurvey(duplicateFields(survey), actor.username || '', now);
        copy.templateKey = survey.templateKey || '';
        await storage.put(`survey:${copy.id}`, copy);
        return { status: 201, body: { survey: copy, responseCount: 0 } };
    }
    if (op === 'clear-responses') {
        for (const key of [...(await storage.list({ prefix: `resp:${survey.id}:` })).keys(), ...(await storage.list({ prefix: `uniq:${survey.id}:` })).keys()]) await storage.delete(key);
        return { status: 200, body: { success: true } };
    }

    // ---- filling ----
    // payload.identity: stable per-person string ('u:alice' for accounts, 'd:<hash>' for a device cookie) or ''.
    const marker = payload.identity && survey.limitOnce ? `uniq:${survey.id}:${await sha256Hex(`${survey.salt}:${payload.identity}`)}` : '';
    if (op === 'mine') {
        const existing = marker ? await storage.get(marker) : null;
        const response = existing && survey.allowEdit && typeof existing === 'string' ? await storage.get(respKey(survey.id, existing)) : null;
        return { status: 200, body: { submitted: Boolean(existing), answers: response?.answers || null } };
    }
    if (op === 'submit') {
        if (!canFillSurvey(survey, actor)) throw new SurveyError(actor.username ? '這份問卷不開放給您的身分填寫' : '請先登入後再填寫', actor.username ? 403 : 401);
        const state = surveyState(survey, now);
        if (state === 'notStarted') throw new SurveyError('問卷尚未開放', 403);
        if (state === 'closed') throw new SurveyError('問卷已截止', 403);
        const answers = validateAnswers(survey, payload.answers);
        const existing = marker ? await storage.get(marker) : null;
        if (existing) {
            if (!survey.allowEdit || typeof existing !== 'string') throw new SurveyError('您已經填寫過這份問卷了', 409);
            const previous = await storage.get(respKey(survey.id, existing));
            if (previous) {
                await storage.put(respKey(survey.id, existing), { ...previous, answers, editedAt: now });
                return { status: 200, body: { edited: true } };
            }
        }
        if ((await storage.list({ prefix: `resp:${survey.id}:` })).size >= LIMITS.responses) throw new SurveyError('這份問卷的回覆數已達上限', 409);
        const id = newId();
        const response = survey.anonymous
            ? { id, at: now.slice(0, 10), answers }
            : { id, at: now, answers, by: actor.username ? { username: actor.username, name: String(actor.name || actor.username).slice(0, 60) } : null };
        await storage.put(respKey(survey.id, id), response);
        if (marker) await storage.put(marker, survey.anonymous ? 1 : id);
        return { status: 201, body: { created: true } };
    }
    throw new SurveyError('問卷操作不存在', 404);
}

export class SurveyStore {
    constructor(ctx) { this.storage = ctx.storage; }

    async fetch(request) {
        try {
            if (isExportRequest(request)) return await exportStorage(this.storage);
            const url = new URL(request.url);
            const payload = await request.json();
            const result = await this.storage.transaction(storage => surveyOp(storage, url.pathname.slice(1), payload));
            return Response.json(result.body, { status: result.status });
        } catch (error) {
            if (error instanceof SurveyError) return Response.json({ error: error.message }, { status: error.status });
            console.error('Survey store failed', error?.message || String(error));
            return Response.json({ error: '問卷資料操作失敗' }, { status: 500 });
        }
    }
}
