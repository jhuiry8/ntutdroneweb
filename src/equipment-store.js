// Equipment inventory (設備財產清冊): field validation, the EquipmentStore Durable
// Object that serializes every change, and the client the routes use to reach it.
import { RegulationRuleError } from './regulation-rules.js';
import { ValidationError, financeText, financeAmount, importedDate, parseStoredList } from './validation.js';
import { EQUIPMENT_KEY, EQUIPMENT_MIGRATION_KEY } from './kv-keys.js';

export function normalizeEquipmentInput(body) {
    const assetName = financeText(body?.assetName, '設備名稱', 100);
    const category = String(body?.category ?? '').trim() || '其他';
    const serialNo = String(body?.serialNo ?? '').trim();
    const location = String(body?.location ?? '').trim();
    const custodian = String(body?.custodian ?? '').trim();
    const note = String(body?.note ?? '').trim();
    if (category.length > 60 || serialNo.length > 100 || location.length > 100 || custodian.length > 50 || note.length > 1000) throw new ValidationError('設備欄位超過允許長度');
    const purchaseDateRaw = String(body?.purchaseDate ?? '').trim();
    const purchaseDate = purchaseDateRaw ? importedDate(purchaseDateRaw) : '';
    const purchasePrice = body?.purchasePrice === '' || body?.purchasePrice === null || body?.purchasePrice === undefined ? 0 : financeAmount(body.purchasePrice);
    if (purchasePrice === null) throw new ValidationError('購入金額需為 0 至 1,000,000,000 的整數');
    const condition = String(body?.condition || 'good');
    const status = String(body?.status || 'storage');
    if (!['good', 'fair', 'poor'].includes(condition)) throw new ValidationError('設備狀況無效');
    if (!['storage', 'in_use', 'repair', 'retired'].includes(status)) throw new ValidationError('設備狀態無效');
    return { assetName, category, serialNo, purchaseDate, purchasePrice, condition, status, location, custodian, note };
}

// An asset can be lent out when it sits in storage and is not flagged for repair.
export function isLoanable(asset) {
    return asset?.status === 'storage' && asset.condition !== 'poor' && !asset.currentLoan;
}

const MAX_HISTORY = 200;

export function createAssetNumber(existing) {
    const year = new Date().getUTCFullYear();
    for (let attempt = 0; attempt < 5; attempt++) {
        const suffix = Array.from(crypto.getRandomValues(new Uint8Array(5)), value => value.toString(16).padStart(2, '0')).join('').toUpperCase();
        const assetNo = `NTUT-DR-${year}-${suffix}`;
        if (!existing.some(item => item.assetNo === assetNo)) return assetNo;
    }
    throw new Error('Unable to allocate unique asset number');
}

