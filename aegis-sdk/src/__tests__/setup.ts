/**
 * Jest setup file for mocking browser APIs in CI environment
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

// Mock WebCrypto API for tests
const webCryptoMock = {
  subtle: {
    generateKey: async (_algorithm: unknown, _extractable: boolean, _keyUsages: string[]) => {
      return {
        publicKey: { type: 'public', extractable: true },
        privateKey: { type: 'private', extractable: false },
      } as CryptoKeyPair;
    },
    exportKey: async (_format: string, _key: unknown) => {
      return new ArrayBuffer(32);
    },
    importKey: async (_format: string, _keyData: unknown, _algorithm: unknown, extractable: boolean, _keyUsages: string[]) => {
      return { type: 'public', extractable } as CryptoKey;
    },
    sign: async (_algorithm: unknown, _privateKey: unknown, _data: ArrayBuffer) => {
      return new ArrayBuffer(64);
    },
    verify: async (_algorithm: unknown, _publicKey: unknown, _signature: ArrayBuffer, _data: ArrayBuffer) => {
      return true;
    },
    digest: async (_algorithm: unknown, _data: ArrayBuffer) => {
      return new ArrayBuffer(32);
    },
  },
  getRandomValues: (array: unknown) => {
    const typedArray = array as Uint8Array;
    for (let i = 0; i < typedArray.length; i++) {
      typedArray[i] = Math.floor(Math.random() * 256);
    }
    return typedArray;
  },
} as Crypto;

// Assign to both global and window for compatibility
global.crypto = webCryptoMock;
// Use Object.defineProperty to properly override jsdom's window.crypto
Object.defineProperty(global, 'window', {
  value: { crypto: webCryptoMock },
  writable: true,
});

// Mock AudioContext for tests that don't require real audio processing
global.AudioContext = class MockAudioContext {
  constructor(options?: { sampleRate?: number }) {
    this.sampleRate = options?.sampleRate || 48000;
    this.state = 'running';
  }

  sampleRate: number;
  state: string;

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer {
    const channels: Float32Array[] = [];
    for (let i = 0; i < numberOfChannels; i++) {
      channels.push(new Float32Array(length));
    }
    return {
      numberOfChannels,
      length,
      sampleRate,
      getChannelData: (channel: number) => channels[channel],
      copyToChannel: (source: Float32Array, channel: number) => {
        if (channels[channel]) {
          channels[channel].set(source);
        }
      },
      copyFromChannel: (destination: Float32Array, channel: number) => {
        if (channels[channel]) {
          destination.set(channels[channel]);
        }
      },
      duration: length / sampleRate,
    } as AudioBuffer;
  }

  createBufferSource(): AudioBufferSourceNode {
    let onended: (() => void) | null = null;
    return {
      buffer: null,
      connect: () => this,
      start: () => {
        // Simulate audio ending immediately in mock
        setTimeout(() => onended?.(), 0);
      },
      stop: () => {},
      set onended(fn: () => void) {
        onended = fn;
      },
    } as unknown as AudioBufferSourceNode;
  }

  createGain(): GainNode {
    return {
      gain: { value: 1 },
      connect: () => {},
    } as unknown as GainNode;
  }

  createAnalyser(): AnalyserNode {
    return {
      fftSize: 2048,
      frequencyBinCount: 1024,
      getByteFrequencyData: () => {},
      getFloatFrequencyData: () => {},
      connect: () => {},
    } as unknown as AnalyserNode;
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  resume(): Promise<void> {
    return Promise.resolve();
  }
} as unknown as typeof AudioContext;

// Mock webkitAudioContext for Safari compatibility
(global as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext = global.AudioContext;

// Mock performance.now()
global.performance = {
  now: () => Date.now(),
} as Performance;

// Mock requestVideoFrameCallback
// @ts-expect-error - requestVideoFrameCallback is browser-specific
HTMLVideoElement.prototype.requestVideoFrameCallback = function(callback: (now: number, metadata: Record<string, unknown>) => void) {
  setTimeout(() => {
    callback(performance.now(), {
      presentationTime: performance.now() / 1000,
      mediaTime: performance.now() / 1000,
      width: this.videoWidth,
      height: this.videoHeight,
    } as Record<string, unknown>);
  }, 16);
};
