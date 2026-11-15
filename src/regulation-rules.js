// Amendment procedure for club regulations, following the club charter (組織章程)
// revised 115.09.01:
//   - Charter (章程): proposed by the 法規監察委員會 or by five or more formal members
//     (第十三條第一款); passed by a general assembly with two thirds of all voting members
//     present and two thirds of those present agreeing (第十條第四款); takes effect only
//     after the school has acknowledged it (第十三條第三款).
//   - Bylaws (細則／守則): passed by an officers' meeting and approved by the president
//     (各細則施行條文). A major change to members' rights and duties, or to the fee
//     standard, must also be confirmed by a general assembly, which uses the ordinary
//     quorum: one third present, half of those present agreeing (第十條第三款).
//   - School rules: the club cannot amend them; only the school's newly announced
//     text may replace the stored copy.
export const REGULATION_KINDS = {
    charter: '組織章程',
    bylaw: '施行細則',
    school: '學校法規'
};

export const AMENDMENT_ACTIONS = { amend: '修正', create: '制定', repeal: '廢止' };
export const AMENDMENT_STATUSES = {
    proposed: '提案中',
    awaiting_school: '已通過，待學校核備',
    effective: '已生效',
    rejected: '未通過',
    withdrawn: '已撤回'
};
export const CHARTER_SOURCES = { committee: '法規監察委員會提出', petition: '正式社員連署提出' };
export const MIN_PETITION_SIGNERS = 5;

export class RegulationRuleError extends Error {}

function count(value, field) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0 || number > 100000) throw new RegulationRuleError(`${field}需為 0 以上的整數`);
    return number;
}

// Minimum counts so the numbers can be shown before the vote is recorded.
// "三分之二以上" and "二分之一以上" include the exact fraction.
export function assemblyThresholds(total, attendance, major) {
    const attend = major ? Math.ceil(total * 2 / 3) : Math.ceil(total / 3);
    const agree = major ? Math.ceil(attendance * 2 / 3) : Math.ceil(attendance / 2);
    return { attendance: attend, agree };
}

// Validates an assembly vote. Returns the stored record or throws with the reason it failed.
export function checkAssembly(input, major) {
    const total = count(input?.total, '社員總額');
    const attendance = count(input?.attendance, '出席人數');
    const agree = count(input?.agree, '同意人數');
    if (total < 1) throw new RegulationRuleError('社員總額至少 1 人');
    if (attendance > total) throw new RegulationRuleError('出席人數不可超過社員總額');
    if (agree > attendance) throw new RegulationRuleError('同意人數不可超過出席人數');
    const need = assemblyThresholds(total, attendance, major);
    const rule = major ? '社員總額三分之二以上出席、出席社員三分之二以上同意' : '社員總額三分之一以上出席、出席社員二分之一以上同意';
    if (attendance < need.attendance) throw new RegulationRuleError(`出席人數未達門檻：需 ${need.attendance} 人以上（${rule}）`);
    if (agree < need.agree) throw new RegulationRuleError(`同意人數未達門檻：需 ${need.agree} 人以上（${rule}）`);
    return { total, attendance, agree, rule };
}

export function checkProposalSource(kind, source, signers) {
    if (kind !== 'charter') return {};
    if (!CHARTER_SOURCES[source]) throw new RegulationRuleError('章程修正案須由法規監察委員會提出，或由正式社員連署提出（章程第十三條）');
    if (source === 'petition') {
        const number = count(signers, '連署人數');
        if (number < MIN_PETITION_SIGNERS) throw new RegulationRuleError(`章程修正案連署需正式社員 ${MIN_PETITION_SIGNERS} 人以上（章程第十三條）`);
        return { source, signers: number };
    }
    return { source };
}

// What a resolution must contain for this kind of regulation.
export function requirementsFor(kind, needsAssembly) {
    if (kind === 'charter') return { assembly: 'major', officersMeeting: false, presidentApproval: false, school: true };
    if (kind === 'school') return { assembly: null, officersMeeting: false, presidentApproval: false, schoolAnnouncement: true };
    return { assembly: needsAssembly ? 'ordinary' : null, officersMeeting: true, presidentApproval: true, school: false };
}