export async function equipmentStoreRequest(env, path, payload = {}) {
    const namespace = env.EQUIPMENT_STORE;
    const stub = namespace.get(namespace.idFromName('club-equipment-inventory'));
    if (await env.DRONE_DB.get(EQUIPMENT_MIGRATION_KEY) !== '1') {
        const legacyAssets = parseStoredList(await env.DRONE_DB.get(EQUIPMENT_KEY));
        const initialized = await stub.fetch('https://equipment-store/initialize', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assets: legacyAssets })
        });
        if (!initialized.ok) return initialized;
        await env.DRONE_DB.put(EQUIPMENT_MIGRATION_KEY, '1');
    }
    return stub.fetch(`https://equipment-store${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
}

export class EquipmentStore {
    constructor(ctx) {
        this.ctx = ctx;
        this.storage = ctx.storage;
    }

    async listAssets(storage = this.storage) {
        const entries = await storage.list({ prefix: 'equipment:asset:', limit: 5001 });
        return [...entries.values()];
    }

    async fetch(request) {
        try {
            if (request.method !== 'POST') return Response.json({ error: '方法不允許' }, { status: 405 });
            const url = new URL(request.url);
            const payload = await request.json();
            const result = await this.storage.transaction(async storage => {
                    if (url.pathname === '/initialize') {
                        if (!(await storage.get('equipment:initialized'))) {
                            for (const asset of Array.isArray(payload.assets) ? payload.assets : []) {
                                if (!asset || typeof asset.id !== 'string' || !/^[\w-]{1,80}$/.test(asset.id) || typeof asset.assetNo !== 'string' || typeof asset.assetName !== 'string') continue;
                                await storage.put(`equipment:asset:${asset.id}`, asset);
                            }
                            await storage.put('equipment:initialized', true);
                        }
                        return { status: 200, body: { success: true } };
                    }
                    if (!(await storage.get('equipment:initialized'))) {
                        return { status: 503, body: { error: '設備儲存尚未初始化' } };
                    }
                    if (url.pathname === '/list') {
                        const query = String(payload.query || '').trim().toLowerCase();
                        const assets = await this.listAssets(storage);
                        return { status: 200, body: query ? assets.filter(asset => [asset.assetNo, asset.assetName, asset.category, asset.serialNo, asset.status, asset.location, asset.custodian, asset.note].some(value => String(value || '').toLowerCase().includes(query))) : assets };
                    }
                    if (url.pathname === '/create') {
                        const assets = await this.listAssets(storage);
                        if (assets.length >= 5000) return { status: 409, body: { error: '設備列管上限為 5,000 件' } };
                        const fields = normalizeEquipmentInput(payload.fields);
                        const serialNo = fields.serialNo.toUpperCase();
                        if (serialNo && assets.some(item => String(item.serialNo || '').trim().toUpperCase() === serialNo)) return { status: 409, body: { error: '原廠序號已列管' } };
                        const now = new Date().toISOString();
                        const asset = { id: crypto.randomUUID(), assetNo: createAssetNumber(assets), ...fields, createdBy: String(payload.username || ''), updatedBy: String(payload.username || ''), createdAt: now, updatedAt: now };
                        await storage.put(`equipment:asset:${asset.id}`, asset);
                        return { status: 201, body: asset };
                    }
                    // Lending is decided here, in one transaction, so two slips can never hold the same asset.
                    // Both /lend and /return are idempotent per form id, so a failed second step can simply be retried.
                    if (url.pathname === '/lend') {
                        const formId = String(payload.formId || '');
                        const ids = [...new Set(Array.isArray(payload.assetIds) ? payload.assetIds.map(String) : [])];
                        if (!formId || !ids.length) return { status: 400, body: { error: '缺少借據或設備' } };
                        const assets = [];
                        for (const id of ids) {
                            const asset = await storage.get(`equipment:asset:${id}`);
                            if (!asset) return { status: 409, body: { error: '財產冊中找不到這件設備', assetId: id } };
                            if (asset.currentLoan?.formId !== formId) {
                                const label = `${asset.assetName}（${asset.assetNo}）`;
                                if (asset.currentLoan) return { status: 409, body: { error: `${label} 已借出給 ${asset.currentLoan.borrower}（借據 ${asset.currentLoan.formNumber || '—'}），不可重複借用`, assetId: id } };
                                if (asset.status !== 'storage') return { status: 409, body: { error: `${label} 目前狀態不是庫存保管，無法借出`, assetId: id } };
                                if (asset.condition === 'poor') return { status: 409, body: { error: `${label} 待維修，無法借出`, assetId: id } };
                            }
                            assets.push(asset);
                        }
                        const now = new Date().toISOString();
                        for (const asset of assets) {
                            if (asset.currentLoan?.formId === formId) continue;
                            asset.status = 'in_use';
                            asset.currentLoan = { formId, formNumber: String(payload.formNumber || ''), borrower: String(payload.borrower || ''), startDate: String(payload.startDate || ''), endDate: String(payload.endDate || ''), since: now };
                            asset.updatedBy = String(payload.username || '');
                            asset.updatedAt = now;
                            await storage.put(`equipment:asset:${asset.id}`, asset);
                            const history = (await storage.get(`equipment:history:${asset.id}`)) || [];
                            history.push({ ...asset.currentLoan, lentBy: String(payload.username || ''), returnedAt: '', returnedBy: '' });
                            await storage.put(`equipment:history:${asset.id}`, history.slice(-MAX_HISTORY));
                        }
                        return { status: 200, body: { assets } };
                    }
                    if (url.pathname === '/return') {
                        const formId = String(payload.formId || '');
                        if (!formId) return { status: 400, body: { error: '缺少借據' } };
                        const now = new Date().toISOString();
                        const released = [];
                        for (const asset of await this.listAssets(storage)) {
                            if (asset.currentLoan?.formId !== formId) continue;
                            asset.status = 'storage';
                            delete asset.currentLoan;
                            asset.updatedBy = String(payload.username || '');
                            asset.updatedAt = now;
                            await storage.put(`equipment:asset:${asset.id}`, asset);
                            const history = (await storage.get(`equipment:history:${asset.id}`)) || [];
                            const open = history.findLastIndex(entry => entry.formId === formId && !entry.returnedAt);
                            // A rollback (the slip could not be saved) leaves no trace; a real return closes the entry.
                            if (open >= 0 && payload.rollback) history.splice(open, 1);
                            else if (open >= 0) Object.assign(history[open], { returnedAt: now, returnedBy: String(payload.username || '') });
                            await storage.put(`equipment:history:${asset.id}`, history);
                            released.push(asset.id);
                        }
                        return { status: 200, body: { released } };
                    }
                    const historyMatch = /^\/history\/([\w-]{1,80})$/.exec(url.pathname);
                    if (historyMatch) {
                        const asset = await storage.get(`equipment:asset:${historyMatch[1]}`);
                        if (!asset) return { status: 404, body: { error: '設備不存在' } };
                        const history = (await storage.get(`equipment:history:${asset.id}`)) || [];
                        return { status: 200, body: { asset: { id: asset.id, assetNo: asset.assetNo, assetName: asset.assetName, status: asset.status, currentLoan: asset.currentLoan || null }, history: history.slice().reverse() } };
                    }
                    const updateMatch = /^\/update\/([\w-]{1,80})$/.exec(url.pathname);
                    if (updateMatch) {
                        const id = updateMatch[1];
                        const asset = await storage.get(`equipment:asset:${id}`);
                        if (!asset) return { status: 404, body: { error: '設備不存在' } };
                        const fields = normalizeEquipmentInput({ ...asset, ...(payload.fields || {}) });
                        if (asset.currentLoan && fields.status !== 'in_use') return { status: 409, body: { error: `此設備借出中（借據 ${asset.currentLoan.formNumber || '—'}），請先在借據歸還` } };
                        const serialNo = fields.serialNo.toUpperCase();
                        const previousSerial = String(asset.serialNo || '').trim().toUpperCase();
                        if (serialNo && serialNo !== previousSerial && (await this.listAssets(storage)).some(item => item.id !== id && String(item.serialNo || '').trim().toUpperCase() === serialNo)) return { status: 409, body: { error: '原廠序號已列管' } };
                        Object.assign(asset, fields, { updatedBy: String(payload.username || ''), updatedAt: new Date().toISOString() });
                        await storage.put(`equipment:asset:${id}`, asset);
                        return { status: 200, body: asset };
                    }
                    return { status: 404, body: { error: '設備操作不存在' } };
                });
            return Response.json(result.body, { status: result.status });
        } catch (error) {
            if (error instanceof ValidationError || error instanceof RegulationRuleError) return Response.json({ error: error.message }, { status: 400 });
            console.error('Equipment store operation failed', error?.message || String(error));
            return Response.json({ error: '設備資料操作失敗' }, { status: 500 });
        }
    }
}