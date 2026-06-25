
import { AegisApiClient, AegisClientConfig } from './api-client';
import { PayloadBuilder } from './payload-builder';
import { AegisCrypto, KeyPair } from './crypto';
import { FrameCollector, FrameCollectorConfig } from './frame-collector';
import { WorkerBridge, WorkerBridgeConfig } from './worker-bridge';
import { CameraTimingSignal, SessionVerifyResponse } from './proto/session';

export interface AegisConfig extends AegisClientConfig {
  videoElement: HTMLVideoElement;
  wasmUrl?: string;
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

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    this.keyPair = await AegisCrypto.generateKeyPair();

    const workerScript = this.getWorkerScript();
    await this.workerBridge.initialize(workerScript);

    this.workerBridge.onResult(() => {
      this.handleEntropyResult();
    });

    this.isInitialized = true;
  }

  async startSession(): Promise<string> {
    if (!this.isInitialized) {
      throw new Error('AegisLens not initialized. Call initialize() first.');
    }

    const clientId = this.generateClientId();
    const deviceFingerprint = await this.generateDeviceFingerprint();

    const sessionInit = await this.apiClient.initSession({
      clientId,
      deviceFingerprint,
      userAgent: navigator.userAgent,
      timestamp: Date.now(),
    });

    this.sessionId = sessionInit.sessionId;

    return this.sessionId;
  }

  async analyzeCameraTiming(): Promise<CameraTimingSignal> {
    if (!this.isInitialized) {
      throw new Error('AegisLens not initialized. Call initialize() first.');
    }

    this.frameCollector.start();

    await this.waitForFrameCollection();

    const frameDeltas = this.frameCollector.getFrameDeltas();

    this.workerBridge.writeFrameDeltas(frameDeltas);
    this.workerBridge.triggerAnalysis();

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

  async submitTelemetry(cameraTiming: CameraTimingSignal): Promise<SessionVerifyResponse> {
    if (!this.sessionId || !this.keyPair) {
      throw new Error('No active session or key pair');
    }

    const payloadBuilder = new PayloadBuilder(this.sessionId);
    payloadBuilder.setCameraTiming(cameraTiming);
    const telemetry = payloadBuilder.build();

    const telemetryBytes = new TextEncoder().encode(JSON.stringify(telemetry));
    const signature = await AegisCrypto.signPayload(this.keyPair.privateKey, telemetryBytes);

    const verifyRequest = {
      telemetry,
      signature,
      publicKeyPem: this.keyPair.publicKeyPem,
    };

    return await this.apiClient.verifySession(verifyRequest);
  }

  getConfidenceScore(): number {
    return 0;
  }

  isVirtualCameraDetected(): boolean {
    return false;
  }

  cleanup(): void {
    this.frameCollector.stop();
    this.frameCollector.reset();
    this.workerBridge.terminate();
    this.isInitialized = false;
    this.sessionId = null;
    this.keyPair = null;
  }


  private getWorkerScript(): string {
    return `
      self.onmessage = (event) => {
        if (event.data.type === 'analyze') {
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

  private handleEntropyResult(): void {
  }

  private generateClientId(): string {
    const randomBytes = new Uint8Array(4);
    window.crypto.getRandomValues(randomBytes);
    const randomHex = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    return `client_${Date.now()}_${randomHex}`;
  }

  private async generateDeviceFingerprint(): Promise<string> {
    const features = [
      navigator.userAgent,
      navigator.language,
      screen.width,
      screen.height,
      navigator.hardwareConcurrency || 0,
    ];
    const featureString = features.join('|');
    const encoder = new TextEncoder();
    const data = encoder.encode(featureString);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex.substring(0, 32);
  }
}

// Export all public types and classes
export { AegisApiClient } from './api-client';
export { PayloadBuilder } from './payload-builder';
export { AegisCrypto } from './crypto';
export { FrameCollector } from './frame-collector';
export { WorkerBridge } from './worker-bridge';
export * from './proto/session';
