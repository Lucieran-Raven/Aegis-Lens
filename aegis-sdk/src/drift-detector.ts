/**
 * Aegis Lens v2.0 - Drift Detector
 * Computes cross-modal correlation for voice drift metrics
 * Detects audio-video desynchronization with 150ms ceiling
 */

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
  private readonly MAX_FRAMES = 300; // CRITICAL FIX: Cap at 300 frames (~10 seconds at 30Hz) to prevent memory leaks (P3)

  constructor(config: Partial<DriftDetectorConfig> = {}) {
    this.config = {
      maxDriftMs: 150, // 150ms ceiling
      sampleRate: 30, // 30 Hz
      windowSize: 60, // 2 second window
      ...config,
    };
  }

  /**
   * Add audio timestamp and amplitude
   */
  addAudioData(timestamp: number, amplitude: number): void {
    this.audioTimestamps.push(timestamp);
    this.audioAmplitudes.push(amplitude);

    // CRITICAL FIX: Enforce circular buffer limit to prevent unbounded growth (P3)
    if (this.audioTimestamps.length > this.MAX_FRAMES) {
      this.audioTimestamps.shift();
      this.audioAmplitudes.shift();
    }
  }

  /**
   * Add video timestamp and lip aperture
   */
  addVideoData(timestamp: number, lipAperture: number): void {
    this.videoTimestamps.push(timestamp);
    this.lipApertures.push(lipAperture);

    // CRITICAL FIX: Enforce circular buffer limit to prevent unbounded growth (P3)
    if (this.videoTimestamps.length > this.MAX_FRAMES) {
      this.videoTimestamps.shift();
      this.lipApertures.shift();
    }
  }

  /**
   * Analyze drift between audio and video streams
   */
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

  /**
   * Calculate drift between audio and video timestamps
   */
  private calculateAudioVideoDrift(): number {
    // Align the two streams by finding the best correlation
    const minLen = Math.min(this.audioTimestamps.length, this.videoTimestamps.length);
    
    // Calculate timestamp differences
    const audioDiffs: number[] = [];
    const videoDiffs: number[] = [];

    for (let i = 1; i < minLen; i++) {
      audioDiffs.push(this.audioTimestamps[i] - this.audioTimestamps[i - 1]);
      videoDiffs.push(this.videoTimestamps[i] - this.videoTimestamps[i - 1]);
    }

    // Find the lag that maximizes correlation between the two streams
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

    // Convert lag to milliseconds
    const driftMs = bestLag * (1000 / this.config.sampleRate);

    return driftMs;
  }

  /**
   * Calculate cross-modal correlation between audio amplitude and lip aperture
   */
  private calculateCrossModalCorrelation(): number {
    const minLen = Math.min(this.audioAmplitudes.length, this.lipApertures.length);
    
    if (minLen < 2) return 0;

    const audioSubset = this.audioAmplitudes.slice(-minLen);
    const lipSubset = this.lipApertures.slice(-minLen);

    return this.pearsonCorrelation(audioSubset, lipSubset);
  }

  /**
   * Pearson correlation coefficient
   */
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

  /**
   * Calculate moving average of drift
   */
  getMovingDriftAverage(windowSize: number = 10): number {
    if (this.audioTimestamps.length < 2 || this.videoTimestamps.length < 2) return 0;

    const drifts: number[] = [];
    const minLen = Math.min(this.audioTimestamps.length, this.videoTimestamps.length);

    for (let i = 1; i < minLen; i++) {
      const audioDiff = this.audioTimestamps[i] - this.audioTimestamps[i - 1];
      const videoDiff = this.videoTimestamps[i] - this.videoTimestamps[i - 1];
      drifts.push(audioDiff - videoDiff);
    }

    // Calculate moving average
    const recentDrifts = drifts.slice(-windowSize);
    if (recentDrifts.length === 0) return 0;

    const avg = recentDrifts.reduce((a, b) => a + b, 0) / recentDrifts.length;

    return avg;
  }

  /**
   * Reset the detector state
   */
  reset(): void {
    this.audioTimestamps = [];
    this.videoTimestamps = [];
    this.audioAmplitudes = [];
    this.lipApertures = [];
  }

  /**
   * Get the number of samples collected
   */
  getSampleCount(): number {
    return Math.min(this.audioTimestamps.length, this.videoTimestamps.length);
  }
}
