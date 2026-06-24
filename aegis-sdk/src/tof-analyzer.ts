/**
 * Aegis Lens v2.0 - Time-of-Flight (ToF) Analyzer
 * Normalized cross-correlation algorithm for peak-prominence ToF analysis
 * Measures audio round-trip time to detect virtual audio devices
 */

export interface ToFResult {
  timeOfFlightMs: number;
  correlationPeak: number;
  peakIndex: number;
  phaseSignatureValid: boolean;
  sampleCount: number;
}

export interface ToFConfig {
  sampleRate: number;
  maxDelayMs: number;
  minCorrelation: number;
}

export class ToFAnalyzer {
  private config: ToFConfig;

  constructor(config: Partial<ToFConfig> = {}) {
    this.config = {
      sampleRate: 48000,
      maxDelayMs: 50, // Maximum expected delay in ms
      minCorrelation: 0.5, // Minimum correlation threshold
      ...config,
    };
  }

  /**
   * Compute Time-of-Flight using normalized cross-correlation
   * Compares transmitted chirp with received audio to find delay
   */
  analyze(transmitted: Float32Array, received: Float32Array): ToFResult {
    if (transmitted.length === 0 || received.length === 0) {
      return {
        timeOfFlightMs: 0,
        correlationPeak: 0,
        peakIndex: 0,
        phaseSignatureValid: false,
        sampleCount: 0,
      };
    }

    // Ensure transmitted is shorter than received
    const chirp = transmitted.length <= received.length ? transmitted : received;
    const response = transmitted.length <= received.length ? received : transmitted;

    // Compute normalized cross-correlation
    const correlation = this.normalizedCrossCorrelation(chirp, response);

    // Find peak correlation
    const peakResult = this.findPeak(correlation);

    // Convert peak index to time-of-flight in milliseconds
    const timeOfFlightMs = (peakResult.peakIndex / this.config.sampleRate) * 1000;

    // Validate phase signature (check if peak is within expected range)
    const maxDelaySamples = Math.floor((this.config.maxDelayMs / 1000) * this.config.sampleRate);
    const phaseSignatureValid = peakResult.peakIndex <= maxDelaySamples && peakResult.peakValue >= this.config.minCorrelation;

    return {
      timeOfFlightMs,
      correlationPeak: peakResult.peakValue,
      peakIndex: peakResult.peakIndex,
      phaseSignatureValid,
      sampleCount: response.length,
    };
  }

  /**
   * Normalized cross-correlation (NCC)
   * NCC[k] = Σ(x[i] * y[i+k]) / sqrt(Σ(x[i]²) * Σ(y[i+k]²))
   */
  private normalizedCrossCorrelation(x: Float32Array, y: Float32Array): Float32Array {
    const n = x.length;
    const m = y.length;
    const maxLag = m - n;

    if (maxLag <= 0) {
      return new Float32Array([0]);
    }

    const correlation = new Float32Array(maxLag);

    // Precompute x squared sum
    let xSquaredSum = 0;
    for (let i = 0; i < n; i++) {
      xSquaredSum += x[i] * x[i];
    }

    // Compute sliding window y squared sums
    const ySquaredSums = new Float32Array(maxLag);
    let windowSum = 0;

    for (let i = 0; i < n; i++) {
      windowSum += y[i] * y[i];
    }
    ySquaredSums[0] = windowSum;

    for (let lag = 1; lag < maxLag; lag++) {
      windowSum -= y[lag - 1] * y[lag - 1];
      windowSum += y[lag + n - 1] * y[lag + n - 1];
      ySquaredSums[lag] = windowSum;
    }

    // Compute normalized cross-correlation for each lag
    for (let lag = 0; lag < maxLag; lag++) {
      let numerator = 0;
      for (let i = 0; i < n; i++) {
        numerator += x[i] * y[i + lag];
      }

      const denominator = Math.sqrt(xSquaredSum * ySquaredSums[lag]);
      
      if (denominator > 1e-10) {
        correlation[lag] = numerator / denominator;
      } else {
        correlation[lag] = 0;
      }
    }

    return correlation;
  }

  /**
   * Find peak in correlation array with prominence analysis
   */
  private findPeak(correlation: Float32Array): { peakIndex: number; peakValue: number } {
    if (correlation.length === 0) {
      return { peakIndex: 0, peakValue: 0 };
    }

    let peakIndex = 0;
    let peakValue = correlation[0];

    for (let i = 1; i < correlation.length; i++) {
      if (correlation[i] > peakValue) {
        peakValue = correlation[i];
        peakIndex = i;
      }
    }

    // Sub-sample interpolation for better precision
    if (peakIndex > 0 && peakIndex < correlation.length - 1) {
      const y1 = correlation[peakIndex - 1];
      const y2 = correlation[peakIndex];
      const y3 = correlation[peakIndex + 1];

      // Parabolic interpolation
      const offset = 0.5 * (y1 - y3) / (y1 - 2 * y2 + y3);
      
      if (Math.abs(offset) < 1) {
        peakIndex = peakIndex + offset;
        peakValue = y2 - 0.25 * (y1 - y3) * offset;
      }
    }

    return { peakIndex, peakValue };
  }

  /**
   * Compute spectral entropy of audio signal
   * Used to detect software noise filters
   */
  computeSpectralEntropy(audio: Float32Array): number {
    if (audio.length === 0) return 0;

    // Compute FFT (simplified magnitude spectrum)
    const spectrum = this.computeMagnitudeSpectrum(audio);

    // Normalize to create probability distribution
    const sum = spectrum.reduce((a, b) => a + b, 0);
    if (sum === 0) return 0;

    const probabilities = spectrum.map(mag => mag / sum);

    // Compute entropy: H = -Σ(p * log2(p))
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
   * Compute magnitude spectrum using simplified FFT
   */
  private computeMagnitudeSpectrum(audio: Float32Array): Float32Array {
    const n = audio.length;
    const spectrum = new Float32Array(Math.floor(n / 2) + 1);

    // Simplified: use power spectral density estimation
    for (let k = 0; k < spectrum.length; k++) {
      let real = 0;
      let imag = 0;

      for (let i = 0; i < n; i++) {
        const angle = (2 * Math.PI * k * i) / n;
        real += audio[i] * Math.cos(angle);
        imag -= audio[i] * Math.sin(angle);
      }

      spectrum[k] = Math.sqrt(real * real + imag * imag);
    }

    return spectrum;
  }

  /**
   * Detect if audio has been processed by software filters
   * High spectral entropy suggests natural audio, low entropy suggests filtering
   */
  detectSoftwareFiltering(audio: Float32Array): boolean {
    const entropy = this.computeSpectralEntropy(audio);
    // Threshold: entropy < 0.5 suggests aggressive filtering
    return entropy < 0.5;
  }
}
