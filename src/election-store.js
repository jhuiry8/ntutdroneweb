// Serialized storage for club elections (社團選舉).
//
// One Durable Object instance runs every operation in a storage transaction,
// so "check the voter has not voted, then record the vote" is atomic: two
// requests for the same student ID (or the same device) can never both cast a
// ballot.
//
// Ballot secrecy (秘密投票) is kept by storing two things that are never linked:
//   voter:<election>:<studentId>  who voted, when, from which IP and device
//                                 (the participation and audit record)
//   ballot:<election>:<random>    which option was chosen, nothing else
// A ballot has no timestamp, no voter, no IP and no device, and its key is a
// random value, so listing ballots says nothing about who cast them or in what
// order. The only time both are known together is inside the single
// transaction that writes them. Results are only counted after voting closes.

const ELECTION_PREFIX = 'election:';
const ROLL_PREFIX = 'roll:';
const VOTER_PREFIX = 'voter:';
const DEVICE_PREFIX = 'device:';
const BALLOT_PREFIX = 'ballot:';
const TOKEN_PREFIX = 'token:';
const EVENT_PREFIX = 'event:';
const TOKEN_TTL_MS = 10 * 60 * 1000;
const MAX_EVENTS_PER_ELECTION = 5000;
export const MAX_ELECTIONS = 200;

function reply(status, body) { return { status, body }; }

function randomId(bytes = 16) {
    return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), value => value.toString(16).padStart(2, '0')).join('');
}

