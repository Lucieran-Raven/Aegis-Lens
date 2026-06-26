/**
 * Aegis Lens v2.0 - Glint Detector Tests
 * Tests for corneal reflection tracking and micro-saccade analysis
 */

import { GlintDetector } from '../detectors/glint-detector';

describe('GlintDetector', () => {
  let detector: GlintDetector;

  beforeEach(() => {
    detector = new GlintDetector();
  });

  describe('addGazePoint', () => {
    it('should add gaze points successfully', () => {
      detector.addGazePoint(0.5, 0.5, Date.now());
      detector.addGazePoint(0.6, 0.6, Date.now() + 100);

      expect(detector.getSampleCount()).toBe(2);
    });

    it('should limit history to recent samples', () => {
      const maxSamples = 60 * 5; // 5 seconds at 60 Hz
      for (let i = 0; i < maxSamples + 10; i++) {
        detector.addGazePoint(0.5, 0.5, Date.now() + i * 16);
      }

      expect(detector.getSampleCount()).toBeLessThanOrEqual(maxSamples);
    });
  });

  describe('addLuminance', () => {
    it('should add luminance readings', () => {
      detector.addLuminance(0.5);
      detector.addLuminance(0.6);

      expect(detector.getSampleCount()).toBe(0); // Luminance doesn't count as gaze samples
    });
  });

  describe('analyze', () => {
    it('should return default values with insufficient data', () => {
      const result = detector.analyze();

      expect(result.microsaccadeRate).toBe(0);
      expect(result.glintParallaxVariance).toBe(0);
      expect(result.isLive).toBe(false);
    });

    it('should analyze gaze data with sufficient samples', () => {
      const now = Date.now();
      for (let i = 0; i < 20; i++) {
        detector.addGazePoint(0.5 + i * 0.01, 0.5 + i * 0.01, now + i * 16);
      }

      const result = detector.analyze();

      expect(result.gazeSamples).toBe(20);
      expect(result.microsaccadeRate).toBeGreaterThanOrEqual(0);
    });
  });

  describe('reset', () => {
    it('should clear all history', () => {
      detector.addGazePoint(0.5, 0.5, Date.now());
      detector.addLuminance(0.5);
      detector.reset();

      expect(detector.getSampleCount()).toBe(0);
    });
  });
});
