
export interface DriftResult {
  audioVideoDriftMs: number;
  crossModalCorrelation: number;
  driftExceedsThreshold: boolean;
  sampleCount: number;
}

export interface DriftDetectorConfig {
  maxDriftMs: number;
  sampleRate: number;
  windowSize: number;
}

export class DriftDetector {
  private config: DriftDetectorConfig;
  private audioTimestamps: number[] = [];
  private videoTimestamps: number[] = [];
  private audioAmplitudes: number[] = [];
  private lipApertures: number[] = [];
  private readonly MAX_FRAMES = 300;

  constructor(config: Partial<DriftDetectorConfig> = {}) {
    this.config = {
      maxDriftMs: 150,
      sampleRate: 30,
      windowSize: 60,
      ...config,
    };
  }

  addAudioData(timestamp: number, amplitude: number): void {
    this.audioTimestamps.push(timestamp);
    this.audioAmplitudes.push(amplitude);

    if (this.audioTimestamps.length > this.MAX_FRAMES) {
      this.audioTimestamps.shift();
      this.audioAmplitudes.shift();
    }
  }

  addVideoData(timestamp: number, lipAperture: number): void {
    this.videoTimestamps.push(timestamp);
    this.lipApertures.push(lipAperture);

    if (this.videoTimestamps.length > this.MAX_FRAMES) {
      this.videoTimestamps.shift();
      this.lipApertures.shift();
    }
  }

  analyze(): DriftResult {
    if (this.audioTimestamps.length < 2 || this.videoTimestamps.length < 2) {
      return {
        audioVideoDriftMs: 0,
        crossModalCorrelation: 0,
        driftExceedsThreshold: false,
        sampleCount: Math.min(this.audioTimestamps.length, this.videoTimestamps.length),
      };
    }

    // Calculate audio-video drift
    const audioVideoDriftMs = this.calculateAudioVideoDrift();

    // Calculate cross-modal correlation
    const crossModalCorrelation = this.calculateCrossModalCorrelation();

    // Check if drift exceeds threshold
    const driftExceedsThreshold = Math.abs(audioVideoDriftMs) > this.config.maxDriftMs;

    return {
      audioVideoDriftMs,
      crossModalCorrelation,
      driftExceedsThreshold,
      sampleCount: Math.min(this.audioTimestamps.length, this.videoTimestamps.length),
    };
  }

  private calculateAudioVideoDrift(): number {
    const minLen = Math.min(this.audioTimestamps.length, this.videoTimestamps.length);
    
    const audioDiffs: number[] = [];
    const videoDiffs: number[] = [];

    for (let i = 1; i < minLen; i++) {
      audioDiffs.push(this.audioTimestamps[i] - this.audioTimestamps[i - 1]);
      videoDiffs.push(this.videoTimestamps[i] - this.videoTimestamps[i - 1]);
    }

    const maxLag = Math.min(audioDiffs.length, videoDiffs.length, this.config.windowSize);
    let bestCorrelation = 0;
    let bestLag = 0;

    for (let lag = 0; lag < maxLag; lag++) {
      let correlation = 0;
      const n = Math.min(audioDiffs.length - lag, videoDiffs.length);

      for (let i = 0; i < n; i++) {
        correlation += audioDiffs[i + lag] * videoDiffs[i];
      }

      correlation /= n;

      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestLag = lag;
      }
    }

    const driftMs = bestLag * (1000 / this.config.sampleRate);

    return driftMs;
  }

  private calculateCrossModalCorrelation(): number {
    const minLen = Math.min(this.audioAmplitudes.length, this.lipApertures.length);
    
    if (minLen < 2) return 0;

    const audioSubset = this.audioAmplitudes.slice(-minLen);
    const lipSubset = this.lipApertures.slice(-minLen);

    return this.pearsonCorrelation(audioSubset, lipSubset);
  }

  private pearsonCorrelation(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length === 0) return 0;

    const n = x.length;
    const meanX = x.reduce((a, b) => a + b, 0) / n;
    const meanY = y.reduce((a, b) => a + b, 0) / n;

    let numerator = 0;
    let sumX2 = 0;
    let sumY2 = 0;

    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      numerator += dx * dy;
      sumX2 += dx * dx;
      sumY2 += dy * dy;
    }

    const denominator = Math.sqrt(sumX2 * sumY2);
    if (denominator === 0) return 0;

    return numerator / denominator;
  }

  getMovingDriftAverage(windowSize: number = 10): number {
    if (this.audioTimestamps.length < 2 || this.videoTimestamps.length < 2) return 0;

    const drifts: number[] = [];
    const minLen = Math.min(this.audioTimestamps.length, this.videoTimestamps.length);

    for (let i = 1; i < minLen; i++) {
      const audioDiff = this.audioTimestamps[i] - this.audioTimestamps[i - 1];
      const videoDiff = this.videoTimestamps[i] - this.videoTimestamps[i - 1];
      drifts.push(audioDiff - videoDiff);
    }

    const recentDrifts = drifts.slice(-windowSize);
    if (recentDrifts.length === 0) return 0;

    const avg = recentDrifts.reduce((a, b) => a + b, 0) / recentDrifts.length;

    return avg;
  }

  reset(): void {
    this.audioTimestamps = [];
    this.videoTimestamps = [];
    this.audioAmplitudes = [];
    this.lipApertures = [];
  }

  getSampleCount(): number {
    return Math.min(this.audioTimestamps.length, this.videoTimestamps.length);
  }
}