// Normalizes a name for matching: no spaces, full-width letters folded, case-insensitive.
export function nameKey(value) {
    return String(value ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}
export function studentIdKey(value) {
    return String(value ?? '').normalize('NFKC').replace(/\s+/g, '').toUpperCase();
}

// Options a voter may choose. With a single candidate the vote is 同意／不同意.
export function ballotOptions(election) {
    const candidates = Array.isArray(election?.candidates) ? election.candidates : [];
    if (candidates.length === 1) return [{ id: 'approve', label: `同意 ${candidates[0].name}` }, { id: 'reject', label: `不同意 ${candidates[0].name}` }];
    return candidates.map(candidate => ({ id: candidate.id, label: `${candidate.number}號 ${candidate.name}` }));
}

// Voting is accepted only while the election is open and inside its time window.
export function votingOpen(election, now = Date.now()) {
    if (!election || election.status !== 'open') return false;
    if (election.startsAt && now < Date.parse(election.startsAt)) return false;
    if (election.endsAt && now >= Date.parse(election.endsAt)) return false;
    return true;
}

export class ElectionStore {
    constructor(ctx) {
        this.ctx = ctx;
        this.storage = ctx.storage;
    }

    async fetch(request) {
        try {
            if (request.method !== 'POST') return Response.json({ error: '方法不允許' }, { status: 405 });
            const path = new URL(request.url).pathname;
            const payload = await request.json();
            const result = await this.storage.transaction(storage => this.handle(path, payload, storage, Date.now()));
            return Response.json(result.body, { status: result.status });
        } catch (error) {
            console.error('Election store operation failed', error?.message || String(error));
            return Response.json({ error: '選舉資料操作失敗' }, { status: 500 });
        }
    }

    async getElection(storage, id) {
        if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id)) return null;
        return await storage.get(ELECTION_PREFIX + id) || null;
    }

    async countPrefix(storage, prefix) {
        return (await storage.list({ prefix })).size;
    }

    async logEvent(storage, electionId, now, event) {
        const prefix = `${EVENT_PREFIX}${electionId}:`;
        const key = `${prefix}${String(now).padStart(15, '0')}-${randomId(4)}`;
        await storage.put(key, { ...event, at: new Date(now).toISOString() });
        const events = await storage.list({ prefix });
        if (events.size > MAX_EVENTS_PER_ELECTION) await storage.delete([...events.keys()].slice(0, events.size - MAX_EVENTS_PER_ELECTION));
    }

    async summary(storage, election) {
        const voters = await this.countPrefix(storage, `${VOTER_PREFIX}${election.id}:`);
        return { ...election, voterCount: voters };
    }

    async handle(path, payload, storage, now) {
        if (path === '/list') {
            const elections = [...(await storage.list({ prefix: ELECTION_PREFIX })).values()];
            const list = [];
            for (const election of elections) list.push(await this.summary(storage, election));
            return reply(200, list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))));
        }
        if (path === '/get') {
            const election = await this.getElection(storage, payload.id);
            return election ? reply(200, await this.summary(storage, election)) : reply(404, { error: '選舉不存在' });
        }
        if (path === '/create') {
            if (await this.countPrefix(storage, ELECTION_PREFIX) >= MAX_ELECTIONS) return reply(409, { error: `選舉數量已達上限 ${MAX_ELECTIONS} 筆，請先刪除舊的草稿` });
            const election = payload.election;
            if (!election?.id || await this.getElection(storage, election.id)) return reply(409, { error: '選舉編號重複' });
            await storage.put(ELECTION_PREFIX + election.id, election);
            return reply(201, await this.summary(storage, election));
        }
        if (path === '/update') {
            const election = await this.getElection(storage, payload.id);
            if (!election) return reply(404, { error: '選舉不存在' });
            if (!['draft', 'published'].includes(election.status)) return reply(409, { error: '投票開始後不能再修改選舉內容與候選人' });
            const updated = { ...election, ...payload.fields, id: election.id, status: election.status, createdAt: election.createdAt, createdBy: election.createdBy };
            await storage.put(ELECTION_PREFIX + election.id, updated);
            return reply(200, await this.summary(storage, updated));
        }
        if (path === '/delete') {
            const election = await this.getElection(storage, payload.id);
            if (!election) return reply(404, { error: '選舉不存在' });
            if (!['draft', 'published'].includes(election.status)) return reply(409, { error: '已開始投票的選舉不能刪除，紀錄需保存備查' });
            await storage.delete(ELECTION_PREFIX + election.id);
            return reply(200, { success: true });
        }
        if (path === '/status') return this.changeStatus(storage, payload, now);
        if (path === '/verify') return this.verifyVoter(storage, payload, now);
        if (path === '/cast') return this.castBallot(storage, payload, now);
        if (path === '/results') {
            const election = await this.getElection(storage, payload.id);
            if (!election) return reply(404, { error: '選舉不存在' });
            if (election.status !== 'closed') return reply(409, { error: '投票結束後才會開票' });
            return reply(200, await this.tally(storage, election));
        }
        if (path === '/audit') {
            const election = await this.getElection(storage, payload.id);
            if (!election) return reply(404, { error: '選舉不存在' });
            const voters = [...(await storage.list({ prefix: `${VOTER_PREFIX}${election.id}:` })).values()]
                .sort((a, b) => String(a.votedAt).localeCompare(String(b.votedAt)));
            const events = [...(await storage.list({ prefix: `${EVENT_PREFIX}${election.id}:` })).values()].reverse();
            const roll = await storage.get(ROLL_PREFIX + election.id) || [];
            return reply(200, { election: await this.summary(storage, election), voters, events, rollSize: roll.length, flags: auditFlags(voters, events) });
        }
        return reply(404, { error: '操作不存在' });
    }

    async changeStatus(storage, payload, now) {
        const election = await this.getElection(storage, payload.id);
        if (!election) return reply(404, { error: '選舉不存在' });
        const action = payload.action;
        const at = new Date(now).toISOString();
        if (action === 'publish') {
            if (election.status !== 'draft') return reply(409, { error: '只有草稿可以公告' });
            if (!election.candidates?.length) return reply(409, { error: '請先登錄至少一位候選人' });
            election.status = 'published';
            election.publishedAt = at;
        } else if (action === 'unpublish') {
            if (election.status !== 'published') return reply(409, { error: '只有已公告、尚未投票的選舉可以撤回' });
            election.status = 'draft';
        } else if (action === 'open') {
            if (!['draft', 'published'].includes(election.status)) return reply(409, { error: '此選舉不能開始投票' });
            if (!election.candidates?.length) return reply(409, { error: '請先登錄至少一位候選人' });
            const roll = Array.isArray(payload.roll) ? payload.roll : [];
            if (!roll.length) return reply(409, { error: '名冊中沒有符合資格的選舉人，無法開始投票' });
            // The electoral roll is frozen when voting opens; later roster edits cannot add voters.
            await storage.put(ROLL_PREFIX + election.id, roll);
            election.status = 'open';
            election.openedAt = at;
            election.rollSize = roll.length;
        } else if (action === 'close') {
            if (election.status !== 'open') return reply(409, { error: '只有投票中的選舉可以結束' });
            election.status = 'closed';
            election.closedAt = at;
            const tokens = await storage.list({ prefix: TOKEN_PREFIX });
            const stale = [...tokens].filter(([, value]) => value.electionId === election.id).map(([key]) => key);
            if (stale.length) await storage.delete(stale);
        } else if (action === 'publish-results' || action === 'hide-results') {
            if (election.status !== 'closed') return reply(409, { error: '投票結束後才能公布結果' });
            election.resultsPublic = action === 'publish-results';
        } else return reply(400, { error: '操作無效' });
        election.updatedBy = String(payload.username || '');
        election.updatedAt = at;
        await storage.put(ELECTION_PREFIX + election.id, election);
        await this.logEvent(storage, election.id, now, { type: `status:${action}`, by: String(payload.username || '') });
        return reply(200, await this.summary(storage, election));
    }

    // Step 1: the student ID and name must match one entry of the frozen roll.
    async verifyVoter(storage, payload, now) {
        const election = await this.getElection(storage, payload.id);
        if (!election) return reply(404, { error: '選舉不存在' });
        const meta = payload.meta || {};
        if (!votingOpen(election, now)) return reply(409, { error: '目前不在投票時間內' });
        const studentId = studentIdKey(payload.studentId);
        const name = nameKey(payload.name);
        const roll = await storage.get(ROLL_PREFIX + election.id) || [];
        const entry = roll.find(item => item.studentId === studentId && item.name === name);
        if (!entry) {
            await this.logEvent(storage, election.id, now, { type: 'verify-failed', studentId: studentId.slice(0, 30), ...meta });
            return reply(403, { error: '學號與姓名不符，或不在本次選舉人名冊中（須為具表決權之社員）。' });
        }
        if (await storage.get(`${VOTER_PREFIX}${election.id}:${studentId}`)) {
            await this.logEvent(storage, election.id, now, { type: 'verify-already-voted', studentId, ...meta });
            return reply(409, { error: '此學號已完成投票，每人限投一票。' });
        }
        if (election.oneVotePerDevice && meta.deviceId && await storage.get(`${DEVICE_PREFIX}${election.id}:${meta.deviceId}`)) {
            await this.logEvent(storage, election.id, now, { type: 'verify-device-used', studentId, ...meta });
            return reply(409, { error: '此裝置已投過票。為防止代投，每台裝置只能投一票，請改用你自己的手機或電腦。' });
        }
        const token = randomId(24);
        await storage.put(TOKEN_PREFIX + token, { electionId: election.id, studentId, displayName: entry.displayName || '', deviceId: meta.deviceId || '', expiresAt: now + TOKEN_TTL_MS });
        await this.logEvent(storage, election.id, now, { type: 'verify-ok', studentId, ...meta });
        return reply(200, { token, expiresInSeconds: TOKEN_TTL_MS / 1000, displayName: entry.displayName || '', options: ballotOptions(election) });
    }

    // Step 2: one-time token → participation record + secret ballot, written together.
    async castBallot(storage, payload, now) {
        const election = await this.getElection(storage, payload.id);
        if (!election) return reply(404, { error: '選舉不存在' });
        const meta = payload.meta || {};
        const tokenKey = TOKEN_PREFIX + String(payload.token || '').slice(0, 100);
        const token = await storage.get(tokenKey);
        if (!token || token.electionId !== election.id || token.expiresAt <= now) {
            if (token) await storage.delete(tokenKey);
            return reply(401, { error: '驗證已過期，請重新輸入學號與姓名。' });
        }
        // The token only works on the device that passed verification.
        if (token.deviceId && token.deviceId !== meta.deviceId) {
            await this.logEvent(storage, election.id, now, { type: 'cast-device-mismatch', studentId: token.studentId, ...meta });
            return reply(401, { error: '驗證與投票須在同一裝置完成，請重新驗證。' });
        }
        if (!votingOpen(election, now)) return reply(409, { error: '投票已結束' });
        const choice = String(payload.choice || '');
        if (!ballotOptions(election).some(option => option.id === choice)) return reply(400, { error: '請選擇一個有效的選項' });
        const voterKey = `${VOTER_PREFIX}${election.id}:${token.studentId}`;
        if (await storage.get(voterKey)) {
            await storage.delete(tokenKey);
            return reply(409, { error: '此學號已完成投票，每人限投一票。' });
        }
        const deviceKey = meta.deviceId ? `${DEVICE_PREFIX}${election.id}:${meta.deviceId}` : '';
        if (election.oneVotePerDevice && deviceKey && await storage.get(deviceKey)) {
            await storage.delete(tokenKey);
            return reply(409, { error: '此裝置已投過票，每台裝置只能投一票。' });
        }
        const votedAt = new Date(now).toISOString();
        // Participation record: who, when, where from. Never what.
        await storage.put(voterKey, { studentId: token.studentId, name: token.displayName, votedAt, ...meta });
        if (deviceKey) await storage.put(deviceKey, true);
        // Secret ballot: only the choice, under a random key.
        await storage.put(`${BALLOT_PREFIX}${election.id}:${randomId(16)}`, { choice });
        await storage.delete(tokenKey);
        await this.logEvent(storage, election.id, now, { type: 'voted', studentId: token.studentId, ...meta });
        return reply(201, { success: true, votedAt });
    }

    async tally(storage, election) {
        const ballots = [...(await storage.list({ prefix: `${BALLOT_PREFIX}${election.id}:` })).values()];
        const options = ballotOptions(election);
        const counts = Object.fromEntries(options.map(option => [option.id, 0]));
        for (const ballot of ballots) if (ballot?.choice in counts) counts[ballot.choice]++;
        const voters = await this.countPrefix(storage, `${VOTER_PREFIX}${election.id}:`);
        const rollSize = election.rollSize || (await storage.get(ROLL_PREFIX + election.id) || []).length;
        return {
            electionId: election.id,
            totalBallots: ballots.length,
            voters,
            rollSize,
            turnout: rollSize ? ballots.length / rollSize : 0,
            options: options.map(option => ({ ...option, votes: counts[option.id] }))
        };
    }
}

