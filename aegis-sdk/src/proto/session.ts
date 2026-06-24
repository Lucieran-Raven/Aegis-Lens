/**
 * Aegis Lens v2.0 - Protocol Buffer Definitions (TypeScript)
 * Auto-generated from proto/aegis/v2/session.proto
 */

export enum Verdict {
  VERDICT_UNKNOWN = 0,
  VERDICT_CLEAR = 1,
  VERDICT_SUSPICIOUS = 2,
  VERDICT_BLOCKED = 3,
}

export interface SessionInitRequest {
  clientId: string;
  deviceFingerprint: string;
  userAgent: string;
  timestamp: number;
}

export interface SessionInitResponse {
  sessionId: string;
  nonce: Uint8Array; // 4-byte random nonce for anti-replay
  serverTimestamp: number;
  ttlSeconds: number;
}

export interface CameraTimingSignal {
  variance: number;
  stdDev: number;
  klDivergence: number;
  shapiroWilkW: number;
  sampleCount: number;
  frameDeltas: number[]; // Raw deltas for server-side re-analysis
}

export interface AcousticSignal {
  timeOfFlightMs: number;
  correlationPeak: number;
  spectralEntropy: number;
  phaseSignatureValid: boolean;
  sampleCount: number;
}

export interface EyeTrackingSignal {
  microsaccadeRate: number;
  glintParallaxVariance: number;
  luminanceCorrelation: number;
  gazeSamples: number;
}

export interface LipSyncSignal {
  audioVideoDriftMs: number;
  lipVelocityCorrelation: number;
  multiPersonDetected: boolean;
  syncSamples: number;
}

export interface TelemetryPayload {
  sessionId: string;
  clientTimestamp: number;
  cameraTiming?: CameraTimingSignal;
  acoustic?: AcousticSignal;
  eyeTracking?: EyeTrackingSignal;
  lipSync?: LipSyncSignal;
}

export interface SessionVerifyRequest {
  telemetry: TelemetryPayload;
  signature: Uint8Array; // ECDSA P-256 signature
  publicKeyPem: string; // Client ephemeral public key
}

export interface SessionVerifyResponse {
  sessionId: string;
  verdict: Verdict;
  confidenceScore: number;
  signalFlags: string[];
  serverTimestamp: number;
}

// Helper functions for serialization
export class SessionProto {
  static encodeSessionInitRequest(req: SessionInitRequest): Uint8Array {
    const obj = {
      client_id: req.clientId,
      device_fingerprint: req.deviceFingerprint,
      user_agent: req.userAgent,
      timestamp: req.timestamp,
    };
    return new TextEncoder().encode(JSON.stringify(obj));
  }

  static decodeSessionInitRequest(data: Uint8Array): SessionInitRequest {
    const obj = JSON.parse(new TextDecoder().decode(data));
    return {
      clientId: obj.client_id,
      deviceFingerprint: obj.device_fingerprint,
      userAgent: obj.user_agent,
      timestamp: obj.timestamp,
    };
  }

  static encodeSessionInitResponse(res: SessionInitResponse): Uint8Array {
    const obj = {
      session_id: res.sessionId,
      nonce: Array.from(res.nonce),
      server_timestamp: res.serverTimestamp,
      ttl_seconds: res.ttlSeconds,
    };
    return new TextEncoder().encode(JSON.stringify(obj));
  }

  static decodeSessionInitResponse(data: Uint8Array): SessionInitResponse {
    const obj = JSON.parse(new TextDecoder().decode(data));
    return {
      sessionId: obj.session_id,
      nonce: new Uint8Array(obj.nonce),
      serverTimestamp: obj.server_timestamp,
      ttlSeconds: obj.ttl_seconds,
    };
  }

