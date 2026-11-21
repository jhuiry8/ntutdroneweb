// Club meetings: general assemblies (社員大會), officers' meetings and the
// regulation committee. Covers the notice, agenda, attendance and quorum,
// anonymous online voting with thresholds from the charter (組織章程第十條、
// 第九條第四款、第十二條第五款) and the minutes. All changes to one meeting go
// through MeetingStore, a Durable Object, so concurrent check-ins and ballots
// are applied one at a time.
import { assemblyThresholds } from './regulation-rules.js';
import { isExportRequest, exportStorage } from './do-export.js';

export class MeetingError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
}

export const MEETING_TYPES = {
    assembly: { label: '定期社員大會', assembly: true, threshold: 'ordinary' },
    extraordinary: { label: '臨時社員大會', assembly: true, threshold: 'ordinary' },
    officers: { label: '幹部會議', assembly: false, threshold: 'majority' },
    committee: { label: '法規監察委員會會議', assembly: false, threshold: 'committee' }
};
export const MEETING_STATUSES = { draft: '籌備中', announced: '已公告', open: '開會中', closed: '已散會' };
export const AGENDA_KINDS = { report: '報告事項', discussion: '討論事項', election: '選舉', motion: '臨時動議' };
export const THRESHOLDS = {
    none: { label: '不表決' },
    ordinary: { label: '一般決議（社員總額 1/3 出席、出席 1/2 同意）', basis: '章程第十條第三款' },
    major: { label: '重大決議（社員總額 2/3 出席、出席 2/3 同意）', basis: '章程第十條第四款' },
    recall: { label: '罷免案（社員總額 1/2 出席、出席 2/3 同意）', basis: '章程第九條第四款' },
    committee: { label: '委員會決議（委員 1/2 出席、出席 1/2 同意，可否同數不通過）', basis: '章程第十二條第五款' },
    majority: { label: '過半數（出席過半數同意，可否同數不通過）', basis: '會議慣例' }
};
const TRANSITIONS = { draft: ['announced'], announced: ['draft', 'open'], open: ['closed'], closed: ['open'] };
export const MAX_AGENDA_ITEMS = 30;
export const MAX_ATTENDEES = 1000;

function text(value, field, max, required = false) {
    const result = String(value ?? '').replace(/\r\n?/g, '\n').trim();
    if (required && !result) throw new MeetingError(`請填寫${field}`);
    if (result.length > max) throw new MeetingError(`${field}不可超過 ${max} 字`);
    return result;
}
function isoDate(value) {
    const date = String(value ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new MeetingError('會議日期格式錯誤');
    return date;
}
function count(value, field) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0 || number > 100000) throw new MeetingError(`${field}需為 0 以上的整數`);
    return number;
}
const newId = () => crypto.randomUUID();

// Six characters without look-alikes (0/O, 1/I/L) so it is easy to read out loud.
export function randomCode() {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    return Array.from(crypto.getRandomValues(new Uint8Array(6)), byte => alphabet[byte % alphabet.length]).join('');
}
const sameName = (a, b) => String(a ?? '').replace(/\s+/g, '').toLowerCase() === String(b ?? '').replace(/\s+/g, '').toLowerCase();

// Finds the roster entry for a 學號 + 姓名 pair; both must match.
export function findMemberByIdentity(roster, studentId, name) {
    const id = String(studentId ?? '').replace(/\s+/g, '').toUpperCase();
    if (!id || !String(name ?? '').trim()) return null;
    return roster.find(member => String(member.studentId || '').replace(/\s+/g, '').toUpperCase() === id && sameName(member.name, name)) || null;
}

// Minimum attendance and agreement for a vote, given the electorate and those present.
export function voteRequirement(threshold, total, attendance) {
    if (threshold === 'ordinary' || threshold === 'major') {
        const need = assemblyThresholds(total, attendance, threshold === 'major');
        return { attendance: need.attendance, agree: need.agree, tieFails: false };
    }
    if (threshold === 'recall') return { attendance: Math.ceil(total / 2), agree: Math.ceil(attendance * 2 / 3), tieFails: false };
    if (threshold === 'committee') return { attendance: Math.ceil(total / 2), agree: Math.ceil(attendance / 2), tieFails: true };
    if (threshold === 'majority') return { attendance: 1, agree: Math.floor(attendance / 2) + 1, tieFails: true };
    return null;
}

