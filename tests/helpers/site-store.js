import { SiteStore } from '../../src/site-store.js';

// In-memory SiteStore Durable Object whose transactions run one at a time, like the real runtime.
export function createMockSiteStore(kv) {
    const values = new Map();
    let tail = Promise.resolve();
    const storage = {
        async get(key) { return structuredClone(values.get(key)); },
        async put(key, value) { values.set(key, structuredClone(value)); },
        async delete(keys) { for (const key of [].concat(keys)) values.delete(key); },
        async list({ prefix = '', limit } = {}) {
            const entries = [...values.entries()].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b));
            return new Map(limit ? entries.slice(0, limit) : entries);
        },
        transaction(callback) { const result = tail.then(() => callback(storage)); tail = result.catch(() => {}); return result; }
    };
    const object = new SiteStore({ storage }, { DRONE_DB: kv });
    return {
        idFromName: name => name,
        get: () => ({ fetch: (input, init) => object.fetch(new Request(input, init)) }),
        values,
        // What a person reading the CAPTCHA image would type.
        captchaCode: id => values.get(`captcha:${id}`)?.code ?? null,
        // A fresh challenge with a known answer, as if a page had shown it and a person solved it.
        issueCaptcha() {
            const id = crypto.randomUUID();
            values.set(`captcha:${id}`, { code: 'ACEFG', expiresAt: Date.now() + 300000 });
            return { captchaId: id, captcha: 'acefg' };
        }
    };
}

// Adds a SiteStore binding backed by the env's own mock KV.
export function withSiteStore(env) {
    env.SITE_STORE = createMockSiteStore(env.DRONE_DB);
    return env;
}