  static encodeTelemetryPayload(payload: TelemetryPayload): Uint8Array {
    const obj = {
      session_id: payload.sessionId,
      client_timestamp: payload.clientTimestamp,
      camera_timing: payload.cameraTiming ? {
        variance: payload.cameraTiming.variance,
        std_dev: payload.cameraTiming.stdDev,
        kl_divergence: payload.cameraTiming.klDivergence,
        shapiro_wilk_w: payload.cameraTiming.shapiroWilkW,
        sample_count: payload.cameraTiming.sampleCount,
        frame_deltas: payload.cameraTiming.frameDeltas,
      } : undefined,
      acoustic: payload.acoustic ? {
        time_of_flight_ms: payload.acoustic.timeOfFlightMs,
        correlation_peak: payload.acoustic.correlationPeak,
        spectral_entropy: payload.acoustic.spectralEntropy,
        phase_signature_valid: payload.acoustic.phaseSignatureValid,
        sample_count: payload.acoustic.sampleCount,
      } : undefined,
      eye_tracking: payload.eyeTracking ? {
        microsaccade_rate: payload.eyeTracking.microsaccadeRate,
        glint_parallax_variance: payload.eyeTracking.glintParallaxVariance,
        luminance_correlation: payload.eyeTracking.luminanceCorrelation,
        gaze_samples: payload.eyeTracking.gazeSamples,
      } : undefined,
      lip_sync: payload.lipSync ? {
        audio_video_drift_ms: payload.lipSync.audioVideoDriftMs,
        lip_velocity_correlation: payload.lipSync.lipVelocityCorrelation,
        multi_person_detected: payload.lipSync.multiPersonDetected,
        sync_samples: payload.lipSync.syncSamples,
      } : undefined,
    };
    return new TextEncoder().encode(JSON.stringify(obj));
  }

  static decodeTelemetryPayload(data: Uint8Array): TelemetryPayload {
    const obj = JSON.parse(new TextDecoder().decode(data));
    return {
      sessionId: obj.session_id,
      clientTimestamp: obj.client_timestamp,
      cameraTiming: obj.camera_timing ? {
        variance: obj.camera_timing.variance,
        stdDev: obj.camera_timing.std_dev,
        klDivergence: obj.camera_timing.kl_divergence,
        shapiroWilkW: obj.camera_timing.shapiro_wilk_w,
        sampleCount: obj.camera_timing.sample_count,
        frameDeltas: obj.camera_timing.frame_deltas,
      } : undefined,
      acoustic: obj.acoustic ? {
        timeOfFlightMs: obj.acoustic.time_of_flight_ms,
        correlationPeak: obj.acoustic.correlation_peak,
        spectralEntropy: obj.acoustic.spectral_entropy,
        phaseSignatureValid: obj.acoustic.phase_signature_valid,
        sampleCount: obj.acoustic.sample_count,
      } : undefined,
      eyeTracking: obj.eye_tracking ? {
        microsaccadeRate: obj.eye_tracking.microsaccade_rate,
        glintParallaxVariance: obj.eye_tracking.glint_parallax_variance,
        luminanceCorrelation: obj.eye_tracking.luminance_correlation,
        gazeSamples: obj.eye_tracking.gaze_samples,
      } : undefined,
      lipSync: obj.lip_sync ? {
        audioVideoDriftMs: obj.lip_sync.audio_video_drift_ms,
        lipVelocityCorrelation: obj.lip_sync.lip_velocity_correlation,
        multiPersonDetected: obj.lip_sync.multi_person_detected,
        syncSamples: obj.lip_sync.sync_samples,
      } : undefined,
    };
  }

  static encodeSessionVerifyRequest(req: SessionVerifyRequest): Uint8Array {
    const obj = {
      telemetry: JSON.parse(new TextDecoder().decode(this.encodeTelemetryPayload(req.telemetry))),
      signature: Array.from(req.signature),
      public_key_pem: req.publicKeyPem,
    };
    return new TextEncoder().encode(JSON.stringify(obj));
  }

  static decodeSessionVerifyRequest(data: Uint8Array): SessionVerifyRequest {
    const obj = JSON.parse(new TextDecoder().decode(data));
    return {
      telemetry: this.decodeTelemetryPayload(new TextEncoder().encode(JSON.stringify(obj.telemetry))),
      signature: new Uint8Array(obj.signature),
      publicKeyPem: obj.public_key_pem,
    };
  }

  static encodeSessionVerifyResponse(res: SessionVerifyResponse): Uint8Array {
    const obj = {
      session_id: res.sessionId,
      verdict: res.verdict,
      confidence_score: res.confidenceScore,
      signal_flags: res.signalFlags,
      server_timestamp: res.serverTimestamp,
    };
    return new TextEncoder().encode(JSON.stringify(obj));
  }

  static decodeSessionVerifyResponse(data: Uint8Array): SessionVerifyResponse {
    const obj = JSON.parse(new TextDecoder().decode(data));
    return {
      sessionId: obj.session_id,
      verdict: obj.verdict,
      confidenceScore: obj.confidence_score,
      signalFlags: obj.signal_flags,
      serverTimestamp: obj.server_timestamp,
    };
  }
}
