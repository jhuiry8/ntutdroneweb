// Membership levels and fee status, following the club rules revised 115.09.01
// (社員與幹部四級分級細則 and 無人機社社費細則). The keys mirror the Django
// management system (core.User.membership_status / fee_status) so records can be
// moved between the two systems:
//   TRIAL → trial, MEMBER → member, PREP_OFFICER → prep, OFFICER → officer
//   UNPAID → unpaid, SEMESTER_PAID → semester, LIFETIME_PAID → lifetime
export const MEMBER_LEVELS = {
    trial: '非正式社員',
    member: '正式社員',
    prep: '籌備幹部',
    officer: '正式幹部'
};
export const FEE_STATUSES = {
    unpaid: '未繳費',
    semester: '學期會籍（500 元）',
    lifetime: '在學會籍（1,000 元）'
};
export const SEMESTER_FEE = 500;
export const LIFETIME_FEE = 1000;
// 四級分級細則第二條：非正式社員每學年最多免費參與二次體驗社課。
export const FREE_TRIAL_CLASSES = 2;

// Academic term in ROC years: August–January is term 1, February–July is term 2.
// 2026-11-15 → "115-1", 2027-03-01 → "115-2".
export function semesterOf(date = new Date()) {
    const value = typeof date === 'string' ? new Date(`${date.slice(0, 10)}T00:00:00Z`) : date;
    const year = value.getUTCFullYear(), month = value.getUTCMonth() + 1;
    if (month >= 8) return `${year - 1911}-1`;
    return `${year - 1912}-${month === 1 ? 1 : 2}`;
}

export function validSemester(value) { return /^\d{2,3}-[12]$/.test(value); }

// Derived status shown in the roster and on the member's own page.
// 學期會籍 is valid only for the term it was paid in (社費細則第二條第一款);
// 在學會籍 stays valid while the person is a student. Officers may be exempt
// from fees (第一條第四款) but exemption is not payment, so prep officers who
// have not paid have no vote (四級分級細則第四條第四款), while formal officers
// are treated as formal members during their term (第五條第三款).
export function membershipStatus(member, today = new Date()) {
    const level = MEMBER_LEVELS[member?.level] ? member.level : 'member';
    const feeStatus = FEE_STATUSES[member?.feeStatus] ? member.feeStatus : 'unpaid';
    const current = semesterOf(today);
    const paid = feeStatus === 'lifetime' || (feeStatus === 'semester' && member?.feeSemester === current);
    const exempt = !paid && (level === 'prep' || level === 'officer');
    let feeLabel;
    if (feeStatus === 'lifetime') feeLabel = '在學會籍';
    else if (paid) feeLabel = `學期會籍（${current}）`;
    else if (exempt) feeLabel = '幹部免繳';
    else if (feeStatus === 'semester' && member?.feeSemester) feeLabel = `未繳費（學期會籍 ${member.feeSemester} 已到期）`;
    else feeLabel = '未繳費';
    const voting = level === 'officer' || ((level === 'member' || level === 'prep') && paid);
    const trialUses = Math.max(0, Number(member?.trialUses) || 0);
    return {
        level, levelLabel: MEMBER_LEVELS[level], feeStatus, paid, exempt, feeLabel,
        unpaid: !paid && !exempt, voting, semester: current,
        trialUses, trialRemaining: level === 'trial' ? Math.max(0, FREE_TRIAL_CLASSES - trialUses) : null
    };
}

// Which fee plan a receipt pays for. An explicit choice wins; otherwise the amount decides.
export function receiptFeeType(feeType, amount) {
    if (['semester', 'lifetime', 'other'].includes(feeType)) return feeType;
    if (amount >= LIFETIME_FEE) return 'lifetime';
    if (amount >= SEMESTER_FEE) return 'semester';
    return 'other';
}

// Apply a signed fee receipt to the member record. Lifetime membership is never
// downgraded by a later semester payment. Paying moves a trial member up to a
// formal member (社費細則第五條第一款); officers keep their level.
export function applyFeeReceipt(member, feeType, date) {
    if (feeType === 'lifetime') member.feeStatus = 'lifetime';
    else if (feeType === 'semester' && member.feeStatus !== 'lifetime') {
        member.feeStatus = 'semester';
        member.feeSemester = semesterOf(date);
    } else return false;
    if (!member.level || member.level === 'trial') member.level = 'member';
    return true;
}

// Accept our keys, the Django choice codes and the Chinese labels used in
// spreadsheets, so rosters exported from either system can be imported.
const LEVEL_ALIASES = {
    trial: ['trial', 'TRIAL', '非正式社員', '體驗學員', '試聽生', '非正式社員/體驗學員'],
    member: ['member', 'MEMBER', '正式社員', '社員', '核心學員'],
    prep: ['prep', 'PREP_OFFICER', '籌備幹部', '實習幹部'],
    officer: ['officer', 'OFFICER', '正式幹部', '幹部']
};
const FEE_ALIASES = {
    unpaid: ['unpaid', 'UNPAID', '未繳費', '未繳', '否', ''],
    semester: ['semester', 'SEMESTER_PAID', '學期會籍', '學期制', '已繳單學期', '500'],
    lifetime: ['lifetime', 'LIFETIME_PAID', '在學會籍', '終身制', '已繳終身制', '1000', '1,000']
};
function lookup(aliases, value) {
    const text = String(value ?? '').trim().replace(/[（(].*[)）]$/, '').trim();
    return Object.keys(aliases).find(key => aliases[key].includes(text)) || null;
}
export function parseMemberLevel(value) { return lookup(LEVEL_ALIASES, value); }
export function parseFeeStatus(value) { return lookup(FEE_ALIASES, value); }
