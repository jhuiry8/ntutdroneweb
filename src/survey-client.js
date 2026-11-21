// Small client for the SurveyStore Durable Object, shared by the survey routes and the class check-in page.
import { SurveyError, surveyState, canFillSurvey } from './surveys.js';

export async function surveyStore(env, op, payload = {}) {
    if (!env.SURVEY_STORE) throw new SurveyError('此網站尚未設定 SURVEY_STORE，問卷功能無法使用', 503);
    const stub = env.SURVEY_STORE.get(env.SURVEY_STORE.idFromName('club-surveys'));
    const response = await stub.fetch(`https://survey-store/${op}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await response.json();
    if (response.status >= 500) throw new Error(body?.error || 'Survey store failed');
    return { status: response.status, body };
}

// '/survey/<id>' of the open feedback survey linked to a class or event (members may be asked to sign in), or ''.
// Never throws: the check-in page must keep working when the survey store is missing or down.
export async function feedbackPathFor(env, type, id, now = new Date().toISOString()) {
    if (!env.SURVEY_STORE) return '';
    try {
        const { body } = await surveyStore(env, 'by-link', { type, linkId: id });
        const open = body.filter(survey => surveyState(survey, now) === 'open' && canFillSurvey(survey, { username: 'x', officer: false }))
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        return open[0] ? `/survey/${open[0].id}` : '';
    } catch (error) {
        console.error('Feedback link lookup failed', error?.message || String(error));
        return '';
    }
}
