import test from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { passwordHash, verifyPassword, PasswordResetRequiredError } from '../src/auth.js';

test('password hashes match PBKDF2-SHA256 at the production Workers limit', async (t) => {
    const deriveBits = crypto.subtle.deriveBits.bind(crypto.subtle);
    const limited = t.mock.method(crypto.subtle, 'deriveBits', (params, key, length) => {
        assert.ok(params.iterations <= 100000, 'Production Workers PBKDF2 iteration limit exceeded');
        return deriveBits(params, key, length);
    });
    const password = 'correct-password-密碼';
    const salt = 'fixed-test-salt';
    const expected = pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
    const hash = await passwordHash(password, salt);
    assert.equal(hash, `pbkdf2:100000:${salt}:${expected}`);
    assert.equal(await verifyPassword(password, hash), true);
    assert.equal(await verifyPassword('incorrect-password', hash), false);
    assert.equal(limited.mock.callCount(), 3);
    assert.notEqual(await passwordHash(password), await passwordHash(password));
});

test('old 120000-iteration hashes explicitly require reset instead of being reinterpreted', async (t) => {
    const legacy = `pbkdf2:old-salt:${pbkdf2Sync('old-password', 'old-salt', 120000, 32, 'sha256').toString('hex')}`;
    const deriveBits = t.mock.method(crypto.subtle, 'deriveBits', () => assert.fail('Unsupported hashes must not reach WebCrypto'));
    await assert.rejects(verifyPassword('old-password', legacy), PasswordResetRequiredError);
    assert.equal(deriveBits.mock.callCount(), 0);
});

test('malformed and unsupported password formats fail closed', async () => {
    for (const hash of [undefined, null, {}, '', 'pbkdf2:100000:salt:bad', `pbkdf2:120000:salt:${'a'.repeat(64)}`, `pbkdf2:1:salt:${'a'.repeat(64)}`]) {
        assert.equal(await verifyPassword('password', hash), false);
    }
});
