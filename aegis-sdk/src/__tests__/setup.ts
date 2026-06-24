/**
 * Jest setup file for mocking browser APIs in CI environment
 */

// Mock AudioContext for tests that don't require real audio processing
global.AudioContext = class MockAudioContext {
  constructor(options?: { sampleRate?: number }) {
    this.sampleRate = options?.sampleRate || 48000;
    this.state = 'running';
  }

  sampleRate: number;
  state: string;

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer {
    return {
      numberOfChannels,
      length,
      sampleRate,
      getChannelData: (channel: number) => new Float32Array(length),
      duration: length / sampleRate,
    } as AudioBuffer;
  }

  createBufferSource(): AudioBufferSourceNode {
    return {
      buffer: null,
      connect: () => {},
      start: () => {},
      stop: () => {},
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
(global as any).webkitAudioContext = global.AudioContext;

// Mock performance.now()
global.performance = {
  now: () => Date.now(),
} as Performance;

// Mock requestVideoFrameCallback
HTMLVideoElement.prototype.requestVideoFrameCallback = function(callback: any) {
  setTimeout(() => {
    callback(performance.now(), {
      presentationTime: performance.now() / 1000,
      mediaTime: performance.now() / 1000,
      width: this.videoWidth,
      height: this.videoHeight,
    });
  }, 16);
};
