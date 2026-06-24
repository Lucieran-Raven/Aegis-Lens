/**
 * Aegis Lens v2.0 - Hardware Detector
 * Spectral energy distribution analysis to catch software noise filters
 * Detects virtual audio devices and software audio processing
 * CRITICAL FIX: Replaced O(n²) naive FFT with Web Audio API AnalyserNode for performance (P2)
 */

export interface SpectralAnalysisResult {
  spectralEntropy: number;
  energyDistribution: number[];
  highFrequencyEnergy: number;
  lowFrequencyEnergy: number;
  noiseFloor: number;
  isFiltered: boolean;
  isVirtual: boolean;
}

export interface HWDetectorConfig {
  sampleRate: number;
  fftSize: number;
  entropyThreshold: number;
  hfEnergyThreshold: number;
}

export class HWDetector {
  private config: HWDetectorConfig;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;

  constructor(config: Partial<HWDetectorConfig> = {}) {
    this.config = {
      sampleRate: 48000,
      fftSize: 2048,
      entropyThreshold: 0.5,
      hfEnergyThreshold: 0.1,
      ...config,
    };
  }

  /**
   * Initialize Web Audio API components for optimized FFT processing
   * This uses the browser's native C++-optimized FFT implementation instead of JavaScript
   */
  private initializeAudioContext(): void {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: this.config.sampleRate,
      });
    }

    if (!this.analyser) {
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = this.config.fftSize;
      this.analyser.smoothingTimeConstant = 0;
    }
  }

  /**
   * Analyze audio spectral characteristics to detect hardware vs virtual devices
   * CRITICAL FIX: Uses Web Audio API AnalyserNode for O(n log n) FFT instead of O(n²) JavaScript implementation
   */
  analyze(audio: Float32Array): SpectralAnalysisResult {
    if (audio.length === 0) {
      return {
        spectralEntropy: 0,
        energyDistribution: [],
        highFrequencyEnergy: 0,
        lowFrequencyEnergy: 0,
        noiseFloor: 0,
        isFiltered: false,
        isVirtual: false,
      };
    }

    // Compute FFT magnitude spectrum using Web Audio API (native C++ optimized)
    const spectrum = this.computeFFT(audio);

    // Compute energy distribution across frequency bands
    const energyDistribution = this.computeEnergyDistribution(spectrum);

    // Calculate spectral entropy
    const spectralEntropy = this.computeSpectralEntropy(spectrum);

    // Calculate high and low frequency energy ratios
    const { hfEnergy, lfEnergy } = this.computeFrequencyEnergy(spectrum);

    // Estimate noise floor
    const noiseFloor = this.estimateNoiseFloor(spectrum);

    // Determine if audio is filtered
    const isFiltered = this.detectFiltering(spectralEntropy, energyDistribution, noiseFloor);

    // Determine if virtual device
    const isVirtual = this.detectVirtualDevice(spectralEntropy, hfEnergy, noiseFloor);

    return {
      spectralEntropy,
      energyDistribution,
      highFrequencyEnergy: hfEnergy,
      lowFrequencyEnergy: lfEnergy,
      noiseFloor,
      isFiltered,
      isVirtual,
    };
  }

  /**
   * Compute FFT magnitude spectrum using Web Audio API AnalyserNode
   * CRITICAL FIX: This replaces the O(n²) naive FFT implementation with browser-native O(n log n) FFT
   * The Web Audio API uses highly optimized C++ code that runs on a separate thread
   */
  private computeFFT(audio: Float32Array): Float32Array {
    this.initializeAudioContext();

    if (!this.analyser || !this.audioContext) {
      throw new Error('AudioContext or AnalyserNode not initialized');
    }

    // Create a buffer source for the audio data
    // Copy audio data to regular ArrayBuffer to avoid SharedArrayBuffer type conflicts
    const audioCopy = new Float32Array(audio.length);
    audioCopy.set(audio);
    
    const buffer = this.audioContext.createBuffer(1, audioCopy.length, this.config.sampleRate);
    buffer.copyToChannel(audioCopy, 0);

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;

    // Connect source to analyser
    source.connect(this.analyser);

    // Get frequency data (magnitude spectrum)
    const frequencyBinCount = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(frequencyBinCount);

    // Start and immediately stop to process the buffer
    source.start(0);
    this.analyser.getByteFrequencyData(dataArray);
    source.stop();

    // Convert Uint8Array (0-255) to normalized Float32Array (0.0-1.0)
    const magnitude = new Float32Array(frequencyBinCount);
    for (let i = 0; i < frequencyBinCount; i++) {
      magnitude[i] = dataArray[i] / 255.0;
    }

    return magnitude;
  }

  /**
   * Compute energy distribution across frequency bands
   */
  private computeEnergyDistribution(spectrum: Float32Array): number[] {
    const numBands = 8;
    const bandSize = Math.floor(spectrum.length / numBands);
    const distribution = new Array(numBands);

    for (let i = 0; i < numBands; i++) {
      let energy = 0;
      for (let j = 0; j < bandSize; j++) {
        const idx = i * bandSize + j;
        if (idx < spectrum.length) {
          energy += spectrum[idx] * spectrum[idx];
        }
      }
      distribution[i] = energy;
    }

    // Normalize
    const total = distribution.reduce((a, b) => a + b, 0);
    if (total > 0) {
      for (let i = 0; i < numBands; i++) {
        distribution[i] /= total;
      }
    }

    return distribution;
  }

  /**
   * Compute spectral entropy
   */
  private computeSpectralEntropy(spectrum: Float32Array): number {
    // Convert to power spectrum
    const power = spectrum.map(mag => mag * mag);
    const total = power.reduce((a, b) => a + b, 0);

    if (total === 0) return 0;

    // Normalize to probability distribution
    const probabilities = power.map(p => p / total);

    // Compute entropy
    let entropy = 0;
    for (const p of probabilities) {
      if (p > 1e-10) {
        entropy -= p * Math.log2(p);
      }
    }

    // Normalize to [0, 1]
    const maxEntropy = Math.log2(spectrum.length);
    return entropy / maxEntropy;
  }

  /**
   * Compute high and low frequency energy ratios
   */
  private computeFrequencyEnergy(spectrum: Float32Array): { hfEnergy: number; lfEnergy: number } {
    const splitIndex = Math.floor(spectrum.length * 0.1); // 10% of spectrum for low freq

    let lfEnergy = 0;
    let hfEnergy = 0;

    for (let i = 0; i < spectrum.length; i++) {
      const power = spectrum[i] * spectrum[i];
      if (i < splitIndex) {
        lfEnergy += power;
      } else {
        hfEnergy += power;
      }
    }

    const total = lfEnergy + hfEnergy;
    if (total > 0) {
      lfEnergy /= total;
      hfEnergy /= total;
    }

    return { hfEnergy, lfEnergy };
  }

  /**
   * Estimate noise floor from spectrum
   */
  private estimateNoiseFloor(spectrum: Float32Array): number {
    // Use the median of the lower 25% of frequencies as noise floor estimate
    const sorted = [...spectrum].sort((a, b) => a - b);
    const quarter = Math.floor(sorted.length / 4);
    const noiseSegment = sorted.slice(0, quarter);

    if (noiseSegment.length === 0) return 0;

    // Compute median
    const mid = Math.floor(noiseSegment.length / 2);
    const noiseFloor = noiseSegment.length % 2 === 0
      ? (noiseSegment[mid - 1] + noiseSegment[mid]) / 2
      : noiseSegment[mid];

    return noiseFloor;
  }

  /**
   * Detect if audio has been filtered by software
   */
  private detectFiltering(
    entropy: number,
    distribution: number[],
    noiseFloor: number
  ): boolean {
    // Low entropy suggests aggressive filtering
    if (entropy < this.config.entropyThreshold) {
      return true;
    }

    // Check for unnatural energy distribution (flat spectrum = noise suppression)
    const variance = this.computeVariance(distribution);
    if (variance < 0.01) {
      return true;
    }

    // High noise floor relative to signal
    if (noiseFloor > 0.1) {
      return true;
    }

    return false;
  }

  /**
   * Detect if audio is from a virtual device
   */
  private detectVirtualDevice(
    entropy: number,
    hfEnergy: number,
    noiseFloor: number
  ): boolean {
    // Virtual devices often have:
    // - Very low high-frequency energy (band-limited)
    // - Unnatural spectral characteristics
    // - Low entropy

    if (hfEnergy < this.config.hfEnergyThreshold) {
      return true;
    }

    if (entropy < 0.3) {
      return true;
    }

    if (noiseFloor < 0.001 && entropy > 0.8) {
      // Too clean - synthetic audio
      return true;
    }

    return false;
  }

  /**
   * Compute variance of array
   */
  private computeVariance(arr: number[]): number {
    if (arr.length === 0) return 0;

    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((sum, val) => sum + (val - mean) ** 2, 0) / arr.length;

    return variance;
  }

  /**
   * Cleanup AudioContext resources to prevent memory leaks
   */
  destroy(): void {
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.analyser = null;
  }
}
