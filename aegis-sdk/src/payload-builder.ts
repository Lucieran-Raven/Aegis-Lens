/**
 * Aegis Lens v2.0 - Payload Builder
 * Constructs telemetry payloads for submission to the verification server
 */

import {
  TelemetryPayload,
  CameraTimingSignal,
  AcousticSignal,
  EyeTrackingSignal,
  LipSyncSignal,
} from './proto/session';

export class PayloadBuilder {
  private sessionId: string;
  private clientTimestamp: number;
  private cameraTiming?: CameraTimingSignal;
  private acoustic?: AcousticSignal;
  private eyeTracking?: EyeTrackingSignal;
  private lipSync?: LipSyncSignal;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.clientTimestamp = Date.now();
  }

  /**
   * Set camera timing entropy data (Signal A)
   */
  setCameraTiming(data: {
    variance: number;
    stdDev: number;
    klDivergence: number;
    shapiroWilkW: number;
    sampleCount: number;
    frameDeltas: number[];
  }): PayloadBuilder {
    this.cameraTiming = {
      variance: data.variance,
      stdDev: data.stdDev,
      klDivergence: data.klDivergence,
      shapiroWilkW: data.shapiroWilkW,
      sampleCount: data.sampleCount,
      frameDeltas: data.frameDeltas,
    };
    return this;
  }

  /**
   * Set acoustic Time-of-Flight data (Signal B)
   */
  setAcousticData(data: {
    timeOfFlightMs: number;
    correlationPeak: number;
    spectralEntropy: number;
    phaseSignatureValid: boolean;
    sampleCount: number;
  }): PayloadBuilder {
    this.acoustic = {
      timeOfFlightMs: data.timeOfFlightMs,
      correlationPeak: data.correlationPeak,
      spectralEntropy: data.spectralEntropy,
      phaseSignatureValid: data.phaseSignatureValid,
      sampleCount: data.sampleCount,
    };
    return this;
  }

  /**
   * Set eye tracking / PCCR data (Signal C)
   */
  setEyeTracking(data: {
    microsaccadeRate: number;
    glintParallaxVariance: number;
    luminanceCorrelation: number;
    gazeSamples: number;
  }): PayloadBuilder {
    this.eyeTracking = {
      microsaccadeRate: data.microsaccadeRate,
      glintParallaxVariance: data.glintParallaxVariance,
      luminanceCorrelation: data.luminanceCorrelation,
      gazeSamples: data.gazeSamples,
    };
    return this;
  }

  /**
   * Set lip-sync drift data (Signal D - proxy detection)
   */
  setLipSync(data: {
    audioVideoDriftMs: number;
    lipVelocityCorrelation: number;
    multiPersonDetected: boolean;
    syncSamples: number;
  }): PayloadBuilder {
    this.lipSync = {
      audioVideoDriftMs: data.audioVideoDriftMs,
      lipVelocityCorrelation: data.lipVelocityCorrelation,
      multiPersonDetected: data.multiPersonDetected,
      syncSamples: data.syncSamples,
    };
    return this;
  }

  /**
   * Build the final telemetry payload
   */
  build(): TelemetryPayload {
    return {
      sessionId: this.sessionId,
      clientTimestamp: this.clientTimestamp,
      cameraTiming: this.cameraTiming,
      acoustic: this.acoustic,
      eyeTracking: this.eyeTracking,
      lipSync: this.lipSync,
    };
  }

  /**
   * Reset the builder for reuse
   */
  reset(): PayloadBuilder {
    this.clientTimestamp = Date.now();
    this.cameraTiming = undefined;
    this.acoustic = undefined;
    this.eyeTracking = undefined;
    this.lipSync = undefined;
    return this;
  }
}
