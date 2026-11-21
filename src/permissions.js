// Permission codes, built-in positions (職位) and the pure functions that turn positions plus
// per-account grants/revokes into the permissions an account really has.
// No I/O here: the OrgStore Durable Object stores the settings, session.js resolves them per request.

// code -> { label (中文說明), group }. Every API route checks one of these codes, not a role.
export const PERMISSIONS = {
    'cms.view': { label: '檢視文章、頁面與幹部限定內容', group: '網站與宣傳' },
    'cms.edit': { label: '編輯文章、頁面與首頁', group: '網站與宣傳' },
    'events.manage': { label: '建立與管理活動、報名名單', group: '網站與宣傳' },
    'announce.post': { label: '發布公告、建立聊天室', group: '網站與宣傳' },
    'files.upload': { label: '上傳檔案到檔案庫', group: '網站與宣傳' },
    'files.admin': { label: '管理（修改、刪除）所有人的檔案', group: '網站與宣傳' },
    'classes.manage': { label: '建立與管理社課場次、匯出簽到', group: '教學與器材' },
    'classes.checkin': { label: '操作社課簽到', group: '教學與器材' },
    'notes.manage': { label: '新增與刪除課程備忘錄', group: '教學與器材' },
    'surveys.manage': { label: '管理問卷（預留給問卷系統）', group: '教學與器材' },
    'equipment.view': { label: '檢視設備財產冊', group: '教學與器材' },
    'equipment.manage': { label: '新增與修改設備', group: '教學與器材' },
    'loans.draft': { label: '檢視借用單並建立借用單草稿', group: '教學與器材' },
    'loans.approve': { label: '審核借用、歸還與駁回', group: '教學與器材' },
    'members.view': { label: '檢視社員名冊（含個資）', group: '行政庶務' },
    'members.edit': { label: '新增、修改、匯入與刪除社員', group: '行政庶務' },
    'meetings.manage': { label: '管理會議與會議紀錄', group: '行政庶務' },
    'forms.manage': { label: '檢視與處理所有表單（場地、空域申請等）', group: '行政庶務' },
    'receipts.manage': { label: '開立與管理社費收據', group: '財務' },
    'finance.view': { label: '檢視財務收支與預決算', group: '財務' },
    'finance.edit': { label: '登錄與修改帳冊、預算、匯入', group: '財務' },
    'finance.approve': { label: '審核收支（核准或退回）', group: '財務' },
    'finance.audit': { label: '監察：對帳目做審核紀錄（簽核或意見）', group: '監察' },
    'regulations.amend': { label: '提出法規修正草案', group: '監察' },
    'regulations.resolve': { label: '登錄修正案表決與核備結果', group: '監察' },
    'reports.view': { label: '檢視 AI 週報與社務統計', group: '報表' },
    'reports.finance': { label: '檢視財務報表與 AI 財務分析', group: '報表' },
    'site.settings': { label: '網站設定、備份、桌面程式更新、雲端硬碟與推播設定', group: '系統管理' },
    'users.manage': { label: '帳號、職位與權限管理（只能由社長授予）', group: '系統管理' },
    'officers.view': { label: '檢視幹部名冊（含聯絡資料）與匯出', group: '系統管理' },
    'officers.manage': { label: '指派幹部職位、管理任期與名冊', group: '系統管理' },
    'audit.view': { label: '檢視權限與名冊稽核紀錄', group: '系統管理' }
};
export const PERMISSION_CODES = Object.keys(PERMISSIONS);
export const isPermissionCode = code => typeof code === 'string' && Object.hasOwn(PERMISSIONS, code);

// Only a real president (or the system administrator) may grant this one, and it cannot sit on a custom position.
export const PRESIDENT_ONLY_PERMISSIONS = ['users.manage'];

// Permissions the old four roles had, derived from the old src/auth.js. Used for the one-time
// migration and as the fallback for user objects that carry no resolved `permissions`.
const LEGACY_CADRE = ['cms.view', 'cms.edit', 'notes.manage', 'events.manage', 'announce.post', 'files.upload', 'classes.manage', 'classes.checkin', 'surveys.manage',
    'equipment.view', 'equipment.manage', 'loans.draft', 'loans.approve', 'meetings.manage', 'forms.manage', 'regulations.amend'];
export const LEGACY_ROLE_PERMISSIONS = {
    president: PERMISSION_CODES,
    finance: ['cms.view', 'files.upload', 'classes.manage', 'classes.checkin', 'events.manage', 'announce.post', 'meetings.manage', 'forms.manage', 'regulations.amend',
        'equipment.view', 'equipment.manage', 'loans.draft', 'loans.approve', 'members.view', 'members.edit', 'receipts.manage',
        'finance.view', 'finance.edit', 'reports.view', 'reports.finance'],
    cadre: LEGACY_CADRE,
    member: []
};
export const ROLES = ['president', 'finance', 'cadre', 'member'];

