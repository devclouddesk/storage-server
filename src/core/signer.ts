import crypto from 'node:crypto';
import { keysStore } from './keys-store.js';

export interface SignedUploadPayload {
  keyId: string;
  folder?: string;
  maxBytes?: number;
  exp: number; // Unix timestamp in seconds
  nonce: string;
  webhookUrl?: string;
  access?: 'public' | 'private';
}

export interface SignedTokenVerification {
  valid: boolean;
  error?: string;
  payload?: SignedUploadPayload;
}

export class UploadSigner {
  /**
   * Generates a tamper-proof HMAC-SHA256 signed upload token
   */
  createToken(
    keyId: string,
    secretHash: string,
    options: {
      folder?: string;
      maxBytes?: number;
      expiresInSeconds?: number;
      webhookUrl?: string;
      access?: 'public' | 'private';
    } = {}
  ): string {
    const expiresIn = options.expiresInSeconds || 300; // default 5 minutes
    const exp = Math.floor(Date.now() / 1000) + expiresIn;

    const payload: SignedUploadPayload = {
      keyId,
      folder: options.folder,
      maxBytes: options.maxBytes,
      exp,
      nonce: crypto.randomBytes(6).toString('hex'),
      webhookUrl: options.webhookUrl,
      access: options.access,
    };

    const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', secretHash)
      .update(payloadStr)
      .digest('base64url');

    return `sig_${payloadStr}.${signature}`;
  }

  /**
   * Cryptographically verifies a signed upload token against the active API keys store
   */
  verifyToken(tokenString: string): SignedTokenVerification {
    const prefix = tokenString && tokenString.startsWith('sig_') 
      ? 'sig_' 
      : (tokenString && tokenString.startsWith('dcd_sig_') ? 'dcd_sig_' : null);

    if (!prefix) {
      return { valid: false, error: 'Invalid token prefix' };
    }

    const raw = tokenString.slice(prefix.length);
    const dotIdx = raw.indexOf('.');
    if (dotIdx === -1) {
      return { valid: false, error: 'Malformed token structure' };
    }

    const payloadStr = raw.slice(0, dotIdx);
    const signature = raw.slice(dotIdx + 1);

    let payload: SignedUploadPayload;
    try {
      const decoded = Buffer.from(payloadStr, 'base64url').toString('utf-8');
      payload = JSON.parse(decoded);
    } catch {
      return { valid: false, error: 'Malformed token payload' };
    }

    // Expiry check
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      return { valid: false, error: 'Upload token has expired' };
    }

    // Look up key record from keysStore
    const keyRecord = keysStore.getKeyRecordById(payload.keyId);
    if (!keyRecord) {
      return { valid: false, error: 'Parent API key no longer exists or was revoked' };
    }

    // Role check: parent key must have write or admin permissions
    const perms = keyRecord.permissions || [];
    if (!perms.includes('write') && !perms.includes('admin') && keyRecord.type !== 'secret') {
      return { valid: false, error: 'Parent API key does not have upload permissions' };
    }

    // Compute expected signature
    const expectedSig = crypto
      .createHmac('sha256', keyRecord.keyHash)
      .update(payloadStr)
      .digest('base64url');

    const expectedBuf = Buffer.from(expectedSig);
    const actualBuf = Buffer.from(signature);

    if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
      return { valid: false, error: 'Signature mismatch / token tampered' };
    }

    return { valid: true, payload };
  }

  /**
   * Generates a tamper-proof HMAC-SHA256 signature for private asset downloads
   */
  createDownloadSignature(
    keyId: string,
    secretHash: string,
    resourcePath: string,
    expiresInSeconds = 300
  ): { exp: number; sig: string; keyId: string } {
    const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const cleanPath = resourcePath.replace(/^\/+/, '');
    const sig = crypto
      .createHmac('sha256', secretHash)
      .update(`${cleanPath}:${exp}`)
      .digest('hex');

    return { exp, sig, keyId };
  }

  /**
   * Cryptographically verifies download signature for private assets
   */
  verifyDownloadSignature(
    resourcePath: string,
    query: { exp?: string | number; sig?: string; keyId?: string }
  ): { valid: boolean; error?: string } {
    if (!query.exp || !query.sig || !query.keyId) {
      return { valid: false, error: 'Missing signature parameters (exp, sig, keyId required)' };
    }

    const exp = Number(query.exp);
    if (isNaN(exp) || exp < Math.floor(Date.now() / 1000)) {
      return { valid: false, error: 'Signed download link has expired' };
    }

    const keyRecord = keysStore.getKeyRecordById(query.keyId);
    if (!keyRecord) {
      return { valid: false, error: 'Signing key no longer exists or was revoked' };
    }

    const perms = keyRecord.permissions || [];
    if (!perms.includes('read') && !perms.includes('admin') && keyRecord.type !== 'secret') {
      return { valid: false, error: 'Signing key does not have read permissions' };
    }

    const cleanPath = resourcePath.replace(/^\/+/, '');
    const expectedSig = crypto
      .createHmac('sha256', keyRecord.keyHash)
      .update(`${cleanPath}:${exp}`)
      .digest('hex');

    const expectedBuf = Buffer.from(expectedSig);
    const actualBuf = Buffer.from(query.sig);

    if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
      return { valid: false, error: 'Invalid or tampered signature' };
    }

    return { valid: true };
  }
}

export const uploadSigner = new UploadSigner();
