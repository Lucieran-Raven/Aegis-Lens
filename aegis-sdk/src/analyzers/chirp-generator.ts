
export interface ChirpConfig {
  startFreq: number;
  endFreq: number;
  duration: number;
  sampleRate: number;
  nonce: number;
}

export interface ChirpResult {
  audioBuffer: AudioBuffer;
  phaseOffset: number;
  nonce: number;
}

export class ChirpGenerator {
  private audioContext: AudioContext;

  constructor(audioContext?: AudioContext) {
    this.audioContext = audioContext || new AudioContext({
      sampleRate: 48000,
    });
  }

  generateChirp(config: ChirpConfig): ChirpResult {
    const {
      startFreq = 200,
      endFreq = 8000,
      duration = 0.08,
      sampleRate = 48000,
      nonce = 0,
    } = config;

    const numSamples = Math.floor(sampleRate * duration);
    const audioBuffer = this.audioContext.createBuffer(
      1,
      numSamples,
      sampleRate
    );

    const channelData = audioBuffer.getChannelData(0);

    const phaseOffset = 2 * Math.PI * (nonce % 256);

    const tStep = 1 / sampleRate;
    const freqRange = endFreq - startFreq;

    for (let i = 0; i < numSamples; i++) {
      const t = i * tStep;
      
      const phase = 2 * Math.PI * (startFreq * t + (freqRange * t * t) / (2 * duration)) + phaseOffset;
      
      channelData[i] = Math.sin(phase);
    }

    this.applyEnvelope(channelData, sampleRate);

    return {
      audioBuffer,
      phaseOffset,
      nonce,
    };
  }

  private applyEnvelope(data: Float32Array, sampleRate: number): void {
    const envelopeLength = Math.floor(sampleRate * 0.005);
    const totalSamples = data.length;

    for (let i = 0; i < envelopeLength && i < totalSamples; i++) {
      const t = i / envelopeLength;
      data[i] *= 0.5 * (1 - Math.cos(Math.PI * t));
    }

    for (let i = 0; i < envelopeLength && i < totalSamples; i++) {
      const t = i / envelopeLength;
      const idx = totalSamples - 1 - i;
      data[idx] *= 0.5 * (1 + Math.cos(Math.PI * t));
    }
  }

  async playChirp(chirp: ChirpResult): Promise<void> {
    const source = this.audioContext.createBufferSource();
    source.buffer = chirp.audioBuffer;
    
    const gainNode = this.audioContext.createGain();
    gainNode.gain.value = 0.5;

    source.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    source.start();
    
    return new Promise((resolve) => {
      source.onended = () => resolve();
    });
  }

  generateSessionChirp(nonce: number): ChirpResult {
    return this.generateChirp({
      startFreq: 200,
      endFreq: 8000,
      duration: 0.08,
      sampleRate: 48000,
      nonce,
    });
  }

  getAudioContext(): AudioContext {
    return this.audioContext;
  }

  async resume(): Promise<void> {
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  close(): void {
    this.audioContext.close();
  }
}
