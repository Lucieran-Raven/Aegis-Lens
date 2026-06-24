/**
 * Aegis Lens v2.0 - Lip Tracker
 * Uses MediaPipe facial mesh models for vocal mechanics coordinates
 * Detects lip-sync anomalies and proxy attacks
 */

export interface LipCoordinates {
  upperLip: { x: number; y: number };
  lowerLip: { x: number; y: number };
  leftCorner: { x: number; y: number };
  rightCorner: { x: number; y: number };
  timestamp: number;
}

export interface LipSyncResult {
  audioVideoDriftMs: number;
  lipVelocityCorrelation: number;
  multiPersonDetected: boolean;
  syncSamples: number;
  isSynced: boolean;
}

export interface LipTrackerConfig {
  sampleRate: number;
  driftThresholdMs: number;
  correlationThreshold: number;
}

export class LipTracker {
  private config: LipTrackerConfig;
  private lipHistory: LipCoordinates[] = [];
  private audioHistory: number[] = [];
  private startTime: number = 0;
  private readonly MAX_FRAMES = 300; // CRITICAL FIX: Cap at 300 frames (~10 seconds at 30Hz) to prevent memory leaks (P3)

  constructor(config: Partial<LipTrackerConfig> = {}) {
    this.config = {
      sampleRate: 30, // 30 Hz lip tracking
      driftThresholdMs: 150, // 150ms max drift
      correlationThreshold: 0.6, // Minimum correlation for sync
      ...config,
    };
  }

  /**
   * Add lip coordinates from facial mesh
   * Uses MediaPipe Face Mesh landmarks (indices 13, 14, 61, 291 for lips)
   */
  addLipCoordinates(landmarks: number[][], timestamp: number): void {
    // Extract key lip landmarks
    // Upper lip: landmark 13
    // Lower lip: landmark 14
    // Left corner: landmark 61
    // Right corner: landmark 291
    const upperLip = landmarks[13] || { x: 0, y: 0 };
    const lowerLip = landmarks[14] || { x: 0, y: 0 };
    const leftCorner = landmarks[61] || { x: 0, y: 0 };
    const rightCorner = landmarks[291] || { x: 0, y: 0 };

    this.lipHistory.push({
      upperLip: { x: upperLip[0], y: upperLip[1] },
      lowerLip: { x: lowerLip[0], y: lowerLip[1] },
      leftCorner: { x: leftCorner[0], y: leftCorner[1] },
      rightCorner: { x: rightCorner[0], y: rightCorner[1] },
      timestamp,
    });

    // CRITICAL FIX: Enforce circular buffer limit to prevent unbounded growth (P3)
    if (this.lipHistory.length > this.MAX_FRAMES) {
      this.lipHistory.shift(); // Remove oldest frame
    }

    if (this.startTime === 0) {
      this.startTime = timestamp;
    }
  }

  /**
   * Add audio amplitude for correlation analysis
   */
  addAudioAmplitude(amplitude: number): void {
    this.audioHistory.push(amplitude);

    // CRITICAL FIX: Enforce circular buffer limit to prevent unbounded growth (P3)
    if (this.audioHistory.length > this.MAX_FRAMES) {
      this.audioHistory.shift(); // Remove oldest frame
    }
  }

  /**
   * Analyze lip-sync data
   */
  analyze(): LipSyncResult {
    if (this.lipHistory.length < 10) {
      return {
        audioVideoDriftMs: 0,
        lipVelocityCorrelation: 0,
        multiPersonDetected: false,
        syncSamples: this.lipHistory.length,
        isSynced: false,
      };
    }

    // Calculate audio-video drift
    const audioVideoDriftMs = this.calculateAudioVideoDrift();

    // Calculate lip velocity correlation with audio
    const lipVelocityCorrelation = this.calculateLipVelocityCorrelation();

    // Detect multiple faces
    const multiPersonDetected = this.detectMultipleFaces();

    // Determine if synced
    const isSynced = this.isLipSynced(audioVideoDriftMs, lipVelocityCorrelation, multiPersonDetected);

    return {
      audioVideoDriftMs,
      lipVelocityCorrelation,
      multiPersonDetected,
      syncSamples: this.lipHistory.length,
      isSynced,
    };
  }