// Built-in positions. `permissions: ['*']` means every code, including ones added later.
export const POSITIONS = {
    president: { name: '社長', group: '社長團', legacyRole: 'president', locked: true, permissions: ['*'] },
    vice: { name: '副社長', group: '社長團', legacyRole: 'cadre', permissions: ['cms.view', 'announce.post', 'meetings.manage', 'equipment.view', 'members.view', 'finance.view', 'reports.view', 'officers.view'] },
    pr: { name: '活動公關組', group: '活動公關組', legacyRole: 'cadre', permissions: ['cms.view', 'cms.edit', 'events.manage', 'announce.post', 'files.upload'] },
    tech: { name: '教學技術組', group: '教學技術組', legacyRole: 'cadre', permissions: ['cms.view', 'notes.manage', 'classes.manage', 'classes.checkin', 'surveys.manage', 'equipment.view', 'equipment.manage', 'loans.draft', 'loans.approve', 'files.upload'] },
    secretary: { name: '執行秘書', group: '行政庶務組', legacyRole: 'cadre', permissions: ['cms.view', 'meetings.manage', 'members.view', 'members.edit', 'reports.view', 'files.upload', 'officers.view'] },
    treasurer: { name: '總務', group: '行政庶務組', legacyRole: 'finance', permissions: ['cms.view', 'finance.view', 'finance.edit', 'receipts.manage', 'members.view', 'reports.finance'] },
    venue: { name: '場地', group: '行政庶務組', legacyRole: 'cadre', permissions: ['cms.view', 'forms.manage'] },
    committee_chair: { name: '法規監察委員會主任委員', group: '法規監察委員會', legacyRole: 'cadre', permissions: ['cms.view', 'finance.view', 'finance.audit', 'regulations.amend', 'reports.finance', 'officers.view', 'audit.view'] },
    committee: { name: '法規監察委員會委員', group: '法規監察委員會', legacyRole: 'cadre', permissions: ['cms.view', 'finance.view', 'finance.audit', 'regulations.amend', 'reports.finance', 'officers.view', 'audit.view'] },
    intern: { name: '實習幹部', group: '實習幹部', legacyRole: 'cadre', intern: true, permissions: ['classes.checkin', 'equipment.view', 'loans.draft'] },
    cadre: { name: '一般幹部', group: '一般幹部', legacyRole: 'cadre', permissions: LEGACY_CADRE },
    member: { name: '社員', group: '社員', legacyRole: 'member', permissions: [] }
};
// Which position a legacy role migrates to.
export const LEGACY_ROLE_POSITION = { president: 'president', finance: 'treasurer', cadre: 'cadre', member: 'member' };
// Most important first; decides the `role` shown for an account that holds several positions.
export const POSITION_PRIORITY = ['president', 'vice', 'treasurer', 'secretary', 'pr', 'tech', 'venue', 'committee_chair', 'committee', 'cadre', 'intern', 'member'];

export const CUSTOM_POSITION_ID = /^[a-z][a-z0-9_-]{1,29}$/;
// Sorting key for a position id (custom ones come after the built-in ones, before 社員).
export function positionRank(id) {
    const index = POSITION_PRIORITY.indexOf(id);
    return index >= 0 ? index : POSITION_PRIORITY.length - 1.5;
}

export function expandPermissions(list) {
    const items = Array.isArray(list) ? list : [];
    if (items.includes('*')) return [...PERMISSION_CODES];
    return items.filter(isPermissionCode);
}

// `config` = { positionOverrides: {id: [codes]}, customPositions: {id: {name, permissions, description}} }.
// Returns a map id -> { id, name, builtin, permissions[] } with the club's own changes applied.
export function positionCatalog(config = {}) {
    const result = {};
    for (const [id, base] of Object.entries(POSITIONS)) {
        const override = base.locked ? undefined : config.positionOverrides?.[id];
        result[id] = { id, name: base.name, group: base.group, builtin: true, locked: Boolean(base.locked), intern: Boolean(base.intern), legacyRole: base.legacyRole, permissions: expandPermissions(override ?? base.permissions), defaults: expandPermissions(base.permissions) };
    }
    for (const [id, custom] of Object.entries(config.customPositions || {})) {
        if (result[id]) continue;
        result[id] = { id, name: String(custom.name || id), group: '自訂職位', builtin: false, locked: false, intern: false, legacyRole: 'cadre', description: String(custom.description || ''), permissions: expandPermissions(custom.permissions).filter(code => !PRESIDENT_ONLY_PERMISSIONS.includes(code)), defaults: [] };
    }
    return result;
}

// Actual permissions = union of the positions' permissions + individual grants - individual revokes.
// While 代理社長 is on, the 副社長 also receives everything the 社長 has.
export function computePermissions({ positions = [], grants = [], revokes = [], catalog, acting = false }) {
    const set = new Set();
    const held = new Set(positions);
    if (acting && held.has('vice')) held.add('president');
    for (const id of held) for (const code of catalog[id]?.permissions || []) set.add(code);
    for (const code of grants) if (isPermissionCode(code)) set.add(code);
    for (const code of revokes) set.delete(code);
    return PERMISSION_CODES.filter(code => set.has(code));
}

// The legacy `role` shown for someone holding these positions (the most important one wins).
export function legacyRoleOf(positions, catalog = positionCatalog()) {
    const ids = [...new Set(positions)].filter(id => catalog[id]);
    if (!ids.length) return 'member';
    ids.sort((a, b) => positionRank(a) - positionRank(b));
    return catalog[ids[0]].legacyRole || 'cadre';
}

// The permission set of an account that has no resolved `permissions` (tests, tokens, bootstrap).
export function permissionsFromRole(role) { return LEGACY_ROLE_PERMISSIONS[role] || []; }

export function permissionsOf(user) {
    if (!user) return [];
    if (Array.isArray(user.permissions)) return user.permissions;
    return permissionsFromRole(user.role);
}
export function hasPermission(user, code) {
    return Boolean(user) && permissionsOf(user).includes(code);
}
export function hasAnyPermission(user, codes) {
    return codes.some(code => hasPermission(user, code));
}