export function voteResult(threshold, { total, attendance, agree, oppose = 0, abstain = 0 }) {
    const need = voteRequirement(threshold, total, attendance);
    if (!need) return null;
    const base = { total, attendance, agree, oppose, abstain, needAttendance: need.attendance, needAgree: need.agree, basis: THRESHOLDS[threshold].basis };
    if (attendance < need.attendance) return { ...base, passed: false, reason: `出席 ${attendance} 人，未達法定 ${need.attendance} 人，不得作成決議` };
    if (agree < need.agree) return { ...base, passed: false, reason: `同意 ${agree} 票，未達 ${need.agree} 票` };
    if (need.tieFails && agree <= oppose) return { ...base, passed: false, reason: '可否同數，不通過' };
    return { ...base, passed: true, reason: `同意 ${agree} 票，達 ${need.agree} 票門檻，通過` };
}

function normalizeAgenda(items, type, previous = []) {
    if (!Array.isArray(items)) return previous;
    if (items.length > MAX_AGENDA_ITEMS) throw new MeetingError(`議程最多 ${MAX_AGENDA_ITEMS} 項`);
    return items.map((item, index) => {
        const old = previous.find(entry => entry.id === item?.id);
        const kind = AGENDA_KINDS[item?.kind] ? item.kind : 'discussion';
        const threshold = THRESHOLDS[item?.threshold] ? item.threshold : (kind === 'report' ? 'none' : MEETING_TYPES[type].threshold);
        if (old && old.vote.state !== 'none' && old.threshold !== threshold) throw new MeetingError(`第 ${index + 1} 案已開始表決，不能更改表決門檻`);
        return {
            id: old?.id || newId(),
            title: text(item?.title, `第 ${index + 1} 案案由`, 200, true),
            description: text(item?.description, `第 ${index + 1} 案說明`, 3000),
            kind, threshold,
            amendmentId: /^[\w-]{1,80}$/.test(String(item?.amendmentId || '')) ? item.amendmentId : '',
            notes: old ? old.notes : text(item?.notes, `第 ${index + 1} 案紀錄`, 5000),
            resolution: old ? old.resolution : '',
            vote: old?.vote || { state: 'none', agree: 0, oppose: 0, abstain: 0, voters: [], result: null, source: '' }
        };
    });
}

export function newMeeting(input, username, now) {
    const type = MEETING_TYPES[input?.type] ? input.type : 'assembly';
    const meeting = {
        id: newId(), type, status: 'draft', createdBy: username, createdAt: now, updatedAt: now,
        attendance: [], guests: [], totalMembers: null, minutes: { content: '', generatedAt: '', updatedBy: '', finalizedAt: '', finalizedBy: '' }, notice: '', agenda: []
    };
    return applyMeetingFields(meeting, { ...input, type }, true);
}

