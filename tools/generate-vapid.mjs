// Prints a VAPID key pair for browser push notifications (see README「推播通知」).
//   node tools/generate-vapid.mjs
import { webcrypto as crypto } from 'node:crypto';
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
const publicRaw = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');
console.log(`VAPID_PUBLIC_KEY=${publicRaw}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
console.log('\nSet them with:\n  npx wrangler secret put VAPID_PUBLIC_KEY\n  npx wrangler secret put VAPID_PRIVATE_KEY\n  npx wrangler secret put VAPID_SUBJECT   # e.g. mailto:you@example.com');
