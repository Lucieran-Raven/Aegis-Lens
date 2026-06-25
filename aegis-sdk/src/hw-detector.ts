
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

  private initializeAudioContext(): void {
    if (!this.audioContext) {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioContext = new AudioContextClass({
        sampleRate: this.config.sampleRate,
      });
    }

    if (!this.analyser) {
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = this.config.fftSize;
      this.analyser.smoothingTimeConstant = 0;
    }
  }

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

    const spectrum = this.computeFFT(audio);

    const energyDistribution = this.computeEnergyDistribution(spectrum);

    const spectralEntropy = this.computeSpectralEntropy(spectrum);

    const { hfEnergy, lfEnergy } = this.computeFrequencyEnergy(spectrum);

    const noiseFloor = this.estimateNoiseFloor(spectrum);

    const isFiltered = this.detectFiltering(spectralEntropy, energyDistribution, noiseFloor);

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

  private computeFFT(audio: Float32Array): Float32Array {
    this.initializeAudioContext();

    if (!this.analyser || !this.audioContext) {
      throw new Error('AudioContext or AnalyserNode not initialized');
    }

    const audioCopy = new Float32Array(audio.length);
    audioCopy.set(audio);
    
    const buffer = this.audioContext.createBuffer(1, audioCopy.length, this.config.sampleRate);
    buffer.copyToChannel(audioCopy, 0);

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;

    source.connect(this.analyser);

    const frequencyBinCount = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(frequencyBinCount);

    source.start(0);
    this.analyser.getByteFrequencyData(dataArray);
    source.stop();

    const magnitude = new Float32Array(frequencyBinCount);
    for (let i = 0; i < frequencyBinCount; i++) {
      magnitude[i] = dataArray[i] / 255.0;
    }

    return magnitude;
  }

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

  private computeSpectralEntropy(spectrum: Float32Array): number {
    const power = spectrum.map(mag => mag * mag);
    const total = power.reduce((a, b) => a + b, 0);

    if (total === 0) return 0;

    const probabilities = power.map(p => p / total);

    let entropy = 0;
    for (const p of probabilities) {
      if (p > 1e-10) {
        entropy -= p * Math.log2(p);
      }
    }

    const maxEntropy = Math.log2(spectrum.length);
    return entropy / maxEntropy;
  }

  private computeFrequencyEnergy(spectrum: Float32Array): { hfEnergy: number; lfEnergy: number } {
    const splitIndex = Math.floor(spectrum.length * 0.1);

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

  private estimateNoiseFloor(spectrum: Float32Array): number {
    const sorted = [...spectrum].sort((a, b) => a - b);
    const quarter = Math.floor(sorted.length / 4);
    const noiseSegment = sorted.slice(0, quarter);

    if (noiseSegment.length === 0) return 0;

    const mid = Math.floor(noiseSegment.length / 2);
    const noiseFloor = noiseSegment.length % 2 === 0
      ? (noiseSegment[mid - 1] + noiseSegment[mid]) / 2
      : noiseSegment[mid];

    return noiseFloor;
  }

  private detectFiltering(
    entropy: number,
    distribution: number[],
    noiseFloor: number
  ): boolean {
    if (entropy < this.config.entropyThreshold) {
      return true;
    }

    const variance = this.computeVariance(distribution);
    if (variance < 0.01) {
      return true;
    }

    if (noiseFloor > 0.1) {
      return true;
    }

    return false;
  }

  private detectVirtualDevice(
    entropy: number,
    hfEnergy: number,
    noiseFloor: number
  ): boolean {

    if (hfEnergy < this.config.hfEnergyThreshold) {
      return true;
    }

    if (entropy < 0.3) {
      return true;
    }

    if (noiseFloor < 0.001 && entropy > 0.8) {
      return true;
    }

    return false;
  }

  private computeVariance(arr: number[]): number {
    if (arr.length === 0) return 0;

    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((sum, val) => sum + (val - mean) ** 2, 0) / arr.length;

    return variance;
  }

  destroy(): void {
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.analyser = null;
  }
}
