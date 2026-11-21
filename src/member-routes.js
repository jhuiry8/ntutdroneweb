// HTTP routes for the member roster (社員名冊) and membership fee receipts.
import { MEMBER_LEVELS, semesterOf, parseMemberLevel, parseFeeStatus, validSemester, membershipStatus, receiptFeeType, applyFeeReceipt } from './membership.js';
import { canManageMembers } from './auth.js';
import { PayloadTooLargeError, readJsonLimited, readJsonObject } from './request.js';
import { sessionUser, listUsers } from './session.js';
import { ValidationError, financeAmount, financeText, financeDate, importedDate, parseStoredList } from './validation.js';
import { MEMBERS_KEY, MEMBERSHIP_RECEIPTS_KEY } from './kv-keys.js';
import { academicYearOf, trialSummary, trialUsesIn } from './classes.js';
import { classAttendanceCounts } from './class-routes.js';

export function normalizeMemberInput(body, index = null, defaultJoinedAt = true) {
    const prefix = index === null ? '' : `第 ${index + 1} 筆：`;
    const name = String(body?.name ?? '').trim();
    const studentId = String(body?.studentId ?? '').trim().toUpperCase();
    const email = String(body?.email ?? '').trim().toLowerCase();
    const phone = String(body?.phone ?? '').trim();
    const position = String(body?.position ?? '').trim();
    const note = String(body?.note ?? '').trim();
    if ((!name && !studentId) || name.length > 50 || studentId.length > 30) throw new ValidationError(`${prefix}請至少填寫姓名或學號，且姓名不可超過 50 字、學號不可超過 30 字`);
    if (email.length > 100 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new ValidationError(`${prefix}Email 格式無效或超過 100 字`);
    if (phone.length > 30 || position.length > 60 || note.length > 1000) throw new ValidationError(`${prefix}電話、職務或備註超過允許長度`);
    const joinedAt = String(body?.joinedAt ?? '').trim();
    const level = body?.level ? parseMemberLevel(body.level) : 'member';
    if (!level) throw new ValidationError(`${prefix}社員身分無效（可填 非正式社員、正式社員、籌備幹部、正式幹部）`);
    const feeStatus = body?.feeStatus ? parseFeeStatus(body.feeStatus) : 'unpaid';
    if (!feeStatus) throw new ValidationError(`${prefix}社費狀態無效（可填 未繳費、一年會籍、在學會籍）`);
    let feeSemester = String(body?.feeSemester ?? '').trim();
    if (feeStatus === 'semester' && !feeSemester) feeSemester = semesterOf();
    if (feeStatus !== 'semester') feeSemester = '';
    if (feeSemester && !validSemester(feeSemester)) throw new ValidationError(`${prefix}會籍學期格式須為「115-1」`);
    const trialUses = body?.trialUses === undefined || body?.trialUses === '' || body?.trialUses === null ? 0 : Number(body.trialUses);
    if (!Number.isInteger(trialUses) || trialUses < 0 || trialUses > 99) throw new ValidationError(`${prefix}體驗社課次數需為 0 至 99 的整數`);
    return { name, studentId, email, phone, position, note, joinedAt: joinedAt ? importedDate(joinedAt) : (defaultJoinedAt ? new Date().toISOString().slice(0, 10) : ''), level, feeStatus, feeSemester, trialUses };
}

// Roster entry as shown to officers: stored fields, derived status and the bound login account.
// Free trial classes are counted per academic year (社課簽到), so the counter shown here is the
// current year's; the raw stored value may belong to an older year.
function memberView(member, accountsByMember, attendanceCounts) {
    const trial = trialSummary(member);
    return {
        ...member, trialUses: trial.trialUses,
        status: { ...membershipStatus(member), trialUses: trial.trialUses, trialRemaining: trial.trialRemaining },
        account: accountsByMember?.get(member.id) || '',
        attendance: attendanceCounts?.[member.id] || { total: 0, year: 0 }
    };
}

export async function accountsByMemberId(env) {
    return new Map((await listUsers(env)).filter(user => user.memberId).map(user => [user.memberId, user.username]));
}

// Returns a Response for /api/members* and /api/member-fee-receipts*, or null for any other path.
export async function handleMemberRequest(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (path === '/api/members/import' && method === 'POST') {
        const user = await sessionUser(request, env);
        if (!user) return Response.json({ error: '未授權' }, { status: 401 });
        if (!canManageMembers(user)) return Response.json({ error: '權限不足' }, { status: 403 });
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) return Response.json({ error: 'Content-Type 必須為 application/json' }, { status: 415 });
        const contentLength = Number(request.headers.get('Content-Length') || 0);
        if (contentLength > 1_000_000) throw new PayloadTooLargeError(1_000_000);
        const body = await readJsonLimited(request, 1_000_000);
        if (!Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > 500) return Response.json({ error: '一次匯入需為 1 至 500 筆資料' }, { status: 400 });
        const members = parseStoredList(await env.DRONE_DB.get(MEMBERS_KEY));
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
        const members = parseStoredList(await env.DRONE_DB.get(MEMBERS_KEY));
        if (method === 'GET') {
            const query = String(url.searchParams.get('q') || '').trim().toLowerCase();
            const filter = String(url.searchParams.get('filter') || '');
            const accounts = await accountsByMemberId(env);
            const attendance = await classAttendanceCounts(env);
            let list = members.map(member => memberView(member, accounts, attendance));
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

    // Bulk update or delete selected roster entries (全選後批次修改).
    if (path === '/api/members/bulk' && method === 'POST') {
        const user = await sessionUser(request, env);
        if (!user) return Response.json({ error: '未授權' }, { status: 401 });
        if (!canManageMembers(user)) return Response.json({ error: '權限不足' }, { status: 403 });
        const body = await readJsonObject(request);
        const ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter(id => typeof id === 'string'))] : [];
        if (!ids.length || ids.length > 1000) return Response.json({ error: '請選擇 1 至 1,000 位社員' }, { status: 400 });
        const members = parseStoredList(await env.DRONE_DB.get(MEMBERS_KEY));
        const selected = new Set(ids);
        const targets = members.filter(member => selected.has(member.id));
        if (targets.length !== ids.length) return Response.json({ error: '部分社員已不存在，請重新整理後再試' }, { status: 409 });
        if (body.action === 'delete') {
            await env.DRONE_DB.put(MEMBERS_KEY, JSON.stringify(members.filter(member => !selected.has(member.id))));
            for (const account of (await listUsers(env)).filter(item => selected.has(item.memberId))) {
                delete account.memberId;
                await env.DRONE_DB.put(`user:${account.username}`, JSON.stringify(account));
            }
            return Response.json({ updated: 0, deleted: targets.length });
        }
        const changes = {};
        if (body.level) changes.level = body.level;
        if (body.feeStatus) { changes.feeStatus = body.feeStatus; changes.feeSemester = body.feeSemester || ''; }
        if (!Object.keys(changes).length) return Response.json({ error: '請選擇要修改的身分或社費狀態' }, { status: 400 });
        // Validate every row first so a bad value changes nothing.
        const updates = targets.map(member => normalizeMemberInput({ ...member, ...changes, ...(changes.feeStatus ? {} : { feeSemester: member.feeSemester }) }, null, false));
        const now = new Date().toISOString();
        targets.forEach((member, index) => Object.assign(member, { level: updates[index].level, feeStatus: updates[index].feeStatus, feeSemester: updates[index].feeSemester, updatedAt: now }));
        await env.DRONE_DB.put(MEMBERS_KEY, JSON.stringify(members));
        return Response.json({ updated: targets.length, deleted: 0 });
    }

    if (path.startsWith('/api/members/') && method === 'PATCH') {
        const user = await sessionUser(request, env);
        if (!user) return Response.json({ error: '未授權' }, { status: 401 });
        if (!canManageMembers(user)) return Response.json({ error: '權限不足' }, { status: 403 });
        const id = path.slice('/api/members/'.length);
        const members = parseStoredList(await env.DRONE_DB.get(MEMBERS_KEY));
        const member = members.find(item => item.id === id);
        if (!member) return Response.json({ error: '社員不存在' }, { status: 404 });
        const body = await readJsonObject(request);
        const fields = normalizeMemberInput({ ...member, trialUses: trialUsesIn(member, academicYearOf()), ...body }, null, false);
        const studentId = fields.studentId;
        if (studentId && members.some(item => item.id !== id && String(item.studentId || '').trim().toUpperCase() === studentId)) return Response.json({ error: '學號已存在' }, { status: 409 });
        // An officer changing the free-class counter means "this year's count", so it is stamped with the current year.
        if (fields.trialUses !== trialUsesIn(member, academicYearOf())) fields.trialYear = academicYearOf();
        Object.assign(member, fields, { updatedAt: new Date().toISOString() });
        await env.DRONE_DB.put(MEMBERS_KEY, JSON.stringify(members));
        return Response.json(memberView(member, await accountsByMemberId(env), await classAttendanceCounts(env)));
    }

    if (path === '/api/member-fee-receipts' && ['GET', 'POST'].includes(method)) {
        const user = await sessionUser(request, env);
        if (!user) return Response.json({ error: '未授權' }, { status: 401 });
        if (!canManageMembers(user)) return Response.json({ error: '權限不足' }, { status: 403 });
        const receipts = parseStoredList(await env.DRONE_DB.get(MEMBERSHIP_RECEIPTS_KEY));
        if (method === 'GET') return Response.json(receipts.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)));
        const body = await readJsonObject(request);
        let memberId = typeof body.memberId === 'string' ? body.memberId : '';
        const members = parseStoredList(await env.DRONE_DB.get(MEMBERS_KEY));
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
        const feeType = receiptFeeType(body.feeType, amount, date);
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
        const receipts = parseStoredList(await env.DRONE_DB.get(MEMBERSHIP_RECEIPTS_KEY));
        if (!receipts.some(item => item.id === id)) return Response.json({ error: '簽收紀錄不存在' }, { status: 404 });
        await env.DRONE_DB.put(MEMBERSHIP_RECEIPTS_KEY, JSON.stringify(receipts.filter(item => item.id !== id)));
        return Response.json({ success: true });
    }

    if (path.startsWith('/api/members/') && method === 'DELETE') {
        const user = await sessionUser(request, env);
        if (!user) return Response.json({ error: '未授權' }, { status: 401 });
        if (!canManageMembers(user)) return Response.json({ error: '權限不足' }, { status: 403 });
        const id = path.slice('/api/members/'.length);
        const members = parseStoredList(await env.DRONE_DB.get(MEMBERS_KEY));
        if (!members.some(member => member.id === id)) return Response.json({ error: '社員不存在' }, { status: 404 });
        await env.DRONE_DB.put(MEMBERS_KEY, JSON.stringify(members.filter(member => member.id !== id)));
        // Release any login account bound to the removed roster entry.
        for (const account of (await listUsers(env)).filter(item => item.memberId === id)) {
            delete account.memberId;
            await env.DRONE_DB.put(`user:${account.username}`, JSON.stringify(account));
        }
        return Response.json({ success: true });
    }

    return null;
}
