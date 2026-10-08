import { randomBytes } from 'node:crypto';
import { CredentialDecryptionError, CredentialVault } from './credential-vault.js';

const key1 = randomBytes(32);
const key2 = randomBytes(32);
const SECRET = 'ya29.a0-super-secret-google-token';
const CONTEXT = 'google_connections:user-a:refresh_token';

const vaultV1 = () => new CredentialVault(new Map([['v1', key1]]), 'v1');

describe('CredentialVault', () => {
  it('round-trips and never stores the plaintext', () => {
    const vault = vaultV1();
    const encrypted = vault.encrypt(SECRET, CONTEXT);

    expect(encrypted.keyVersion).toBe('v1');
    expect(encrypted.ciphertext).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(encrypted.ciphertext).not.toContain(SECRET);
    expect(encrypted.ciphertext).not.toContain(Buffer.from(SECRET).toString('base64url'));
    expect(vault.decrypt(encrypted.ciphertext, CONTEXT)).toBe(SECRET);
  });

  it('uses a fresh IV every time', () => {
    const vault = vaultV1();
    const first = vault.encrypt(SECRET, CONTEXT).ciphertext;
    const second = vault.encrypt(SECRET, CONTEXT).ciphertext;
    expect(first).not.toBe(second);
    expect(first.split('.')[1]).not.toBe(second.split('.')[1]);
  });

  it('binds ciphertext to its context (another user or column cannot decrypt it)', () => {
    const vault = vaultV1();
    const encrypted = vault.encrypt(SECRET, CONTEXT).ciphertext;

    expect(() =>
      vault.decrypt(encrypted, 'google_connections:user-b:refresh_token'),
    ).toThrow(CredentialDecryptionError);
    expect(() =>
      vault.decrypt(encrypted, 'google_connections:user-a:access_token'),
    ).toThrow(CredentialDecryptionError);
  });

  it.each([
    ['ciphertext', 3],
    ['tag', 2],
    ['iv', 1],
  ])('detects tampering with the %s', (_label, segment) => {
    const vault = vaultV1();
    const parts = vault.encrypt(SECRET, CONTEXT).ciphertext.split('.');
    const bytes = Buffer.from(parts[segment] as string, 'base64url');
    bytes[0] = (bytes[0] as number) ^ 0xff;
    parts[segment] = bytes.toString('base64url');

    expect(() => vault.decrypt(parts.join('.'), CONTEXT)).toThrow(
      CredentialDecryptionError,
    );
  });

  it('rejects malformed values and unknown key versions without leaking details', () => {
    const vault = vaultV1();
    for (const value of ['', SECRET, 'v9.aaaa.bbbb.cccc', 'v1.only-two']) {
      expect(() => vault.decrypt(value, CONTEXT)).toThrow(
        'credential could not be decrypted',
      );
    }
  });

  it('rotates: old versions stay readable and are re-encrypted with the active key', () => {
    const old = vaultV1().encrypt(SECRET, CONTEXT).ciphertext;
    const rotated = new CredentialVault(
      new Map([
        ['v1', key1],
        ['v2', key2],
      ]),
      'v2',
    );

    expect(rotated.isCurrent(old)).toBe(false);
    expect(rotated.decrypt(old, CONTEXT)).toBe(SECRET);

    const renewed = rotated.reencrypt(old, CONTEXT);
    expect(renewed.keyVersion).toBe('v2');
    expect(rotated.isCurrent(renewed.ciphertext)).toBe(true);
    expect(rotated.decrypt(renewed.ciphertext, CONTEXT)).toBe(SECRET);

    // Once v1 is retired, only re-encrypted values remain readable.
    const v2Only = new CredentialVault(new Map([['v2', key2]]), 'v2');
    expect(v2Only.decrypt(renewed.ciphertext, CONTEXT)).toBe(SECRET);
    expect(() => v2Only.decrypt(old, CONTEXT)).toThrow(CredentialDecryptionError);
  });

  it('refuses misconfiguration', () => {
    expect(() => new CredentialVault(new Map([['v1', key1]]), 'v2')).toThrow(
      /active key/,
    );
    expect(() => new CredentialVault(new Map([['v1', randomBytes(16)]]), 'v1')).toThrow(
      /32 bytes/,
    );
  });
});
