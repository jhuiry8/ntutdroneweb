// Internal-only export endpoint shared by every Durable Object. The Worker's
// routes never forward a caller-chosen path to a Durable Object, so only code
// inside this Worker (the backup job) can reach it.
export const EXPORT_PATH = '/__backup-export';

export function isExportRequest(request) {
    return request.method === 'POST' && new URL(request.url).pathname === EXPORT_PATH;
}

// Every stored entry as [key, value] pairs, optionally leaving out throwaway
// prefixes (e.g. CAPTCHA challenges). storage.list() has no limit by default.
export async function exportStorage(storage, { skipPrefixes = [] } = {}) {
    const entries = [];
    for (const [key, value] of await storage.list()) {
        if (skipPrefixes.some(prefix => key.startsWith(prefix))) continue;
        entries.push([key, value]);
    }
    return Response.json({ entries });
}
