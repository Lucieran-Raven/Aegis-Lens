/**
 * Aegis Lens v2.0 - Main SDK Entry Point
 * Hardware-layer digital truth validation platform
 * Zero-PII architecture - all biometrics processed client-side
 */

import { AegisApiClient, AegisClientConfig } from './api-client';
import { PayloadBuilder } from './payload-builder';
import { AegisCrypto, KeyPair } from './crypto';
import { FrameCollector, FrameCollectorConfig } from './frame-collector';
import { WorkerBridge, WorkerBridgeConfig } from './worker-bridge';
import { CameraTimingSignal } from './proto/session';

export interface AegisConfig extends AegisClientConfig {
  videoElement: HTMLVideoElement;
  wasmUrl?: string; // Optional WASM module URL
  frameCollectorConfig?: FrameCollectorConfig;
  workerBridgeConfig?: WorkerBridgeConfig;
}

export interface EntropyResult {
  variance: number;
  stdDev: number;
  klDivergence: number;
  shapiroWilkW: number;
  sampleCount: number;
  isVirtualCamera: boolean;
  confidenceScore: number;
}

export class AegisLens {
  private apiClient: AegisApiClient;
  private frameCollector: FrameCollector;
  private workerBridge: WorkerBridge;
  private keyPair: KeyPair | null = null;
  private sessionId: string | null = null;
  private isInitialized: boolean = false;

  constructor(config: AegisConfig) {
    this.apiClient = new AegisApiClient({
      apiEndpoint: config.apiEndpoint,
      timeoutMs: config.timeoutMs,
    });
    this.frameCollector = new FrameCollector(config.videoElement, config.frameCollectorConfig);
    this.workerBridge = new WorkerBridge(config.workerBridgeConfig);
  }

  /**
   * Initialize the SDK
   * - Generate ephemeral key pair
   * - Initialize session with server
   * - Set up Web Worker
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    // Generate ephemeral ECDSA P-256 key pair
    this.keyPair = await AegisCrypto.generateKeyPair();

    // Initialize Web Worker with entropy analysis script
    const workerScript = this.getWorkerScript();
    await this.workerBridge.initialize(workerScript);

    // Set up result callback
    this.workerBridge.onResult((result: EntropyResult) => {
      this.handleEntropyResult(result);
    });

    this.isInitialized = true;
  }

  /**
   * Start a new verification session
   */
  async startSession(): Promise<string> {
    if (!this.isInitialized) {
      throw new Error('AegisLens not initialized. Call initialize() first.');
    }

    const clientId = this.generateClientId();
    const deviceFingerprint = this.generateDeviceFingerprint();

    const sessionInit = await this.apiClient.initSession({
      clientId,
      deviceFingerprint,
      userAgent: navigator.userAgent,
      timestamp: Date.now(),
    });

    this.sessionId = sessionInit.sessionId;

    return this.sessionId;
  }

  /**
   * Analyze camera timing entropy (Signal A)
   */
  async analyzeCameraTiming(): Promise<CameraTimingSignal> {
    if (!this.isInitialized) {
      throw new Error('AegisLens not initialized. Call initialize() first.');
    }

    // Start frame collection
    this.frameCollector.start();

    // Wait for collection to complete
    await this.waitForFrameCollection();

    // Get frame deltas
    const frameDeltas = this.frameCollector.getFrameDeltas();

    // Write to worker bridge for analysis
    this.workerBridge.writeFrameDeltas(frameDeltas);
    this.workerBridge.triggerAnalysis();

    // Wait for analysis result
    const result = await this.waitForEntropyResult();

    return {
      variance: result.variance,
      stdDev: result.stdDev,
      klDivergence: result.klDivergence,
      shapiroWilkW: result.shapiroWilkW,
      sampleCount: result.sampleCount,
      frameDeltas,
    };
  }

  /**
   * Build and submit telemetry payload for verification
   */
  async submitTelemetry(cameraTiming: CameraTimingSignal): Promise<any> {
    if (!this.sessionId || !this.keyPair) {
      throw new Error('No active session or key pair');
    }

    // Build payload
    const payloadBuilder = new PayloadBuilder(this.sessionId);
    payloadBuilder.setCameraTiming(cameraTiming);
    const telemetry = payloadBuilder.build();

    // Serialize and sign
    const telemetryBytes = new TextEncoder().encode(JSON.stringify(telemetry));
    const signature = await AegisCrypto.signPayload(this.keyPair.privateKey, telemetryBytes);

    // Submit to server
    const verifyRequest = {
      telemetry,
      signature,
      publicKeyPem: this.keyPair.publicKeyPem,
    };

    return await this.apiClient.verifySession(verifyRequest);
  }

  /**
   * Get confidence score for current analysis
   */
  getConfidenceScore(): number {
    // This would be updated by the worker callback
    return 0;
  }

  /**
   * Check if virtual camera is detected
   */
  isVirtualCameraDetected(): boolean {
    // This would be updated by the worker callback
    return false;
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.frameCollector.stop();
    this.frameCollector.reset();
    this.workerBridge.terminate();
    this.isInitialized = false;
    this.sessionId = null;
    this.keyPair = null;
  }

  // Private helper methods

  private getWorkerScript(): string {
    // Return the entropy worker script as a string
    // In production, this would be loaded from a separate file
    return `
      // Web Worker script will be loaded from entropy.worker.ts
      // For now, this is a placeholder
      self.onmessage = (event) => {
        if (event.data.type === 'analyze') {
          // Process analysis
          self.postMessage({ type: 'result', result: {} });
        }
      };
    `;
  }

  private async waitForFrameCollection(): Promise<void> {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.frameCollector.isComplete()) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    });
  }

  private async waitForEntropyResult(): Promise<EntropyResult> {
    return new Promise((resolve) => {
      const originalCallback = this.workerBridge.onResult;
      this.workerBridge.onResult((result: EntropyResult) => {
        this.workerBridge.onResult = originalCallback;
        resolve(result);
      });
    });
  }

  private handleEntropyResult(result: EntropyResult): void {
    // Store result for later retrieval
    if (process.env.NODE_ENV === 'development') {
      console.log('Entropy analysis result:', result);
    }
  }

  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateDeviceFingerprint(): string {
    // Simple fingerprint based on available browser features
    const features = [
      navigator.userAgent,
      navigator.language,
      screen.width,
      screen.height,
      navigator.hardwareConcurrency || 0,
    ];
    return btoa(features.join('|'));
  }
}

// Export all public types and classes
export { AegisApiClient } from './api-client';
export { PayloadBuilder } from './payload-builder';
export { AegisCrypto } from './crypto';
export { FrameCollector } from './frame-collector';
export { WorkerBridge } from './worker-bridge';
export * from './proto/session';