// Patterns worth a closer look: several voters from one IP or one device, and
// repeated failed verifications (someone guessing other people's student IDs).
export function auditFlags(voters, events) {
    const flags = [];
    const group = (items, field) => {
        const map = new Map();
        for (const item of items) {
            const value = item[field];
            if (!value) continue;
            if (!map.has(value)) map.set(value, new Set());
            map.get(value).add(item.studentId);
        }
        return map;
    };
    for (const [ip, ids] of group(voters, 'ip')) {
        if (ids.size >= 3) flags.push({ level: 'warn', kind: 'shared-ip', value: ip, studentIds: [...ids], message: `同一 IP（${ip}）有 ${ids.size} 人投票；校園或宿舍網路可能共用 IP，請搭配裝置資訊判斷。` });
    }
    for (const [device, ids] of group(voters, 'deviceId')) {
        if (ids.size >= 2) flags.push({ level: 'danger', kind: 'shared-device', value: device, studentIds: [...ids], message: `同一裝置有 ${ids.size} 位選舉人投票，可能為代投。` });
    }
    for (const [fingerprint, ids] of group(voters, 'fingerprint')) {
        if (ids.size >= 3) flags.push({ level: 'warn', kind: 'shared-fingerprint', value: fingerprint, studentIds: [...ids], message: `${ids.size} 位選舉人的裝置特徵相同；同型號手機可能相同，若 IP 也相同則可能為同一人代投。` });
    }
    const failures = events.filter(event => event.type === 'verify-failed');
    for (const [ip, ids] of group(failures, 'ip')) {
        const count = failures.filter(event => event.ip === ip).length;
        if (count >= 5) flags.push({ level: 'warn', kind: 'failed-verify', value: ip, studentIds: [...ids], message: `IP ${ip} 驗證失敗 ${count} 次（試過 ${ids.size} 個學號），可能在猜測他人身分。` });
    }
    const verifiedElsewhere = new Map();
    for (const event of events) {
        if (event.type !== 'verify-ok' || !event.deviceId) continue;
        if (!verifiedElsewhere.has(event.deviceId)) verifiedElsewhere.set(event.deviceId, new Set());
        verifiedElsewhere.get(event.deviceId).add(event.studentId);
    }
    for (const [device, ids] of verifiedElsewhere) {
        if (ids.size >= 2 && !flags.some(flag => flag.kind === 'shared-device' && flag.value === device)) {
            flags.push({ level: 'warn', kind: 'device-multi-verify', value: device, studentIds: [...ids], message: `同一裝置以 ${ids.size} 個不同學號通過驗證。` });
        }
    }
    return flags;
}
