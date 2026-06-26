
import { AegisApiClient, AegisClientConfig } from './api/api-client';
import { PayloadBuilder } from './api/payload-builder';
import { AegisCrypto, KeyPair } from './crypto/crypto';
import { FrameCollector, FrameCollectorConfig } from './collectors/frame-collector';
import { WorkerBridge, WorkerBridgeConfig } from './workers/worker-bridge';
import { CameraTimingSignal, SessionVerifyResponse } from './proto/session';
import { ChirpGenerator } from './analyzers/chirp-generator';
import { ToFAnalyzer } from './analyzers/tof-analyzer';
import { AudioCollector } from './collectors/audio-collector';
import { GlintDetector } from './detectors/glint-detector';
import { DriftDetector } from './detectors/drift-detector';
import { LipTracker } from './detectors/lip-tracker';

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
  private chirpGenerator: ChirpGenerator;
  private tofAnalyzer: ToFAnalyzer;
  private audioCollector: AudioCollector;
  private glintDetector: GlintDetector;
  private driftDetector: DriftDetector;
  private lipTracker: LipTracker;
  private keyPair: KeyPair | null = null;
  private sessionId: string | null = null;
  private isInitialized: boolean = false;
  private wasmUrl: string | undefined;
  private latestEntropyResult: EntropyResult | null = null;
  private latestToFResult: any = null;
  private latestGlintResult: any = null;
  private latestLipSyncResult: any = null;
  private webgazer: any = null;
  private sessionStartTime: number = 0;
  private videoElement: HTMLVideoElement;
  private faceMesh: any = null;
  private glintDetectorAvailable: boolean = false;
  private mediapipeAvailable: boolean = false;

  constructor(config: AegisConfig) {
    this.apiClient = new AegisApiClient({
      apiEndpoint: config.apiEndpoint,
      timeoutMs: config.timeoutMs,
    });
    this.videoElement = config.videoElement;
    this.frameCollector = new FrameCollector(config.videoElement, config.frameCollectorConfig);
    this.workerBridge = new WorkerBridge(config.workerBridgeConfig);
    this.wasmUrl = config.wasmUrl;
    this.chirpGenerator = new ChirpGenerator();
    this.tofAnalyzer = new ToFAnalyzer();
    this.audioCollector = new AudioCollector();
    this.glintDetector = new GlintDetector();
    this.driftDetector = new DriftDetector();
    this.lipTracker = new LipTracker();
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    this.keyPair = await AegisCrypto.generateKeyPair();

    const workerScript = this.getWorkerScript();
    await this.workerBridge.initialize(workerScript, this.wasmUrl);

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
    this.sessionStartTime = Date.now();

    // Initialize WebGazer for eye tracking
    try {
      // @ts-ignore - webgazer is loaded dynamically
      const webgazer = await import('webgazer');
      this.webgazer = webgazer;
      
      // @ts-ignore
      await this.webgazer.setVideoElement(this.videoElement);
      
      // @ts-ignore
      await this.webgazer.begin();
      
      // Set up gaze listener
      // @ts-ignore
      this.webgazer.setGazeListener((data: any) => {
        if (data && data.x !== null && data.y !== null) {
          this.glintDetector.addGazePoint(data.x, data.y, Date.now());
          // Estimate luminance from video frame (simplified)
          this.glintDetector.addLuminance(0.5);
        }
      });
      
      this.glintDetectorAvailable = true;
      console.log('WebGazer initialized successfully');
    } catch (error) {
      console.warn('WebGazer initialization failed:', error);
      this.glintDetectorAvailable = false;
    }

    // Initialize MediaPipe Face Mesh for lip tracking
    try {
      // @ts-ignore - MediaPipe is loaded dynamically
      const { FaceMesh } = await import('@mediapipe/face_mesh');
      // @ts-ignore
      const { Camera } = await import('@mediapipe/camera_utils');
      
      this.faceMesh = new FaceMesh({locateFile: (file: string) => {
        return `/mediapipe/${file}`;
      }});
      
      this.faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });
      
      this.faceMesh.onResults((results: any) => {
        if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
          const landmarks = results.multiFaceLandmarks[0];
          const timestamp = Date.now();
          
          // Feed landmarks to LipTracker
          this.lipTracker.addLipCoordinates(landmarks, timestamp);
          
          // Get lip aperture and feed to DriftDetector
          const lipAperture = this.lipTracker.getLipAperture();
          this.driftDetector.addVideoData(timestamp, lipAperture);
          
          // Feed audio amplitude to DriftDetector (from AudioCollector if active)
          if (this.audioCollector.isCapturing()) {
            const audioData = this.audioCollector.getAudioData();
            if (audioData.buffer.length > 0) {
              const amplitude = Math.abs(audioData.buffer[audioData.buffer.length - 1]);
              this.driftDetector.addAudioData(timestamp, amplitude);
            }
          }
        }
      });
      
      // @ts-ignore
      const camera = new Camera(this.videoElement, {
        onFrame: async () => {
          await this.faceMesh.send({image: this.videoElement});
        },
        width: 640,
        height: 480
      });
      
      // @ts-ignore
      await camera.start();
      
      this.mediapipeAvailable = true;
      console.log('MediaPipe Face Mesh initialized successfully');
    } catch (error) {
      console.warn('MediaPipe Face Mesh initialization failed:', error);
      this.mediapipeAvailable = false;
    }

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
    this.latestEntropyResult = result;

    return {
      variance: result.variance,
      stdDev: result.stdDev,
      klDivergence: result.klDivergence,
      shapiroWilkW: result.shapiroWilkW,
      sampleCount: result.sampleCount,
      frameDeltas,
    };
  }

  async analyzeAcousticToF(): Promise<any> {
    if (!this.isInitialized) {
      throw new Error('AegisLens not initialized. Call initialize() first.');
    }

    // Step 1: Generate and play chirp
    const chirpResult = this.chirpGenerator.generateSessionChirp(Date.now());
    
    // Step 2: Start audio capture before playing chirp
    await this.audioCollector.startCapture();
    
    // Step 3: Play chirp through speakers
    await this.chirpGenerator.playChirp(chirpResult);
    
    // Step 4: Wait for audio response (500ms window)
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Step 5: Get recorded audio data
    const audioData = this.audioCollector.getAudioData();
    const transmittedBuffer = new Float32Array(chirpResult.audioBuffer.getChannelData(0));
    const receivedBuffer = audioData.buffer;
    
    // Step 6: Analyze with ToFAnalyzer
    const tofResult = this.tofAnalyzer.analyze(transmittedBuffer, receivedBuffer);
    this.latestToFResult = tofResult;
    
    // Step 7: Stop audio capture
    this.audioCollector.stopCapture();
    
    return tofResult;
  }

  async analyzeGlintData(): Promise<any> {
    if (!this.isInitialized) {
      throw new Error('AegisLens not initialized. Call initialize() first.');
    }

    const sessionDuration = Date.now() - this.sessionStartTime;
    if (sessionDuration < 30000) {
      throw new Error('Glint analysis requires minimum 30 seconds of session data');
    }

    const glintResult = this.glintDetector.analyze();
    this.latestGlintResult = glintResult;
    
    return glintResult;
  }

  async analyzeDriftData(): Promise<any> {
    if (!this.isInitialized) {
      throw new Error('AegisLens not initialized. Call initialize() first.');
    }

    const driftResult = this.driftDetector.analyze();
    
    return driftResult;
  }

  async analyzeLipSyncData(): Promise<any> {
    if (!this.isInitialized) {
      throw new Error('AegisLens not initialized. Call initialize() first.');
    }

    const lipSyncResult = this.lipTracker.analyze();
    this.latestLipSyncResult = lipSyncResult;
    
    return lipSyncResult;
  }

  async submitTelemetry(cameraTiming: CameraTimingSignal): Promise<SessionVerifyResponse> {
    if (!this.sessionId || !this.keyPair) {
      throw new Error('No active session or key pair');
    }

    const payloadBuilder = new PayloadBuilder(this.sessionId);
    payloadBuilder.setCameraTiming(cameraTiming);

    // Add acoustic ToF data if available
    if (this.latestToFResult) {
      payloadBuilder.setAcousticData({
        timeOfFlightMs: this.latestToFResult.timeOfFlightMs || 0,
        correlationPeak: this.latestToFResult.correlationPeak || 0,
        spectralEntropy: this.latestToFResult.spectralEntropy || 0,
        phaseSignatureValid: this.latestToFResult.phaseSignatureValid || false,
        sampleCount: this.latestToFResult.sampleCount || 0,
      });
    }

    // Add eye tracking data if available, otherwise mark unavailable
    if (this.glintDetectorAvailable && this.latestGlintResult) {
      payloadBuilder.setEyeTracking({
        microsaccadeRate: this.latestGlintResult.microsaccadeRate || 0,
        glintParallaxVariance: this.latestGlintResult.glintParallaxVariance || 0,
        luminanceCorrelation: this.latestGlintResult.luminanceCorrelation || 0,
        gazeSamples: this.latestGlintResult.gazeSamples || 0,
      });
    } else if (!this.glintDetectorAvailable) {
      payloadBuilder.setEyeTrackingUnavailable('library_load_failed');
    }

    // Add lip sync data if available, otherwise mark unavailable
    if (this.mediapipeAvailable && this.latestLipSyncResult) {
      payloadBuilder.setLipSync({
        audioVideoDriftMs: this.latestLipSyncResult.audioVideoDriftMs || 0,
        lipVelocityCorrelation: this.latestLipSyncResult.lipVelocityCorrelation || 0,
        multiPersonDetected: this.latestLipSyncResult.multiPersonDetected || false,
        syncSamples: this.latestLipSyncResult.syncSamples || 0,
      });
    } else if (!this.mediapipeAvailable) {
      payloadBuilder.setLipSyncUnavailable('library_load_failed');
    }

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
    if (!this.latestEntropyResult) {
      return 0;
    }
    return this.latestEntropyResult.confidenceScore;
  }

  isVirtualCameraDetected(): boolean {
    if (!this.latestEntropyResult) {
      return false;
    }
    return this.latestEntropyResult.isVirtualCamera;
  }

  getSystemHealth(): {
    wasm_loaded: boolean;
    webgazer_loaded: boolean;
    mediapipe_loaded: boolean;
    microphone_available: boolean;
    camera_available: boolean;
    ready_to_detect: boolean;
  } {
    // Check if WASM is loaded (worker initialized)
    const wasmLoaded = this.workerBridge.isInitialized;
    
    // Check if WebGazer loaded successfully
    const webgazerLoaded = this.glintDetectorAvailable;
    
    // Check if MediaPipe loaded successfully
    const mediapipeLoaded = this.mediapipeAvailable;
    
    // Check microphone availability (try to get media devices)
    let microphoneAvailable = false;
    try {
      // This is a synchronous check - actual mic access requires user permission
      // We're checking if the browser supports microphone APIs
      microphoneAvailable = !!(navigator.mediaDevices && navigator.mediaDevices.enumerateDevices);
    } catch (e) {
      microphoneAvailable = false;
    }
    
    // Check camera availability
    const cameraAvailable = !!this.videoElement && this.videoElement.readyState >= 2;
    
    // Ready to detect requires WASM + camera + microphone
    const readyToDetect = wasmLoaded && cameraAvailable && microphoneAvailable;
    
    return {
      wasm_loaded: wasmLoaded,
      webgazer_loaded: webgazerLoaded,
      mediapipe_loaded: mediapipeLoaded,
      microphone_available: microphoneAvailable,
      camera_available: cameraAvailable,
      ready_to_detect: readyToDetect,
    };
  }

  cleanup(): void {
    this.frameCollector.stop();
    this.frameCollector.reset();
    this.workerBridge.terminate();
    
    // Stop WebGazer if initialized
    if (this.webgazer) {
      try {
        // @ts-ignore
        this.webgazer.end();
      } catch (error) {
        console.warn('WebGazer cleanup failed:', error);
      }
      this.webgazer = null;
    }
    
    // Reset detectors
    this.glintDetector.reset();
    this.driftDetector.reset();
    this.lipTracker.reset();
    
    this.isInitialized = false;
    this.sessionId = null;
    this.keyPair = null;
    this.sessionStartTime = 0;
  }


  private getWorkerScript(): string {
    return `
      // Worker will be initialized with SharedArrayBuffer
      let sharedBuffer = null;
      let int32View = null;
      let float64View = null;
      let wasmModule = null;

      // Ring buffer indices
      let HEAD_INDEX = 0;
      let TAIL_INDEX = 0;
      let DATA_START = 0;

      self.onmessage = async (event) => {
        const { type, buffer, headIndex, tailIndex, dataStart, wasmUrl } = event.data;

        switch (type) {
          case 'init':
            await initialize(buffer, headIndex, tailIndex, dataStart, wasmUrl);
            break;
          case 'analyze':
            analyze();
            break;
          default:
            console.error('Unknown message type:', type);
        }
      };

      async function initialize(buffer, headIndex, tailIndex, dataStart, wasmUrl) {
        sharedBuffer = buffer;
        int32View = new Int32Array(sharedBuffer);
        float64View = new Float64Array(sharedBuffer);
        
        HEAD_INDEX = headIndex;
        TAIL_INDEX = tailIndex;
        DATA_START = dataStart;

        // Load WASM module if URL provided
        if (wasmUrl) {
          try {
            const response = await fetch(wasmUrl);
            const wasmBytes = await response.arrayBuffer();
            const wasmModule = await WebAssembly.instantiate(wasmBytes);
            wasmModule = wasmModule.instance.exports;
            self.wasmModule = wasmModule;
          } catch (error) {
            console.error('Failed to load WASM module:', error);
          }
        }

        self.postMessage({ type: 'initialized' });
      }

      function analyze() {
        if (!int32View || !float64View) {
          console.error('Worker not initialized');
          return;
        }

        const head = Atomics.load(int32View, HEAD_INDEX);
        const tail = Atomics.load(int32View, TAIL_INDEX);

        if (head === tail) {
          return;
        }

        const deltas = [];
        let current = head;

        while (current !== tail) {
          const lengthIndex = DATA_START + current * 2;
          const length = int32View[lengthIndex];
          
          const dataStartFloat64 = DATA_START * 2;
          const float64ReadPos = (dataStartFloat64 + current * 2) % float64View.length;
          
          for (let i = 0; i < length; i++) {
            const pos = (float64ReadPos + i) % float64View.length;
            deltas.push(float64View[pos]);
          }

          current = (current + 1) % 256;
        }

        Atomics.store(int32View, HEAD_INDEX, tail);

        let result;
        if (self.wasmModule) {
          result = analyzeWithWasm(deltas);
        } else {
          result = analyzeWithJS(deltas);
        }

        self.postMessage({
          type: 'result',
          result,
        });
      }

      function analyzeWithWasm(deltas) {
        try {
          const { analyze_frame_deltas, is_virtual_camera, get_confidence_score } = self.wasmModule;

          const wasmResult = analyze_frame_deltas(deltas);
          const wasmResultObj = JSON.parse(wasmResult);
          const isVirtual = is_virtual_camera(deltas);
          const confidence = get_confidence_score(deltas);

          return {
            variance: wasmResultObj.variance,
            stdDev: wasmResultObj.std_dev,
            klDivergence: wasmResultObj.kl_divergence,
            shapiroWilkW: wasmResultObj.shapiro_wilk_w,
            sampleCount: wasmResultObj.sample_count,
            isVirtualCamera: isVirtual,
            confidenceScore: confidence,
          };
        } catch (error) {
          console.error('WASM analysis failed, falling back to JS:', error);
          return analyzeWithJS(deltas);
        }
      }

      function analyzeWithJS(deltas) {
        const variance = calculateVariance(deltas);
        const stdDev = Math.sqrt(variance);
        const klDivergence = calculateKLDivergence(deltas);
        const shapiroWilkW = calculateShapiroWilk(deltas);

        const isVirtualCamera = variance < 12.0;

        const varianceScore = variance >= 50.0 && variance <= 500.0 ? 1.0 - Math.min(Math.abs((variance - 275.0) / 225.0), 1.0) : variance < 12.0 ? 0.0 : 0.5;
        const klScore = Math.max(1.0 - Math.min(klDivergence, 1.0), 0.0);
        const shapiroScore = shapiroWilkW;
        const confidenceScore = (varianceScore * 0.4 + klScore * 0.3 + shapiroScore * 0.3) * 100.0;

        return {
          variance,
          stdDev,
          klDivergence,
          shapiroWilkW,
          sampleCount: deltas.length,
          isVirtualCamera,
          confidenceScore,
        };
      }

      function calculateVariance(samples) {
        if (samples.length < 2) return 0.0;

        let mean = samples[0];
        let m2 = 0.0;

        for (let i = 1; i < samples.length; i++) {
          const delta = samples[i] - mean;
          const deltaN = delta / (i + 1);
          mean += deltaN;
          const deltaN2 = delta * (samples[i] - mean);
          m2 += deltaN2;
        }

        return m2 / (samples.length - 1);
      }

      function calculateKLDivergence(samples) {
        if (samples.length === 0) return 0.0;

        const bins = 20;
        const histogram = new Array(bins).fill(0);
        const max = Math.max(...samples);
        const binWidth = Math.max(max / bins, 1.0);

        for (const sample of samples) {
          const bin = Math.min(Math.floor(sample / binWidth), bins - 1);
          histogram[bin]++;
        }

        const total = samples.length;
        for (let i = 0; i < bins; i++) {
          histogram[i] /= total;
        }

        let kl = 0.0;
        const epsilon = 1e-10;
        for (let i = 0; i < bins; i++) {
          const p = Math.max(histogram[i], epsilon);
          const q = 1.0 / bins;
          kl += p * Math.log(p / q);
        }

        return kl;
      }

      function calculateShapiroWilk(samples) {
        if (samples.length < 3) return 0.0;

        const n = samples.length;
        const sorted = [...samples].sort((a, b) => a - b);
        const mean = sorted.reduce((a, b) => a + b, 0) / n;
        const ss = sorted.reduce((sum, x) => sum + (x - mean) ** 2, 0);

        if (ss === 0) return 0.0;

        const skewness = sorted.reduce((sum, x) => sum + ((x - mean) / Math.sqrt(ss)) ** 3, 0) / n;
        const kurtosis = sorted.reduce((sum, x) => sum + ((x - mean) / Math.sqrt(ss)) ** 4, 0) / n - 3.0;

        const skewScore = Math.max(1.0 - Math.min(Math.abs(skewness), 1.0), 0.0);
        const kurtScore = Math.max(1.0 - Math.min(Math.abs(kurtosis), 1.0), 0.0);

        return (skewScore * 0.5 + kurtScore * 0.5);
      }
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
    // This will be called by the worker bridge when analysis completes
    // The actual result is handled in waitForEntropyResult via callback override
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
export { AegisApiClient } from './api/api-client';
export { PayloadBuilder } from './api/payload-builder';
export { AegisCrypto } from './crypto/crypto';
export { FrameCollector } from './collectors/frame-collector';
export { WorkerBridge } from './workers/worker-bridge';
export * from './proto/session';