// Editable meeting details. Date, place and agenda are fixed once the meeting has opened.
export function applyMeetingFields(meeting, input, creating = false) {
    if (meeting.minutes?.finalizedAt) throw new MeetingError('會議紀錄已定稿，不能再修改');
    const locked = !creating && ['open', 'closed'].includes(meeting.status);
    if (!locked) {
        meeting.title = text(input?.title ?? meeting.title, '會議名稱', 120, true);
        meeting.date = isoDate(input?.date ?? meeting.date);
        const time = String(input?.time ?? meeting.time ?? '');
        if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new MeetingError('開會時間格式錯誤');
        meeting.time = time;
        meeting.location = text(input?.location ?? meeting.location, '地點', 200);
        const onlineUrl = text(input?.onlineUrl ?? meeting.onlineUrl, '線上會議連結', 500);
        if (onlineUrl && !/^https:\/\//.test(onlineUrl)) throw new MeetingError('線上會議連結必須以 https:// 開頭');
        meeting.onlineUrl = onlineUrl;
        if (!creating && input?.type && input.type !== meeting.type && MEETING_TYPES[input.type]) meeting.type = input.type;
    }
    meeting.convener = text(input?.convener ?? meeting.convener, '召集人', 50);
    meeting.chair = text(input?.chair ?? meeting.chair, '主席', 50);
    meeting.recorder = text(input?.recorder ?? meeting.recorder, '紀錄', 50);
    meeting.keywords = text(input?.keywords ?? meeting.keywords, '會議重點', 3000);
    meeting.notice = text(input?.notice ?? meeting.notice, '開會通知', 20000);
    const code = String(input?.checkInCode ?? meeting.checkInCode ?? '').trim().toUpperCase();
    if (code && !/^[A-Z0-9]{4,12}$/.test(code)) throw new MeetingError('簽到碼需為 4 至 12 位英數字');
    meeting.checkInCode = code;
    if (input?.totalMembers !== undefined && input.totalMembers !== null && input.totalMembers !== '') meeting.totalMembers = count(input.totalMembers, '應出席人數');
    // 學號＋姓名 check-in for members without accounts: one device per member, protected by the
    // on-site check-in code. IP addresses are only recorded for the chair, never used to block.
    if (input?.guestAccess !== undefined) meeting.guestAccess = input.guestAccess === true;
    else if (creating) meeting.guestAccess = MEETING_TYPES[meeting.type].assembly;
    if (input?.agenda !== undefined) {
        // Items may be added during the meeting (臨時動議), but voted items cannot be removed.
        const keptIds = new Set((Array.isArray(input.agenda) ? input.agenda : []).map(item => item?.id));
        if (meeting.agenda.some(item => item.vote.state !== 'none' && !keptIds.has(item.id))) throw new MeetingError('已表決的議案不能刪除');
        meeting.agenda = normalizeAgenda(input.agenda, meeting.type, meeting.agenda);
    }
    return meeting;
}

export function countedAttendance(meeting) {
    return meeting.attendance.filter(entry => !MEETING_TYPES[meeting.type].assembly || entry.voting).length;
}

// Applies one change to a meeting. Throws MeetingError when it is not allowed.
// `actor` = { username, officer, memberId, voting, name }; `context` holds server-computed values.
export function applyMeetingOp(meeting, op, payload, actor, now) {
    if (op === 'update') return applyMeetingFields(meeting, payload.fields || {});

    if (op === 'status') {
        const next = payload.status;
        if (!(TRANSITIONS[meeting.status] || []).includes(next)) throw new MeetingError(`無法從「${MEETING_STATUSES[meeting.status]}」改為「${MEETING_STATUSES[next] || next}」`);
        if (next === 'open' && meeting.minutes.finalizedAt) throw new MeetingError('會議紀錄已定稿');
        if (next === 'closed' && meeting.agenda.some(item => item.vote.state === 'open')) throw new MeetingError('還有議案正在投票，請先結束投票');
        if (next === 'open' && meeting.totalMembers === null) meeting.totalMembers = count(payload.totalMembers ?? 0, '應出席人數');
        // Guest check-in always needs an on-site code; create one if the chair did not set it.
        if (next === 'open' && meeting.guestAccess && !meeting.checkInCode) meeting.checkInCode = randomCode();
        meeting.status = next;
        meeting[`${next}At`] = now;
        return meeting;
    }

    if (op === 'attend') {
        if (meeting.status !== 'open' && !(actor.officer && meeting.status === 'announced')) throw new MeetingError('會議尚未開始，無法簽到');
        if (payload.remove) {
            if (!actor.officer) throw new MeetingError('只有幹部可以移除簽到', 403);
            meeting.attendance = meeting.attendance.filter(entry => entry.memberId !== payload.memberId);
            meeting.guests = (meeting.guests || []).filter(entry => entry.memberId !== payload.memberId);
            return meeting;
        }
        const attendee = payload.attendee;
        if (!attendee?.memberId) throw new MeetingError('請先在「系統設定」確認帳號已綁定社員資料，才能簽到');
        if (!actor.officer) {
            if (meeting.checkInCode && String(payload.code || '').trim().toUpperCase() !== meeting.checkInCode) throw new MeetingError('簽到碼錯誤，請向主席確認現場公布的簽到碼');
            if (!MEETING_TYPES[meeting.type].assembly) throw new MeetingError('幹部會議與委員會議由主席登記出席');
        }
        if (meeting.attendance.some(entry => entry.memberId === attendee.memberId)) throw new MeetingError('已經簽到過了', 409);
        if (meeting.attendance.length >= MAX_ATTENDEES) throw new MeetingError('簽到人數已達上限');
        meeting.attendance.push({ memberId: attendee.memberId, name: text(attendee.name, '姓名', 50) || '（未填姓名）', voting: attendee.voting === true, at: now, by: actor.officer && payload.byOfficer ? actor.username : 'self' });
        return meeting;
    }

    if (op === 'guest-checkin') {
        if (!meeting.guestAccess) throw new MeetingError('這場會議未開放學號姓名簽到', 403);
        if (meeting.status !== 'open') throw new MeetingError('會議尚未開始或已散會，目前不能簽到', 403);
        if (!meeting.checkInCode || String(payload.code || '').trim().toUpperCase() !== meeting.checkInCode) throw new MeetingError('簽到碼錯誤，請看現場公布的簽到碼');
        meeting.guests ||= [];
        const attendee = payload.attendee;
        const device = meeting.guests.find(entry => entry.tokenHash === payload.deviceHash);
        if (device && device.memberId !== attendee.memberId) throw new MeetingError('這台裝置已經替另一位社員簽到過，一台裝置只能簽到一人', 409);
        const existing = meeting.attendance.find(entry => entry.memberId === attendee.memberId);
        if (existing) {
            if (device) return meeting; // same member, same device: just signing back in
            throw new MeetingError('這個學號已經簽到過（可能在其他裝置）。如需更換裝置，請洽主席重設', 409);
        }
        if (meeting.attendance.length >= MAX_ATTENDEES) throw new MeetingError('簽到人數已達上限');
        meeting.guests.push({ memberId: attendee.memberId, tokenHash: payload.tokenHash, ip: String(payload.ip || '').slice(0, 64), at: now });
        meeting.attendance.push({ memberId: attendee.memberId, name: text(attendee.name, '姓名', 50) || '（未填姓名）', voting: attendee.voting === true, at: now, by: 'guest', ip: String(payload.ip || '').slice(0, 64) });
        return meeting;
    }

    const item = meeting.agenda.find(entry => entry.id === payload.itemId);
    if (op === 'notes') {
        if (!item) throw new MeetingError('找不到議案', 404);
        if (meeting.minutes.finalizedAt) throw new MeetingError('會議紀錄已定稿，不能再修改');
        item.notes = text(payload.notes, '議案紀錄', 5000);
        item.resolution = text(payload.resolution ?? item.resolution, '決議', 2000);
        return meeting;
    }

    if (op === 'vote') {
        if (!item) throw new MeetingError('找不到議案', 404);
        if (item.threshold === 'none') throw new MeetingError('此議案設定為不表決');
        if (meeting.status !== 'open') throw new MeetingError('會議開會中才能表決');
        const action = payload.action;
        if (action === 'open') {
            if (item.vote.state === 'open') throw new MeetingError('已在投票中', 409);
            if (meeting.agenda.some(entry => entry.vote.state === 'open')) throw new MeetingError('一次只能進行一案投票，請先結束其他議案的投票');
            item.vote = { state: 'open', agree: 0, oppose: 0, abstain: 0, voters: [], result: null, source: 'online', openedAt: now, round: (item.vote.round || 0) + 1 };
            return meeting;
        }
        if (action === 'close') {
            if (item.vote.state !== 'open') throw new MeetingError('此議案沒有進行中的投票');
            item.vote.state = 'closed';
            item.vote.closedAt = now;
            item.vote.result = voteResult(item.threshold, { total: meeting.totalMembers || 0, attendance: countedAttendance(meeting), agree: item.vote.agree, oppose: item.vote.oppose, abstain: item.vote.abstain });
            if (!item.resolution) item.resolution = item.vote.result.passed ? '照案通過。' : `未通過（${item.vote.result.reason}）。`;
            return meeting;
        }
        if (action === 'manual') {
            if (item.vote.state === 'open') throw new MeetingError('請先結束線上投票');
            const tally = { agree: count(payload.agree, '同意票'), oppose: count(payload.oppose, '反對票'), abstain: count(payload.abstain, '棄權票') };
            const attendance = payload.attendance === undefined || payload.attendance === '' ? countedAttendance(meeting) : count(payload.attendance, '出席人數');
            if (tally.agree + tally.oppose + tally.abstain > attendance) throw new MeetingError('票數合計不可超過出席人數');
            item.vote = { state: 'closed', ...tally, voters: [], source: 'manual', closedAt: now, round: (item.vote.round || 0) + 1, result: voteResult(item.threshold, { total: meeting.totalMembers || 0, attendance, ...tally }) };
            item.resolution = item.vote.result.passed ? '照案通過。' : `未通過（${item.vote.result.reason}）。`;
            return meeting;
        }
        throw new MeetingError('表決動作無效');
    }

    if (op === 'ballot') {
        if (!item) throw new MeetingError('找不到議案', 404);
        if (item.vote.state !== 'open') throw new MeetingError('此議案目前沒有開放投票');
        const attendee = meeting.attendance.find(entry => entry.memberId === actor.memberId);
        if (!actor.memberId || !attendee) throw new MeetingError('請先簽到才能投票', 403);
        if (MEETING_TYPES[meeting.type].assembly && !attendee.voting) throw new MeetingError('您目前不具表決權（依社員分級細則，需為已繳費正式社員或正式幹部）', 403);
        if (item.vote.voters.includes(actor.memberId)) throw new MeetingError('您已經投過票了', 409);
        if (!['agree', 'oppose', 'abstain'].includes(payload.choice)) throw new MeetingError('請選擇同意、反對或棄權');
        // Only who has voted is kept, never which way, so the ballot stays secret.
        item.vote.voters.push(actor.memberId);
        item.vote[payload.choice] += 1;
        return meeting;
    }

    if (op === 'minutes') {
        if (meeting.minutes.finalizedAt) {
            if (!payload.unfinalize) throw new MeetingError('會議紀錄已定稿');
            if (!actor.president) throw new MeetingError('只有社長可以取消定稿', 403);
            meeting.minutes.finalizedAt = ''; meeting.minutes.finalizedBy = '';
            return meeting;
        }
        meeting.minutes.content = text(payload.content ?? meeting.minutes.content, '會議紀錄', 50000);
        meeting.minutes.updatedBy = actor.username;
        meeting.minutes.updatedAt = now;
        if (payload.generated) meeting.minutes.generatedAt = now;
        if (payload.finalize) {
            if (meeting.status !== 'closed') throw new MeetingError('散會後才能定稿會議紀錄');
            if (!meeting.minutes.content) throw new MeetingError('會議紀錄是空的');
            meeting.minutes.finalizedAt = now; meeting.minutes.finalizedBy = actor.username;
        }
        return meeting;
    }
    throw new MeetingError('會議操作不存在', 404);
}

// What a viewer may see: members never see drafts, the ballot list, or the check-in code.
export function meetingView(meeting, viewer) {
    const { attendance, guests, ...rest } = meeting;
    const view = {
        ...rest,
        typeLabel: MEETING_TYPES[meeting.type].label,
        statusLabel: MEETING_STATUSES[meeting.status],
        counted: countedAttendance(meeting),
        attendanceCount: attendance.length,
        checkedIn: Boolean(viewer.memberId && attendance.some(entry => entry.memberId === viewer.memberId)),
        canVote: Boolean(viewer.memberId && attendance.some(entry => entry.memberId === viewer.memberId && (entry.voting || !MEETING_TYPES[meeting.type].assembly))),
        attendance: viewer.officer ? attendance : [],
        requiresCode: Boolean(meeting.checkInCode),
        agenda: meeting.agenda.map(item => {
            const { voters, ...vote } = item.vote;
            const live = vote.state === 'open';
            return {
                ...item,
                thresholdLabel: THRESHOLDS[item.threshold].label,
                // Running totals are hidden while a vote is open so they cannot sway it.
                vote: live ? { state: 'open', round: vote.round, openedAt: vote.openedAt, ballots: voters.length } : { ...vote, ballots: voters.length },
                voted: Boolean(viewer.memberId && voters.includes(viewer.memberId))
            };
        })
    };
    if (!viewer.officer) {
        delete view.checkInCode;
        if (!meeting.minutes.finalizedAt) view.minutes = { content: '', finalizedAt: '' };
        view.keywords = '';
    }
    return view;
}

// What the public 學號＋姓名 page shows: no attendee names, no codes, no IPs.
export function publicMeetingView(meeting, memberId) {
    const view = meetingView(meeting, { officer: false, memberId });
    const me = meeting.attendance.find(entry => entry.memberId === memberId);
    return {
        id: view.id, title: view.title, typeLabel: view.typeLabel, status: view.status, statusLabel: view.statusLabel,
        date: view.date, time: view.time, location: view.location, onlineUrl: view.onlineUrl, notice: view.notice,
        requiresCode: view.requiresCode, guestAccess: Boolean(meeting.guestAccess), totalMembers: view.totalMembers, counted: view.counted,
        me: me ? { name: me.name, voting: me.voting, canVote: view.canVote } : null,
        agenda: view.agenda.map(item => ({ id: item.id, title: item.title, description: item.description, kindLabel: AGENDA_KINDS[item.kind], thresholdLabel: item.thresholdLabel, threshold: item.threshold, vote: item.vote, voted: item.voted, resolution: meeting.status === 'closed' ? item.resolution : '' })),
        minutes: view.minutes?.finalizedAt ? view.minutes.content : ''
    };
}

export function canSeeMeeting(meeting, viewer) {
    return viewer.officer || meeting.status !== 'draft';
}

// Facts handed to the AI to write the minutes; it must not invent anything beyond these.
export function minutesFacts(meeting) {
    return {
        會議: `${meeting.title}（${MEETING_TYPES[meeting.type].label}）`,
        時間: `${meeting.date}${meeting.time ? ` ${meeting.time}` : ''}`,
        地點: [meeting.location, meeting.onlineUrl ? '線上同步' : ''].filter(Boolean).join('／') || '（未填）',
        召集人: meeting.convener || '（未填）', 主席: meeting.chair || '（未填）', 紀錄: meeting.recorder || '（未填）',
        應出席人數: meeting.totalMembers, 實到人數: meeting.attendance.length,
        計入法定人數: countedAttendance(meeting),
        出席名單: meeting.attendance.map(entry => entry.name).slice(0, 200),
        會議重點: meeting.keywords,
        議程: meeting.agenda.map((item, index) => ({
            序號: index + 1, 類別: AGENDA_KINDS[item.kind], 案由: item.title, 說明: item.description, 現場紀錄關鍵字: item.notes,
            表決方式: THRESHOLDS[item.threshold].label,
            表決結果: item.vote.result ? { 同意: item.vote.agree, 反對: item.vote.oppose, 棄權: item.vote.abstain, 結果: item.vote.result.reason, 依據: item.vote.result.basis } : '未表決',
            決議: item.resolution
        }))
    };
}

export class MeetingStore {
    constructor(ctx) { this.storage = ctx.storage; }

    async fetch(request) {
        try {
            if (isExportRequest(request)) return await exportStorage(this.storage);
            const url = new URL(request.url);
            const payload = await request.json();
            const now = new Date().toISOString();
            const result = await this.storage.transaction(async storage => {
                if (url.pathname === '/list') return { status: 200, body: [...(await storage.list({ prefix: 'meeting:' })).values()] };
                if (url.pathname === '/create') {
                    if ((await storage.list({ prefix: 'meeting:' })).size >= 500) return { status: 409, body: { error: '會議紀錄已達 500 筆上限' } };
                    const meeting = newMeeting(payload.fields, payload.actor.username, now);
                    await storage.put(`meeting:${meeting.id}`, meeting);
                    return { status: 201, body: meeting };
                }
                const id = String(payload.id || '');
                const meeting = /^[\w-]{1,80}$/.test(id) ? await storage.get(`meeting:${id}`) : null;
                if (!meeting) return { status: 404, body: { error: '找不到會議' } };
                if (url.pathname === '/get') return { status: 200, body: meeting };
                if (url.pathname === '/delete') {
                    if (meeting.status !== 'draft' && !payload.actor.president) return { status: 409, body: { error: '已公告的會議只有社長可以刪除' } };
                    await storage.delete(`meeting:${id}`);
                    return { status: 200, body: { success: true } };
                }
                if (url.pathname === '/op') {
                    applyMeetingOp(meeting, payload.op, payload, payload.actor, now);
                    meeting.updatedAt = now;
                    await storage.put(`meeting:${id}`, meeting);
                    return { status: 200, body: meeting };
                }
                return { status: 404, body: { error: '會議操作不存在' } };
            });
            return Response.json(result.body, { status: result.status });
        } catch (error) {
            if (error instanceof MeetingError) return Response.json({ error: error.message }, { status: error.status });
            console.error('Meeting store failed', error?.message || String(error));
            return Response.json({ error: '會議資料操作失敗' }, { status: 500 });
        }
    }
}
