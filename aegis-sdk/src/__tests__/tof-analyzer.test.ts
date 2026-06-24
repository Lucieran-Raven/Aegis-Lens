/**
 * Aegis Lens v2.0 - ToF Analyzer Tests
 * Tests for Time-of-Flight analysis using cross-correlation
 */

import { ToFAnalyzer } from '../tof-analyzer';

describe('ToFAnalyzer', () => {
  let analyzer: ToFAnalyzer;

  beforeEach(() => {
    analyzer = new ToFAnalyzer();
  });

  describe('analyze', () => {
    it('should handle empty arrays', () => {
      const transmitted = new Float32Array([]);
      const received = new Float32Array([]);

      const result = analyzer.analyze(transmitted, received);

      expect(result.timeOfFlightMs).toBe(0);
      expect(result.correlationPeak).toBe(0);
      expect(result.phaseSignatureValid).toBe(false);
    });

    it('should detect zero delay when signals are identical', () => {
      const signal = new Float32Array([1, 2, 3, 4, 5, 4, 3, 2, 1]);
      
      const result = analyzer.analyze(signal, signal);

      expect(result.timeOfFlightMs).toBeCloseTo(0, 2);
      expect(result.correlationPeak).toBeGreaterThan(0.9);
      expect(result.phaseSignatureValid).toBe(true);
    });

    it('should calculate positive delay when received signal is delayed', () => {
      const transmitted = new Float32Array([1, 2, 3, 4, 5]);
      const received = new Float32Array([0, 0, 1, 2, 3, 4, 5]); // 2 sample delay

      const result = analyzer.analyze(transmitted, received);

      expect(result.timeOfFlightMs).toBeGreaterThan(0);
      expect(result.peakIndex).toBe(2);
    });

    it('should detect phase signature invalid for excessive delay', () => {
      const transmitted = new Float32Array([1, 2, 3, 4, 5]);
      const received = new Float32Array(new Array(100).fill(0).concat([1, 2, 3, 4, 5])); // 100 sample delay

      const result = analyzer.analyze(transmitted, received);

      expect(result.phaseSignatureValid).toBe(false);
    });
  });

  describe('computeSpectralEntropy', () => {
    it('should return 0 for empty audio', () => {
      const audio = new Float32Array([]);
      const entropy = analyzer.computeSpectralEntropy(audio);

      expect(entropy).toBe(0);
    });

    it('should return 0 for silent audio', () => {
      const audio = new Float32Array(new Array(100).fill(0));
      const entropy = analyzer.computeSpectralEntropy(audio);

      expect(entropy).toBe(0);
    });

    it('should return higher entropy for complex audio', () => {
      const audio = new Float32Array(
        Array.from({ length: 100 }, () => Math.random() * 2 - 1)
      );
      const entropy = analyzer.computeSpectralEntropy(audio);

      expect(entropy).toBeGreaterThan(0);
      expect(entropy).toBeLessThanOrEqual(1);
    });
  });

  describe('detectSoftwareFiltering', () => {
    it('should detect filtering in low entropy audio', () => {
      // Create audio with low entropy (sinusoidal)
      const audio = new Float32Array(
        Array.from({ length: 100 }, (_, i) => Math.sin(i * 0.1))
      );
      const isFiltered = analyzer.detectSoftwareFiltering(audio);

      expect(isFiltered).toBe(true);
    });

    it('should not detect filtering in high entropy audio', () => {
      const audio = new Float32Array(
        Array.from({ length: 100 }, () => Math.random() * 2 - 1)
      );
      const isFiltered = analyzer.detectSoftwareFiltering(audio);

      expect(isFiltered).toBe(false);
    });
  });
});
