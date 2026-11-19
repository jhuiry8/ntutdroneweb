// HTTP routes for the equipment inventory (設備管理).
import { canManageEquipment } from './auth.js';
import { readJsonObject } from './request.js';
import { sessionUser } from './session.js';
import { equipmentStoreRequest } from './equipment-store.js';

// Returns a Response for /api/equipment*, or null for any other path.
export async function handleEquipmentRequest(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // ==================== API: Equipment inventory ====================
    if (path === '/api/equipment' && ['GET', 'POST'].includes(method)) {
        const user = await sessionUser(request, env);
        if (!user) return Response.json({ error: '未授權' }, { status: 401 });
        if (!canManageEquipment(user)) return Response.json({ error: '權限不足' }, { status: 403 });
        if (method === 'GET') {
            const query = String(url.searchParams.get('q') || '').trim().toLowerCase();
            return equipmentStoreRequest(env, '/list', { query });
        }
        const body = await readJsonObject(request);
        return equipmentStoreRequest(env, '/create', { fields: body, username: user.username });
    }

    if (path.startsWith('/api/equipment/') && method === 'PATCH') {
        const user = await sessionUser(request, env);
        if (!user) return Response.json({ error: '未授權' }, { status: 401 });
        if (!canManageEquipment(user)) return Response.json({ error: '權限不足' }, { status: 403 });
        const id = path.slice('/api/equipment/'.length);
        const body = await readJsonObject(request);
        return equipmentStoreRequest(env, `/update/${encodeURIComponent(id)}`, { fields: body, username: user.username });
    }

    return null;
}
