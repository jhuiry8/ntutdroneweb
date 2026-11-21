// Equipment loan slips (設備借據) linked to the equipment register (設備財產冊).
// Pure helpers plus the lookups that need only the EquipmentStore; the lend/return
// workflow that also touches the FormStore lives in loan-routes.js.
//
// A slip's loan state is kept on the record itself, next to (not inside) its form data:
//   record.loan = { status: 'pending' | 'lent' | 'returned' | 'rejected', assetIds, lentAt, lentBy, returnedAt, returnedBy }
// Slips without `loan` (every record made before this feature) count as 'pending'.
import { FormValidationError, taipeiToday, taipeiHour } from './forms.js';
import { equipmentStoreRequest, isLoanable } from './equipment-store.js';

export function loanStateOf(record) {
    return record?.loan?.status || 'pending';
}

export async function listAssets(env, query = '') {
    const response = await equipmentStoreRequest(env, '/list', { query });
    if (!response.ok) throw new Error('Equipment store unavailable');
    return response.json();
}

const sameSet = (a, b) => a.length === b.length && a.every(value => b.includes(value));

// Desktop and older clients send items without `assetId`. Keep the link a slip already has
// when the same row (same position and name) comes back without one.
export function carryAssetLinks(previousItems, rawItems) {
    if (!Array.isArray(rawItems) || !Array.isArray(previousItems)) return rawItems;
    return rawItems.map((item, index) => {
        const previous = previousItems[index];
        if (!item || typeof item !== 'object' || item.assetId !== undefined || !previous?.assetId) return item;
        return String(item.name ?? '').trim() === previous.name ? { ...item, assetId: previous.assetId } : item;
    });
}

// Checks the register links of a normalized loan and makes the item text match the register.
// checkLoanable: reject assets that cannot be lent now, except those in `keep` (already on this slip).
export async function linkLoanAssets(env, data, { checkLoanable = false, keep = [] } = {}) {
    const ids = data.items.map(item => item.assetId).filter(Boolean);
    if (!ids.length) return data;
    if (new Set(ids).size !== ids.length) throw new FormValidationError('同一件設備不可重複列入借據');
    let assets;
    try { assets = new Map((await listAssets(env)).map(asset => [asset.id, asset])); }
    catch { throw new FormValidationError('目前無法讀取設備財產冊，請稍後再試'); }
    return {
        ...data,
        items: data.items.map(item => {
            if (!item.assetId) return item;
            const asset = assets.get(item.assetId);
            if (!asset) throw new FormValidationError(`財產冊中找不到「${item.name || item.assetId}」`);
            if (checkLoanable && !keep.includes(asset.id) && !isLoanable(asset)) throw new FormValidationError(`「${asset.assetName}」目前無法借用（已借出、維修中或已除列）`);
            // One register entry is one physical unit.
            return { ...item, name: asset.assetName, assetNo: asset.assetNo, quantity: 1 };
        })
    };
}

// Asset ids to lend for a slip: the linked ones, plus legacy rows whose typed 財產編號 matches the register.
export function resolveAssetIds(items, assets) {
    const byNo = new Map(assets.map(asset => [String(asset.assetNo || '').toUpperCase(), asset.id]));
    const ids = [];
    for (const item of items || []) {
        const id = item.assetId || (item.assetNo && byNo.get(String(item.assetNo).trim().toUpperCase())) || '';
        if (id && !ids.includes(id)) ids.push(id);
    }
    return ids;
}

export function assetIdsChanged(previous, next) {
    return !sameSet(previous || [], next || []);
}

export function isOverdue(record, now = new Date()) {
    if (record?.type !== 'equipment-loan' || loanStateOf(record) !== 'lent') return false;
    const today = taipeiToday(now);
    const { endDate, endHour } = record.data || {};
    return endDate < today || (endDate === today && Number(endHour ?? 23) < taipeiHour(now));
}

const dayNumber = iso => Date.parse(`${iso}T00:00:00Z`) / 86400000;

// Slips that are out on loan, soonest due first, with an `overdue` flag.
export function activeLoans(records, now = new Date()) {
    const today = taipeiToday(now);
    return records
        .filter(record => record.type === 'equipment-loan' && loanStateOf(record) === 'lent')
        .map(record => ({
            id: record.id, number: record.number || '', borrower: record.data.borrower, studentId: record.data.studentId || '', phone: record.data.phone || '',
            external: record.source === 'public', items: (record.data.items || []).map(item => item.name), assetIds: record.loan.assetIds || [],
            startDate: record.data.startDate, endDate: record.data.endDate, endHour: record.data.endHour, lentAt: record.loan.lentAt || '',
            overdue: isOverdue(record, now), daysOverdue: Math.max(0, dayNumber(today) - dayNumber(record.data.endDate))
        }))
        .sort((a, b) => a.endDate.localeCompare(b.endDate));
}

export function overdueLoans(records, now = new Date()) {
    return activeLoans(records, now).filter(loan => loan.overdue);
}
