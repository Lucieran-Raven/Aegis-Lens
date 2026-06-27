
import {
  TelemetryPayload,
  CameraTimingSignal,
  AcousticSignal,
  EyeTrackingSignal,
  LipSyncSignal,
} from '../proto/session';

export class PayloadBuilder {
  private sessionId: string;
  private sessionNonce: string;
  private clientTimestamp: number;
  private cameraTiming?: CameraTimingSignal;
  private acoustic?: AcousticSignal;
  private eyeTracking?: EyeTrackingSignal;
  private lipSync?: LipSyncSignal;

  constructor(sessionId: string, sessionNonce: string) {
    this.sessionId = sessionId;
    this.sessionNonce = sessionNonce;
    this.clientTimestamp = Date.now();
  }

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

  setEyeTrackingUnavailable(reason: string): PayloadBuilder {
    this.eyeTracking = {
      microsaccadeRate: 0,
      glintParallaxVariance: 0,
      luminanceCorrelation: 0,
      gazeSamples: 0,
    } as any;
    (this.eyeTracking as any).status = 'unavailable';
    (this.eyeTracking as any).reason = reason;
    return this;
  }

  setLipSyncUnavailable(reason: string): PayloadBuilder {
    this.lipSync = {
      audioVideoDriftMs: 0,
      lipVelocityCorrelation: 0,
      multiPersonDetected: false,
      syncSamples: 0,
    } as any;
    (this.lipSync as any).status = 'unavailable';
    (this.lipSync as any).reason = reason;
    return this;
  }

  build(): TelemetryPayload {
    return {
      sessionId: this.sessionId,
      clientTimestamp: this.clientTimestamp,
      sessionNonce: this.sessionNonce,
      cameraTiming: this.cameraTiming,
      acoustic: this.acoustic,
      eyeTracking: this.eyeTracking,
      lipSync: this.lipSync,
    };
  }

  reset(): PayloadBuilder {
    this.clientTimestamp = Date.now();
    this.cameraTiming = undefined;
    this.acoustic = undefined;
    this.eyeTracking = undefined;
    this.lipSync = undefined;
    return this;
  }
}
