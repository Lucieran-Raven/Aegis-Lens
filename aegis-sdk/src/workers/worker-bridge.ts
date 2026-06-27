/**
 * Aegis Lens v2.0 - Worker Bridge
 * Implements lock-free SharedArrayBuffer ring buffer for background execution
 * Passes frame delta arrays to Web Worker for WASM processing
 */

import { EntropyResult } from '../index';

export interface WorkerBridgeConfig {
  bufferSize?: number; // Size of SharedArrayBuffer in bytes (default: 65536)
  ringSize?: number; // Number of slots in ring buffer (default: 256)
}

export class WorkerBridge {
  private config: WorkerBridgeConfig;
  private sharedBuffer: SharedArrayBuffer | null = null;
  private int32View: Int32Array | null = null;
  private worker: Worker | null = null;
  public isInitialized: boolean = false;
  private onResultCallback: ((result: EntropyResult) => void) | null = null;

  private readonly HEAD_INDEX = 0;
  private readonly TAIL_INDEX = 1;
  private readonly DATA_START = 2;

  constructor(config: WorkerBridgeConfig = {}) {
    this.config = {
      bufferSize: 65536,
      ringSize: 256,
      ...config,
    };
  }

  async initialize(workerScript: string, wasmUrl?: string): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    if (typeof SharedArrayBuffer === 'undefined') {
      throw new Error(
        'SharedArrayBuffer is not available. ' +
        'Ensure COOP and COEP headers are set: ' +
        'Cross-Origin-Opener-Policy: same-origin, ' +
        'Cross-Origin-Embedder-Policy: require-corp'
      );
    }

    this.sharedBuffer = new SharedArrayBuffer(this.config.bufferSize!);
    this.int32View = new Int32Array(this.sharedBuffer);

    this.int32View[this.HEAD_INDEX] = 0;
    this.int32View[this.TAIL_INDEX] = 0;

    const blob = new Blob([workerScript], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    this.worker = new Worker(workerUrl);

    this.worker.onmessage = this.handleWorkerMessage.bind(this);

    this.worker.postMessage({
      type: 'init',
      buffer: this.sharedBuffer,
      headIndex: this.HEAD_INDEX,
      tailIndex: this.TAIL_INDEX,
      dataStart: this.DATA_START,
      wasmUrl: wasmUrl,
    });

    this.isInitialized = true;
  }

  private handleWorkerMessage(event: MessageEvent): void {
    const { type, result } = event.data;

    if (type === 'result' && this.onResultCallback) {
      this.onResultCallback(result);
    }
  }

  onResult(callback: (result: EntropyResult) => void): void {
    this.onResultCallback = callback;
  }

  writeFrameDeltas(deltas: number[]): boolean {
    if (!this.int32View || !this.worker) {
      throw new Error('WorkerBridge not initialized');
    }

    const ringSize = this.config.ringSize!;
    const required = Math.ceil((deltas.length * 8) / 4);

    let success = false;
    let reservedTail = 0;
    let attempts = 0;
    const maxAttempts = 1000;

    while (!success && attempts < maxAttempts) {
      attempts++;

      const head = Atomics.load(this.int32View, this.HEAD_INDEX);
      const currentTail = Atomics.load(this.int32View, this.TAIL_INDEX);

      const available = (currentTail - head + ringSize) % ringSize;
      if (available < required + 1) {
        return false;
      }

      const newTail = (currentTail + 1) % ringSize;

      const casResult = Atomics.compareExchange(
        this.int32View,
        this.TAIL_INDEX,
        currentTail,
        newTail
      );

      if (casResult === currentTail) {
        success = true;
        reservedTail = currentTail;
      }
    }

    if (!success) {
        return false;
    }

    this.int32View[this.DATA_START + reservedTail * 2] = deltas.length;

    const float64View = new Float64Array(this.sharedBuffer!);
    const dataStartFloat64 = this.DATA_START * 2;
    const float64WritePos = (dataStartFloat64 + reservedTail * 2) % float64View.length;
    
    for (let i = 0; i < deltas.length; i++) {
      const pos = (float64WritePos + i) % float64View.length;
      float64View[pos] = deltas[i];
    }

    Atomics.notify(this.int32View, this.TAIL_INDEX, 1);

    return true;
  }

  triggerAnalysis(): void {
    if (!this.worker) {
      throw new Error('WorkerBridge not initialized');
    }

    this.worker.postMessage({ type: 'analyze' });
  }

  getStats(): {
    head: number;
    tail: number;
    available: number;
    isInitialized: boolean;
  } {
    if (!this.int32View) {
      return { head: 0, tail: 0, available: 0, isInitialized: false };
    }

    const head = Atomics.load(this.int32View, this.HEAD_INDEX);
    const tail = Atomics.load(this.int32View, this.TAIL_INDEX);
    const ringSize = this.config.ringSize!;
    const available = (tail - head + ringSize) % ringSize;

    return {
      head,
      tail,
      available,
      isInitialized: this.isInitialized,
    };
  }

  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    this.sharedBuffer = null;
    this.int32View = null;
    this.isInitialized = false;
    this.onResultCallback = null;
  }
}
