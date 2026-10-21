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

  it('creates download signature for private assets with exp, sig, and keyId', () => {
    const res = signer.createDownloadSignature('key_test_1', 'hash_secret_999', 'invoices/inv-001.pdf', 900);
    expect(res.keyId).toBe('key_test_1');
    expect(typeof res.sig).toBe('string');
    expect(res.sig.length).toBe(64); // SHA-256 hex length
    expect(res.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('rejects expired download signatures', () => {
    const pastExp = Math.floor(Date.now() / 1000) - 50;
    const res = signer.verifyDownloadSignature('invoices/inv-001.pdf', {
      exp: pastExp,
      sig: 'some_sig',
      keyId: 'key_test_1',
    });
    expect(res.valid).toBe(false);
    expect(res.error).toBe('Signed download link has expired');
  });
});
