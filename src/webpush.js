// Web Push (RFC 8030 + VAPID RFC 8292 + aes128gcm payload encryption RFC 8291) on the Workers
// WebCrypto API, so the browser shows a notification even when no tab of the site is open.
// Secrets: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (base64url, see tools/generate-vapid.mjs),
// optional VAPID_SUBJECT (mailto: or https: contact, default this site).
const encoder = new TextEncoder();

export const b64urlEncode = bytes => {
    let text = '';
    for (const byte of new Uint8Array(bytes)) text += String.fromCharCode(byte);
    return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const b64urlDecode = text => {
    const padded = String(text).replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(String(text).length / 4) * 4, '=');
    return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
};
const concat = (...parts) => {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) { out.set(part, offset); offset += part.length; }
    return out;
};

// Only the browsers' own push services are ever contacted (the endpoint comes from the client).
const PUSH_HOSTS = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.microsoft\.com$/];
export function validEndpoint(endpoint) {
    try {
        const url = new URL(endpoint);
        return url.protocol === 'https:' && !url.port && endpoint.length <= 600 && PUSH_HOSTS.some(pattern => pattern.test(url.hostname));
    } catch { return false; }
}

export function pushConfigured(env) {
    return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

async function vapidHeader(env, endpoint) {
    const publicBytes = b64urlDecode(env.VAPID_PUBLIC_KEY);
    const key = await crypto.subtle.importKey('jwk', {
        kty: 'EC', crv: 'P-256', d: env.VAPID_PRIVATE_KEY, x: b64urlEncode(publicBytes.slice(1, 33)), y: b64urlEncode(publicBytes.slice(33, 65)), ext: true
    }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const claims = { aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || 'mailto:admin@example.com' };
    const unsigned = `${b64urlEncode(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))}.${b64urlEncode(encoder.encode(JSON.stringify(claims)))}`;
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(unsigned));
    return `vapid t=${unsigned}.${b64urlEncode(signature)}, k=${env.VAPID_PUBLIC_KEY}`;
}

const hkdf = async (secret, salt, info, bytes) => crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info }, await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']), bytes * 8);

// aes128gcm body for one subscription ({ keys: { p256dh, auth } }).
export async function encryptPayload(subscription, plaintext) {
    const userPublic = b64urlDecode(subscription.keys.p256dh);
    const authSecret = b64urlDecode(subscription.keys.auth);
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const serverPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    const userKey = await crypto.subtle.importKey('raw', userPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: userKey }, pair.privateKey, 256));
    const ikm = new Uint8Array(await hkdf(shared, authSecret, concat(encoder.encode('WebPush: info\0'), userPublic, serverPublic), 32));
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const cek = await hkdf(ikm, salt, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdf(ikm, salt, encoder.encode('Content-Encoding: nonce\0'), 12);
    const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(encoder.encode(plaintext), new Uint8Array([2]))));
    return concat(salt, new Uint8Array([0, 0, 0x10, 0]), new Uint8Array([serverPublic.length]), serverPublic, cipher);
}

// Sends one notification. Resolves { ok, status, gone } and never throws; `gone` means the
// subscription is dead (unsubscribed or expired) and should be forgotten.
export async function sendWebPush(env, subscription, payload, { ttl = 3600, urgency = 'normal', fetcher = fetch } = {}) {
    try {
        if (!pushConfigured(env) || !validEndpoint(subscription?.endpoint)) return { ok: false, status: 0, gone: false };
        const response = await fetcher(subscription.endpoint, {
            method: 'POST',
            headers: {
                Authorization: await vapidHeader(env, subscription.endpoint), 'Content-Encoding': 'aes128gcm',
                'Content-Type': 'application/octet-stream', TTL: String(ttl), Urgency: urgency
            },
            body: await encryptPayload(subscription, JSON.stringify(payload))
        });
        return { ok: response.ok, status: response.status, gone: response.status === 404 || response.status === 410 };
    } catch { return { ok: false, status: 0, gone: false }; }
}
