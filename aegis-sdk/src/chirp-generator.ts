/**
 * Aegis Lens v2.0 - Chirp Generator
 * Generates 80ms linear frequency sweep (200Hz to 8kHz) with phase-randomized nonce
 * Used for acoustic Time-of-Flight measurement
 */

export interface ChirpConfig {
  startFreq: number;      // Starting frequency (Hz)
  endFreq: number;        // Ending frequency (Hz)
  duration: number;       // Duration in seconds
  sampleRate: number;     // Audio sample rate (Hz)
  nonce: number;          // 4-byte nonce for phase randomization
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

  /**
   * Generate an 80ms linear frequency sweep (chirp)
   * φ(t) = 2π[f_start·t + (f_end - f_start)·t²/(2T)] + (2π·nonceval)
   */
  generateChirp(config: ChirpConfig): ChirpResult {
    const {
      startFreq = 200,
      endFreq = 8000,
      duration = 0.08,  // 80ms
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

    // Calculate phase offset from nonce
    const phaseOffset = 2 * Math.PI * (nonce % 256);

    // Generate linear chirp
    const tStep = 1 / sampleRate;
    const freqRange = endFreq - startFreq;

    for (let i = 0; i < numSamples; i++) {
      const t = i * tStep;
      
      // Phase: φ(t) = 2π * ∫ f(t) dt + phase_offset
      // For linear chirp: φ(t) = 2π[f_start·t + (f_end - f_start)·t²/(2T)] + phase_offset
      const phase = 2 * Math.PI * (startFreq * t + (freqRange * t * t) / (2 * duration)) + phaseOffset;
      
      // Generate sample
      channelData[i] = Math.sin(phase);
    }

    // Apply envelope to prevent clicks at start/end
    this.applyEnvelope(channelData, sampleRate);

    return {
      audioBuffer,
      phaseOffset,
      nonce,
    };
  }

  /**
   * Apply Hanning envelope to smooth the chirp
   */
  private applyEnvelope(data: Float32Array, sampleRate: number): void {
    const envelopeLength = Math.floor(sampleRate * 0.005); // 5ms envelope
    const totalSamples = data.length;

    // Attack (fade in)
    for (let i = 0; i < envelopeLength && i < totalSamples; i++) {
      const t = i / envelopeLength;
      data[i] *= 0.5 * (1 - Math.cos(Math.PI * t)); // Hanning window
    }

    // Release (fade out)
    for (let i = 0; i < envelopeLength && i < totalSamples; i++) {
      const t = i / envelopeLength;
      const idx = totalSamples - 1 - i;
      data[idx] *= 0.5 * (1 + Math.cos(Math.PI * t)); // Hanning window
    }
  }

  /**
   * Play the chirp through the audio output
   */
  async playChirp(chirp: ChirpResult): Promise<void> {
    const source = this.audioContext.createBufferSource();
    source.buffer = chirp.audioBuffer;
    
    const gainNode = this.audioContext.createGain();
    gainNode.gain.value = 0.5; // Reduce volume to avoid clipping

    source.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    source.start();
    
    return new Promise((resolve) => {
      source.onended = () => resolve();
    });
  }

  /**
   * Generate chirp with automatic nonce from session
   */
  generateSessionChirp(nonce: number): ChirpResult {
    return this.generateChirp({
      startFreq: 200,
      endFreq: 8000,
      duration: 0.08,
      sampleRate: 48000,
      nonce,
    });
  }

  /**
   * Get the AudioContext
   */
  getAudioContext(): AudioContext {
    return this.audioContext;
  }

  /**
   * Resume the AudioContext (required after user interaction)
   */
  async resume(): Promise<void> {
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  /**
   * Close the AudioContext
   */
  close(): void {
    this.audioContext.close();
  }
}
