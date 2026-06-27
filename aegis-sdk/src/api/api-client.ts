
import {
  SessionInitRequest,
  SessionInitResponse,
  SessionVerifyRequest,
  SessionVerifyResponse,
} from '../proto/session';

export interface AegisClientConfig {
  apiEndpoint: string;
  timeoutMs?: number;
}

export class AegisApiClient {
  private config: AegisClientConfig;

  constructor(config: AegisClientConfig) {
    this.config = {
      timeoutMs: 10000,
      ...config,
    };
  }

  async initSession(request: SessionInitRequest): Promise<SessionInitResponse> {
    const url = `${this.config.apiEndpoint}/api/v2/session/init`;
    
    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: request.clientId,
        device_fingerprint: request.deviceFingerprint,
        user_agent: request.userAgent,
        timestamp: request.timestamp,
      }),
    });

    if (!response.ok) {
      throw new Error(`Session init failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    return {
      sessionId: data.session_id,
      nonce: data.nonce,
      serverTimestamp: data.server_timestamp,
      ttlSeconds: data.ttl_seconds,
    };
  }

  async verifySession(request: SessionVerifyRequest): Promise<SessionVerifyResponse> {
    const url = `${this.config.apiEndpoint}/api/v2/session/verify`;
    
    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        telemetry: {
          session_id: request.telemetry.sessionId,
          client_timestamp: request.telemetry.clientTimestamp,
          session_nonce: request.telemetry.sessionNonce,
          camera_timing: request.telemetry.cameraTiming ? {
            variance: request.telemetry.cameraTiming.variance,
            std_dev: request.telemetry.cameraTiming.stdDev,
            kl_divergence: request.telemetry.cameraTiming.klDivergence,
            shapiro_wilk_w: request.telemetry.cameraTiming.shapiroWilkW,
            sample_count: request.telemetry.cameraTiming.sampleCount,
            frame_deltas: request.telemetry.cameraTiming.frameDeltas,
          } : undefined,
          acoustic: request.telemetry.acoustic ? {
            time_of_flight_ms: request.telemetry.acoustic.timeOfFlightMs,
            correlation_peak: request.telemetry.acoustic.correlationPeak,
            spectral_entropy: request.telemetry.acoustic.spectralEntropy,
            phase_signature_valid: request.telemetry.acoustic.phaseSignatureValid,
            sample_count: request.telemetry.acoustic.sampleCount,
          } : undefined,
          eye_tracking: request.telemetry.eyeTracking ? {
            microsaccade_rate: request.telemetry.eyeTracking.microsaccadeRate,
            glint_parallax_variance: request.telemetry.eyeTracking.glintParallaxVariance,
            luminance_correlation: request.telemetry.eyeTracking.luminanceCorrelation,
            gaze_samples: request.telemetry.eyeTracking.gazeSamples,
          } : undefined,
          lip_sync: request.telemetry.lipSync ? {
            audio_video_drift_ms: request.telemetry.lipSync.audioVideoDriftMs,
            lip_velocity_correlation: request.telemetry.lipSync.lipVelocityCorrelation,
            multi_person_detected: request.telemetry.lipSync.multiPersonDetected,
            sync_samples: request.telemetry.lipSync.syncSamples,
          } : undefined,
        },
        signature: Array.from(request.signature),
        public_key_pem: request.publicKeyPem,
      }),
    });

    if (!response.ok) {
      throw new Error(`Session verify failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    return {
      sessionId: data.session_id,
      verdict: data.verdict,
      confidenceScore: data.confidence_score,
      signalFlags: data.signal_flags,
      serverTimestamp: data.server_timestamp,
    };
  }

  private async fetchWithTimeout(
    url: string,
    options: RequestInit
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${this.config.timeoutMs}ms`);
      }
      throw error;
    }
  }
}
