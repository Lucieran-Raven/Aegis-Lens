
export interface KeyPair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicKeyPem: string;
}

export class AegisCrypto {
  static async generateKeyPair(): Promise<KeyPair> {
    const keyPair = await window.crypto.subtle.generateKey(
      {
        name: 'ECDSA',
        namedCurve: 'P-256',
      },
      false,
      ['sign']
    );

    const publicKeySpki = await window.crypto.subtle.exportKey(
      'spki',
      keyPair.publicKey
    );
    const publicKeyPem = this.spkiToPem(publicKeySpki);

    return {
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey,
      publicKeyPem,
    };
  }

  static async signPayload(
    privateKey: CryptoKey,
    payload: Uint8Array
  ): Promise<Uint8Array> {
    const bufferCopy = new ArrayBuffer(payload.byteLength);
    new Uint8Array(bufferCopy).set(payload);
    
    const signature = await window.crypto.subtle.sign(
      {
        name: 'ECDSA',
        hash: { name: 'SHA-256' },
      },
      privateKey,
      bufferCopy
    );

    return new Uint8Array(signature);
  }

  static async verifySignature(
    publicKey: CryptoKey,
    signature: Uint8Array,
    payload: Uint8Array
  ): Promise<boolean> {
    const sigCopy = new ArrayBuffer(signature.byteLength);
    new Uint8Array(sigCopy).set(signature);
    const payloadCopy = new ArrayBuffer(payload.byteLength);
    new Uint8Array(payloadCopy).set(payload);
    
    return await window.crypto.subtle.verify(
      {
        name: 'ECDSA',
        hash: { name: 'SHA-256' },
      },
      publicKey,
      sigCopy,
      payloadCopy
    );
  }

  private static spkiToPem(spki: ArrayBuffer): string {
    const spkiBuffer = new Uint8Array(spki);
    let spkiString = '';
    for (let i = 0; i < spkiBuffer.length; i++) {
      spkiString += String.fromCharCode(spkiBuffer[i]);
    }
    const base64 = btoa(spkiString);
    
    return `-----BEGIN PUBLIC KEY-----\n${this.wrapBase64(base64)}\n-----END PUBLIC KEY-----`;
  }

  private static wrapBase64(base64: string): string {
    const lines: string[] = [];
    for (let i = 0; i < base64.length; i += 64) {
      lines.push(base64.substring(i, i + 64));
    }
    return lines.join('\n');
  }

  static async importPublicKey(pem: string): Promise<CryptoKey> {
    const pemContents = pem
      .replace('-----BEGIN PUBLIC KEY-----', '')
      .replace('-----END PUBLIC KEY-----', '')
      .replace(/\s/g, '');
    
    const binaryString = atob(pemContents);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    return await window.crypto.subtle.importKey(
      'spki',
      bytes,
      {
        name: 'ECDSA',
        namedCurve: 'P-256',
      },
      true,
      ['verify']
    );
  }

  static async sha256(data: Uint8Array): Promise<Uint8Array> {
    const dataCopy = new ArrayBuffer(data.byteLength);
    new Uint8Array(dataCopy).set(data);
    
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', dataCopy);
    return new Uint8Array(hashBuffer);
  }

  static generateNonce(length: number = 32): Uint8Array {
    const nonce = new Uint8Array(length);
    window.crypto.getRandomValues(nonce);
    return nonce;
  }
}
