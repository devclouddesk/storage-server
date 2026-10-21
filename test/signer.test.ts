import { describe, expect, it } from 'vitest';
import { UploadSigner } from '../src/core/signer.js';

describe('UploadSigner', () => {
  const signer = new UploadSigner();

  it('creates a signed token with sig_ prefix and HMAC signature', () => {
    const token = signer.createToken('key_123', 'secret_hash_abc', {
      folder: 'avatars',
      maxBytes: 1048576,
      expiresInSeconds: 600,
    });

    expect(token.startsWith('sig_')).toBe(true);
    const parts = token.slice(4).split('.');
    expect(parts.length).toBe(2);

    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf-8'));
    expect(payload.keyId).toBe('key_123');
    expect(payload.folder).toBe('avatars');
    expect(payload.maxBytes).toBe(1048576);
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('rejects tokens with invalid prefix', () => {
    const res = signer.verifyToken('invalid_token_format');
    expect(res.valid).toBe(false);
    expect(res.error).toBe('Invalid token prefix');
  });

  it('rejects malformed tokens without dot signature separator', () => {
    const res = signer.verifyToken('sig_nodothere');
    expect(res.valid).toBe(false);
    expect(res.error).toBe('Malformed token structure');
  });

  it('rejects expired tokens', () => {
    // Generate token expired 10 seconds ago
    const pastExp = Math.floor(Date.now() / 1000) - 10;
    const payload = { keyId: 'key_1', exp: pastExp, nonce: '123' };
    const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const token = `sig_${payloadStr}.fakesig`;

    const res = signer.verifyToken(token);
    expect(res.valid).toBe(false);
    expect(res.error).toBe('Upload token has expired');
  });
});
