/**
 * Aegis Lens v2.0 - Glint Detector
 * Corneal reflection tracking for micro-saccade vector analysis
 * Detects virtual cameras by analyzing eye movement patterns
 */

export interface GazePoint {
  x: number;
  y: number;
  timestamp: number;
}

export interface MicrosaccadeResult {
  microsaccadeRate: number;      // Hz - saccades per second
  glintParallaxVariance: number; // Variance in glint parallax
  luminanceCorrelation: number;  // Correlation with screen luminance
  gazeSamples: number;
  isLive: boolean;
}

export interface GlintDetectorConfig {
  sampleRate: number;
  microsaccadeThreshold: number;
  parallaxThreshold: number;
}

export class GlintDetector {
  private config: GlintDetectorConfig;
  private gazeHistory: GazePoint[] = [];
  private luminanceHistory: number[] = [];
  private startTime: number = 0;
  private readonly MAX_FRAMES = 300; // CRITICAL FIX: Cap at 300 frames (~10 seconds at 30Hz) to prevent memory leaks (P3)

  constructor(config: Partial<GlintDetectorConfig> = {}) {
    this.config = {
      sampleRate: 60, // 60 Hz gaze tracking
      microsaccadeThreshold: 2.0, // degrees per second
      parallaxThreshold: 0.1, // minimum variance
      ...config,
    };
  }

  /**
   * Add a gaze point for analysis
   */
  addGazePoint(x: number, y: number, timestamp: number): void {
    this.gazeHistory.push({ x, y, timestamp });

    // CRITICAL FIX: Enforce circular buffer limit to prevent unbounded growth (P3)
    if (this.gazeHistory.length > this.MAX_FRAMES) {
      this.gazeHistory.shift(); // Remove oldest frame
    }

    if (this.startTime === 0) {
      this.startTime = timestamp;
    }
  }

  /**
   * Add luminance reading for correlation analysis
   */
  addLuminance(luminance: number): void {
    this.luminanceHistory.push(luminance);

    // CRITICAL FIX: Enforce circular buffer limit to prevent unbounded growth (P3)
    if (this.luminanceHistory.length > this.MAX_FRAMES) {
      this.luminanceHistory.shift(); // Remove oldest frame
    }
  }

  /**
   * Analyze gaze data for microsaccades and glint patterns
   */
  analyze(): MicrosaccadeResult {
    if (this.gazeHistory.length < 10) {
      return {
        microsaccadeRate: 0,
        glintParallaxVariance: 0,
        luminanceCorrelation: 0,
        gazeSamples: this.gazeHistory.length,
        isLive: false,
      };
    }

    // Calculate microsaccade rate
    const microsaccadeRate = this.calculateMicrosaccadeRate();

    // Calculate glint parallax variance
    const glintParallaxVariance = this.calculateGlintParallaxVariance();

    // Calculate luminance correlation
    const luminanceCorrelation = this.calculateLuminanceCorrelation();

    // Determine if live (real human eyes)
    const isLive = this.isLiveGaze(microsaccadeRate, glintParallaxVariance, luminanceCorrelation);

    return {
      microsaccadeRate,
      glintParallaxVariance,
      luminanceCorrelation,
      gazeSamples: this.gazeHistory.length,
      isLive,
    };
  }

  /**
   * Calculate microsaccade rate (saccades per second)
   */
  private calculateMicrosaccadeRate(): number {
    if (this.gazeHistory.length < 2) return 0;

    let saccadeCount = 0;
    const threshold = this.config.microsaccadeThreshold;

    for (let i = 1; i < this.gazeHistory.length; i++) {
      const prev = this.gazeHistory[i - 1];
      const curr = this.gazeHistory[i];

      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      const dt = (curr.timestamp - prev.timestamp) / 1000; // seconds

      if (dt > 0) {
        const velocity = Math.sqrt(dx * dx + dy * dy) / dt;
        if (velocity > threshold) {
          saccadeCount++;
        }
      }
    }

    // Calculate duration in seconds
    const duration = (this.gazeHistory[this.gazeHistory.length - 1].timestamp - this.startTime) / 1000;

    if (duration > 0) {
      return saccadeCount / duration;
    }

    return 0;
 }

  /**
   * Calculate glint parallax variance
   * Measures the variance in eye position relative to expected patterns
   */
  private calculateGlintParallaxVariance(): number {
    if (this.gazeHistory.length < 2) return 0;

    // Calculate variance in position
    const meanX = this.gazeHistory.reduce((sum, p) => sum + p.x, 0) / this.gazeHistory.length;
    const meanY = this.gazeHistory.reduce((sum, p) => sum + p.y, 0) / this.gazeHistory.length;

    let varianceX = 0;
    let varianceY = 0;

    for (const point of this.gazeHistory) {
      varianceX += (point.x - meanX) ** 2;
      varianceY += (point.y - meanY) ** 2;
    }

    varianceX /= this.gazeHistory.length;
    varianceY /= this.gazeHistory.length;

    // Combined variance
    return Math.sqrt(varianceX + varianceY);
  }

  /**
   * Calculate correlation between gaze and screen luminance
   * Real eyes show correlation with screen brightness changes
   */
  private calculateLuminanceCorrelation(): number {
    if (this.gazeHistory.length < 2 || this.luminanceHistory.length < 2) return 0;

    // Align the two arrays
    const minLen = Math.min(this.gazeHistory.length, this.luminanceHistory.length);
    const gazeSubset = this.gazeHistory.slice(-minLen);
    const luminanceSubset = this.luminanceHistory.slice(-minLen);

    // Calculate correlation between gaze velocity and luminance changes
    const gazeVelocities: number[] = [];
    const luminanceChanges: number[] = [];

    for (let i = 1; i < minLen; i++) {
      const dx = gazeSubset[i].x - gazeSubset[i - 1].x;
      const dy = gazeSubset[i].y - gazeSubset[i - 1].y;
      const velocity = Math.sqrt(dx * dx + dy * dy);
      gazeVelocities.push(velocity);

      const dl = luminanceSubset[i] - luminanceSubset[i - 1];
      luminanceChanges.push(dl);
    }

    if (gazeVelocities.length < 2) return 0;

    return this.pearsonCorrelation(gazeVelocities, luminanceChanges);
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
   * Determine if gaze pattern indicates live human eyes
   */
  private isLiveGaze(
    microsaccadeRate: number,
    glintParallaxVariance: number,
    _luminanceCorrelation: number
  ): boolean {
    // Live eyes should have:
    // - Microsaccade rate between 0.5 and 5 Hz
    // - Glint parallax variance above threshold
    // - Some correlation with luminance (not required but indicative)

    const validMicrosaccades = microsaccadeRate >= 0.5 && microsaccadeRate <= 5.0;
    const validParallax = glintParallaxVariance >= this.config.parallaxThreshold;

    // At least microsaccades and parallax must be valid
    return validMicrosaccades && validParallax;
  }

  /**
   * Reset the detector state
   */
  reset(): void {
    this.gazeHistory = [];
    this.luminanceHistory = [];
    this.startTime = 0;
  }

  /**
   * Get the number of samples collected
   */
  getSampleCount(): number {
    return this.gazeHistory.length;
  }
}
