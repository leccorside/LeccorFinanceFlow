import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM standard nonce size
const TAG_BYTES = 16;
const FORMAT = /^(v\d+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]*)$/;

export interface EncryptedValue {
  /** `<version>.<iv>.<tag>.<ciphertext>`, base64url segments. Self-describing. */
  ciphertext: string;
  keyVersion: string;
}

export class CredentialDecryptionError extends Error {
  constructor() {
    // Deliberately generic: never hint at key material or plaintext.
    super('credential could not be decrypted');
    this.name = 'CredentialDecryptionError';
  }
}

/**
 * AES-256-GCM vault for secrets at rest (Google tokens now, AI keys later).
 *
 * - Versioned keys: every ciphertext names its key version, so old data stays readable
 *   after the active version changes; `isCurrent` tells callers to re-encrypt (rotation).
 * - Context binding: `context` (e.g. "google_connections:<userId>:refresh_token") is used as
 *   GCM additional authenticated data. A ciphertext copied to another user or column fails
 *   authentication instead of decrypting.
 * - Random 96-bit IV per encryption; the 128-bit tag detects any tampering.
 */
export class CredentialVault {
  constructor(
    private readonly keys: ReadonlyMap<string, Buffer>,
    readonly activeVersion: string,
  ) {
    const active = keys.get(activeVersion);
    if (!active) {
      throw new Error(`active key version ${activeVersion} is not configured`);
    }
    for (const [version, key] of keys) {
      if (key.length !== KEY_BYTES) {
        throw new Error(`key ${version} must have ${KEY_BYTES} bytes`);
      }
    }
  }

  encrypt(plaintext: string, context: string): EncryptedValue {
    const key = this.keys.get(this.activeVersion) as Buffer;
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      keyVersion: this.activeVersion,
      ciphertext: [
        this.activeVersion,
        iv.toString('base64url'),
        tag.toString('base64url'),
        data.toString('base64url'),
      ].join('.'),
    };
  }

  decrypt(ciphertext: string, context: string): string {
    const match = FORMAT.exec(ciphertext);
    const key = match ? this.keys.get(match[1] as string) : undefined;
    if (!match || !key) {
      throw new CredentialDecryptionError();
    }

    try {
      const iv = Buffer.from(match[2] as string, 'base64url');
      const tag = Buffer.from(match[3] as string, 'base64url');
      if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
        throw new CredentialDecryptionError();
      }
      const decipher = createDecipheriv('aes-256-gcm', key, iv, {
        authTagLength: TAG_BYTES,
      });
      decipher.setAAD(Buffer.from(context, 'utf8'));
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(Buffer.from(match[4] as string, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new CredentialDecryptionError();
    }
  }

  /** False when the value was encrypted with an older key version (re-encrypt it). */
  isCurrent(ciphertext: string): boolean {
    return ciphertext.startsWith(`${this.activeVersion}.`);
  }

  /** Decrypts with whatever version it has and encrypts again with the active key. */
  reencrypt(ciphertext: string, context: string): EncryptedValue {
    return this.encrypt(this.decrypt(ciphertext, context), context);
  }
}

/** Null when encryption is not configured (features that need it answer 503). */
export const CREDENTIAL_VAULT = Symbol('CREDENTIAL_VAULT');
