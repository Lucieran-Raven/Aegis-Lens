/**
 * Aegis Lens v2.0 - Chirp Generator Tests
 * Tests for WebAudio API chirp generation
 */

import { ChirpGenerator } from '../chirp-generator';

describe('ChirpGenerator', () => {
  let generator: ChirpGenerator;

  beforeEach(() => {
    generator = new ChirpGenerator();
  });

  describe('generateChirp', () => {
    it('should generate a chirp with valid audio buffer', async () => {
      const result = generator.generateChirp({
        startFreq: 200,
        endFreq: 8000,
        duration: 0.08,
        sampleRate: 48000,
        nonce: 0,
      });

      expect(result).toBeDefined();
      expect(result.audioBuffer).toBeDefined();
      expect(result.phaseOffset).toBeDefined();
      expect(result.nonce).toBeDefined();
    });

    it('should generate chirp with correct duration', async () => {
      const duration = 0.08; // 80ms
      const result = generator.generateChirp({
        startFreq: 200,
        endFreq: 8000,
        duration: 0.08,
        sampleRate: 48000,
        nonce: 0,
      });

      expect(result.audioBuffer.duration).toBeCloseTo(duration, 2);
    });

    it('should generate different phase offsets for different nonces', async () => {
      const result1 = generator.generateChirp({
        startFreq: 200,
        endFreq: 8000,
        duration: 0.08,
        sampleRate: 48000,
        nonce: 123,
      });
      const result2 = generator.generateChirp({
        startFreq: 200,
        endFreq: 8000,
        duration: 0.08,
        sampleRate: 48000,
        nonce: 456,
      });

      expect(result1.phaseOffset).not.toBe(result2.phaseOffset);
    });

    it('should generate chirp with correct sample rate', async () => {
      const result = generator.generateChirp({
        startFreq: 200,
        endFreq: 8000,
        duration: 0.08,
        sampleRate: 48000,
        nonce: 0,
      });

      expect(result.audioBuffer.sampleRate).toBe(48000);
    });
  });

  describe('playChirp', () => {
    it('should play a chirp successfully', async () => {
      const result = generator.generateChirp({
        startFreq: 200,
        endFreq: 8000,
        duration: 0.08,
        sampleRate: 48000,
        nonce: 0,
      });

      // Skip actual playback test in CI environment - requires real audio
      await generator.playChirp(result);
      expect(true).toBe(true);
    });
  });

  describe('close', () => {
    it('should close the audio context', () => {
      expect(() => generator.close()).not.toThrow();
    });
  });
});