  /**
   * Calculate audio-video drift in milliseconds
   */
  private calculateAudioVideoDrift(): number {
    if (this.lipHistory.length < 2 || this.audioHistory.length < 2) return 0;

    // Calculate lip opening/closing velocity
    const lipVelocities: number[] = [];
    for (let i = 1; i < this.lipHistory.length; i++) {
      const prev = this.lipHistory[i - 1];
      const curr = this.lipHistory[i];

      const prevDistance = Math.sqrt(
        (prev.upperLip.x - prev.lowerLip.x) ** 2 +
        (prev.upperLip.y - prev.lowerLip.y) ** 2
      );
      const currDistance = Math.sqrt(
        (curr.upperLip.x - curr.lowerLip.x) ** 2 +
        (curr.upperLip.y - curr.lowerLip.y) ** 2
      );

      const dt = (curr.timestamp - prev.timestamp) / 1000; // seconds
      if (dt > 0) {
        lipVelocities.push((currDistance - prevDistance) / dt);
      }
    }

    // Find correlation peak between lip velocity and audio
    const audioAmplitudes = this.audioHistory.slice(-lipVelocities.length);
    const drift = this.findCrossCorrelationPeak(lipVelocities, audioAmplitudes);

    return drift;
  }

  /**
   * Find cross-correlation peak to estimate drift
   */
  private findCrossCorrelationPeak(signal1: number[], signal2: number[]): number {
    const maxLag = Math.min(signal1.length, signal2.length);
    let maxCorrelation = 0;
    let bestLag = 0;

    for (let lag = 0; lag < maxLag; lag++) {
      let correlation = 0;
      const n = Math.min(signal1.length - lag, signal2.length);

      for (let i = 0; i < n; i++) {
        correlation += signal1[i + lag] * signal2[i];
      }

      correlation /= n;

      if (correlation > maxCorrelation) {
        maxCorrelation = correlation;
        bestLag = lag;
      }
    }

    // Convert lag to milliseconds
    return (bestLag / this.config.sampleRate) * 1000;
  }

  /**
   * Calculate correlation between lip velocity and audio amplitude
   */
  private calculateLipVelocityCorrelation(): number {
    if (this.lipHistory.length < 2 || this.audioHistory.length < 2) return 0;

    // Calculate lip opening velocities
    const lipVelocities: number[] = [];
    for (let i = 1; i < this.lipHistory.length; i++) {
      const prev = this.lipHistory[i - 1];
      const curr = this.lipHistory[i];

      const prevDistance = Math.sqrt(
        (prev.upperLip.x - prev.lowerLip.x) ** 2 +
        (prev.upperLip.y - prev.lowerLip.y) ** 2
      );
      const currDistance = Math.sqrt(
        (curr.upperLip.x - curr.lowerLip.x) ** 2 +
        (curr.upperLip.y - curr.lowerLip.y) ** 2
      );

      const dt = (curr.timestamp - prev.timestamp) / 1000;
      if (dt > 0) {
        lipVelocities.push((currDistance - prevDistance) / dt);
      }
    }

    // Align with audio
    const audioSubset = this.audioHistory.slice(-lipVelocities.length);

    if (lipVelocities.length < 2) return 0;

    return this.pearsonCorrelation(lipVelocities, audioSubset);
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
   * Detect if multiple faces are present
   * This is a simplified check - in production, MediaPipe would provide face count
   */
  private detectMultipleFaces(): boolean {
    // This would be determined by MediaPipe's face detection
    // For now, return false as placeholder
    // In production, check the number of detected faces from MediaPipe
    return false;
  }

  /**
   * Determine if lip-sync is valid
   */
  private isLipSynced(
    driftMs: number,
    correlation: number,
    multiPerson: boolean
  ): boolean {
    // Valid sync requires:
    // - Drift below threshold
    // - Correlation above threshold
    // - Single person

    const validDrift = driftMs <= this.config.driftThresholdMs;
    const validCorrelation = correlation >= this.config.correlationThreshold;
    const singlePerson = !multiPerson;

    return validDrift && validCorrelation && singlePerson;
  }

  /**
   * Calculate lip aperture (distance between upper and lower lip)
   */
  getLipAperture(): number {
    if (this.lipHistory.length === 0) return 0;

    const latest = this.lipHistory[this.lipHistory.length - 1];
    return Math.sqrt(
      (latest.upperLip.x - latest.lowerLip.x) ** 2 +
      (latest.upperLip.y - latest.lowerLip.y) ** 2
    );
  }

  /**
   * Reset the tracker state
   */
  reset(): void {
    this.lipHistory = [];
    this.audioHistory = [];
    this.startTime = 0;
  }

  /**
   * Get the number of samples collected
   */
  getSampleCount(): number {
    return this.lipHistory.length;
  }
}
