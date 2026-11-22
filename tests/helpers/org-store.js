import { OrgStore } from '../../src/org-store.js';
import { FileStore } from '../../src/file-store.js';

// In-memory Durable Object whose transactions run one at a time, like the real runtime.
export function durableObject(Class) {
    const values = new Map();
    let tail = Promise.resolve();
    const storage = {
        async get(key) { return structuredClone(values.get(key)); },
        async put(key, value) { values.set(key, structuredClone(value)); },
        async delete(keys) { for (const key of [].concat(keys)) values.delete(key); },
        async list({ prefix = '', limit = Infinity } = {}) {
            return new Map([...values.entries()].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit).map(([k, v]) => [k, structuredClone(v)]));
        },
        transaction(callback) { const result = tail.then(() => callback(storage)); tail = result.catch(() => {}); return result; }
    };
    const object = new Class({ storage });
    return { idFromName: name => name, get: () => ({ fetch: (input, init) => object.fetch(input instanceof Request ? input : new Request(input, init)) }), values };
}

export const createOrgStore = () => durableObject(OrgStore);
export const createFileStore = () => durableObject(FileStore);

// Adds an ORG_STORE binding to an env.
export function withOrgStore(env) { env.ORG_STORE = createOrgStore(); return env; }
