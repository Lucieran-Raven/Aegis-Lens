/**
 * Aegis Lens v2.0 - Cryptography Module Tests
 * Tests for WebCrypto API ECDSA P-256 operations
 */

import { AegisCrypto } from '../crypto';

describe('AegisCrypto', () => {
  beforeEach(() => {
    // Setup
  });

  describe('generateKeyPair', () => {
    it('should generate a valid ECDSA P-256 key pair', async () => {
      const keyPair = await AegisCrypto.generateKeyPair();

      expect(keyPair).toBeDefined();
      expect(keyPair.privateKey).toBeDefined();
      expect(keyPair.publicKey).toBeDefined();
      expect(keyPair.publicKeyPem).toBeDefined();
      expect(keyPair.publicKeyPem).toContain('-----BEGIN PUBLIC KEY-----');
      expect(keyPair.publicKeyPem).toContain('-----END PUBLIC KEY-----');
    });

    it('should generate different key pairs each time', async () => {
      const keyPair1 = await AegisCrypto.generateKeyPair();
      const keyPair2 = await AegisCrypto.generateKeyPair();

      expect(keyPair1.publicKeyPem).not.toBe(keyPair2.publicKeyPem);
    });
  });

  describe('signPayload', () => {
    it('should sign a payload and produce a valid signature', async () => {
      const keyPair = await AegisCrypto.generateKeyPair();
      const payload = new Uint8Array([1, 2, 3, 4, 5]);

      const signature = await AegisCrypto.signPayload(keyPair.privateKey, payload);

      expect(signature).toBeDefined();
      expect(signature.length).toBeGreaterThan(0);
      // ECDSA P-256 signatures are typically 64 bytes (r + s, 32 bytes each)
      expect(signature.length).toBeGreaterThanOrEqual(64);
    });

    it('should produce different signatures for different payloads', async () => {
      const keyPair = await AegisCrypto.generateKeyPair();
      const payload1 = new Uint8Array([1, 2, 3]);
      const payload2 = new Uint8Array([4, 5, 6]);

      const sig1 = await AegisCrypto.signPayload(keyPair.privateKey, payload1);
      const sig2 = await AegisCrypto.signPayload(keyPair.privateKey, payload2);

      expect(sig1).not.toEqual(sig2);
    });
  });

  describe('verifySignature', () => {
    it('should verify a valid signature', async () => {
      const keyPair = await AegisCrypto.generateKeyPair();
      const payload = new Uint8Array([1, 2, 3, 4, 5]);

      const signature = await AegisCrypto.signPayload(keyPair.privateKey, payload);
      const isValid = await AegisCrypto.verifySignature(keyPair.publicKey, signature, payload);

      expect(isValid).toBe(true);
    });

    it('should reject an invalid signature', async () => {
      const keyPair = await AegisCrypto.generateKeyPair();
      const payload = new Uint8Array([1, 2, 3, 4, 5]);
      const wrongPayload = new Uint8Array([9, 8, 7, 6, 5]);

      const signature = await AegisCrypto.signPayload(keyPair.privateKey, payload);
      const isValid = await AegisCrypto.verifySignature(keyPair.publicKey, signature, wrongPayload);

      expect(isValid).toBe(false);
    });

    it('should reject signature from wrong key', async () => {
      const keyPair1 = await AegisCrypto.generateKeyPair();
      const keyPair2 = await AegisCrypto.generateKeyPair();
      const payload = new Uint8Array([1, 2, 3, 4, 5]);

      const signature = await AegisCrypto.signPayload(keyPair1.privateKey, payload);
      const isValid = await AegisCrypto.verifySignature(keyPair2.publicKey, signature, payload);

      expect(isValid).toBe(false);
    });
  });

  describe('sha256', () => {
    it('should produce consistent hash for same input', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const hash1 = await AegisCrypto.sha256(data);
      const hash2 = await AegisCrypto.sha256(data);

      expect(hash1).toEqual(hash2);
    });

    it('should produce different hashes for different inputs', async () => {
      const data1 = new Uint8Array([1, 2, 3]);
      const data2 = new Uint8Array([4, 5, 6]);

      const hash1 = await AegisCrypto.sha256(data1);
      const hash2 = await AegisCrypto.sha256(data2);

      expect(hash1).not.toEqual(hash2);
    });

    it('should produce 32-byte hash', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const hash = await AegisCrypto.sha256(data);

      expect(hash.length).toBe(32);
    });
  });

  describe('generateNonce', () => {
    it('should generate nonce of specified length', () => {
      const nonce = AegisCrypto.generateNonce(16);

      expect(nonce.length).toBe(16);
    });

    it('should generate different nonces each time', () => {
      const nonce1 = AegisCrypto.generateNonce(32);
      const nonce2 = AegisCrypto.generateNonce(32);

      expect(nonce1).not.toEqual(nonce2);
    });

    it('should use default length of 32 bytes', () => {
      const nonce = AegisCrypto.generateNonce();

      expect(nonce.length).toBe(32);
    });
  });

  describe('importPublicKey', () => {
    it('should import a previously exported public key', async () => {
      const keyPair = await AegisCrypto.generateKeyPair();
      const importedKey = await AegisCrypto.importPublicKey(keyPair.publicKeyPem);

      expect(importedKey).toBeDefined();
      expect(importedKey.type).toBe('public');
    });

    it('should verify signature with imported key', async () => {
      const keyPair = await AegisCrypto.generateKeyPair();
      const payload = new Uint8Array([1, 2, 3, 4, 5]);

      const signature = await AegisCrypto.signPayload(keyPair.privateKey, payload);
      const importedKey = await AegisCrypto.importPublicKey(keyPair.publicKeyPem);
      const isValid = await AegisCrypto.verifySignature(importedKey, signature, payload);

      expect(isValid).toBe(true);
    });
  });
});
