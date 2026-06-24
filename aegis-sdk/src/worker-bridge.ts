/**
 * Aegis Lens v2.0 - Worker Bridge
 * Implements lock-free SharedArrayBuffer ring buffer for background execution
 * Passes frame delta arrays to Web Worker for WASM processing
 */

import { EntropyResult } from './index';

export interface WorkerBridgeConfig {
  bufferSize?: number; // Size of SharedArrayBuffer in bytes (default: 65536)
  ringSize?: number; // Number of slots in ring buffer (default: 256)
}

export class WorkerBridge {
  private config: WorkerBridgeConfig;
  private sharedBuffer: SharedArrayBuffer | null = null;
  private int32View: Int32Array | null = null;
  private worker: Worker | null = null;
  private isInitialized: boolean = false;
  private onResultCallback: ((result: EntropyResult) => void) | null = null;

  // Ring buffer indices (stored in first 4 Int32 slots)
  private readonly HEAD_INDEX = 0;
  private readonly TAIL_INDEX = 1;
  private readonly DATA_START = 2;

  constructor(config: WorkerBridgeConfig = {}) {
    this.config = {
      bufferSize: 65536, // 64KB
      ringSize: 256,
      ...config,
    };
  }

  /**
   * Initialize the SharedArrayBuffer and Web Worker
   */
  async initialize(workerScript: string): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    // Check if SharedArrayBuffer is available
    if (typeof SharedArrayBuffer === 'undefined') {
      throw new Error(
        'SharedArrayBuffer is not available. ' +
        'Ensure COOP and COEP headers are set: ' +
        'Cross-Origin-Opener-Policy: same-origin, ' +
        'Cross-Origin-Embedder-Policy: require-corp'
      );
    }

    // Create SharedArrayBuffer
    this.sharedBuffer = new SharedArrayBuffer(this.config.bufferSize!);
    this.int32View = new Int32Array(this.sharedBuffer);

    // Initialize ring buffer indices
    this.int32View[this.HEAD_INDEX] = 0;
    this.int32View[this.TAIL_INDEX] = 0;

    // Create Web Worker
    const blob = new Blob([workerScript], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    this.worker = new Worker(workerUrl);

    // Set up message handler
    this.worker.onmessage = this.handleWorkerMessage.bind(this);

    // Send buffer to worker
    this.worker.postMessage({
      type: 'init',
      buffer: this.sharedBuffer,
      headIndex: this.HEAD_INDEX,
      tailIndex: this.TAIL_INDEX,
      dataStart: this.DATA_START,
    }, [this.sharedBuffer]);

    this.isInitialized = true;
  }

  /**
   * Handle messages from the Web Worker
   */
  private handleWorkerMessage(event: MessageEvent): void {
    const { type, result } = event.data;

    if (type === 'result' && this.onResultCallback) {
      this.onResultCallback(result);
    }
  }

  /**
   * Set callback for processing results from worker
   */
  onResult(callback: (result: EntropyResult) => void): void {
    this.onResultCallback = callback;
  }

  /**
   * Write frame deltas to the ring buffer
   * CRITICAL FIX: Lock-free implementation using atomic Compare-And-Swap (CAS) loop to prevent race conditions (H3)
   * This ensures thread-safe reservation of buffer slots before writing data
   */
  writeFrameDeltas(deltas: number[]): boolean {
    if (!this.int32View || !this.worker) {
      throw new Error('WorkerBridge not initialized');
    }

    const ringSize = this.config.ringSize!;
    const required = Math.ceil((deltas.length * 8) / 4); // 8 bytes per double, 4 bytes per Int32

    // Atomic Compare-And-Swap loop to reserve buffer slot
    let success = false;
    let reservedTail = 0;
    let attempts = 0;
    const maxAttempts = 1000; // Prevent infinite loops

    while (!success && attempts < maxAttempts) {
      attempts++;

      // Load current head and tail atomically
      const head = Atomics.load(this.int32View, this.HEAD_INDEX);
      const currentTail = Atomics.load(this.int32View, this.TAIL_INDEX);

      // Check if ring buffer has space
      const available = (currentTail - head + ringSize) % ringSize;
      if (available < required + 1) {
        // Buffer full, cannot write
        return false;
      }

      // Calculate new tail position
      const newTail = (currentTail + 1) % ringSize;

      // Attempt to atomically reserve the slot using Compare-And-Swap
      // This only succeeds if the tail hasn't changed since we read it
      const casResult = Atomics.compareExchange(
        this.int32View,
        this.TAIL_INDEX,
        currentTail,
        newTail
      );

      if (casResult === currentTail) {
        // CAS succeeded - we have reserved the slot
        success = true;
        reservedTail = currentTail;
      }
      // If CAS failed, loop back and retry with updated tail value
    }

    if (!success) {
      // Failed to reserve slot after max attempts (high contention)
      return false;
    }

    // Write data to buffer (slot is now reserved)
    
    // Write length first
    this.int32View[this.DATA_START + reservedTail * 2] = deltas.length;

    // Write deltas as Float64 (using two Int32 slots per double)
    const float64View = new Float64Array(this.sharedBuffer!);
    const dataStartFloat64 = this.DATA_START * 2; // Each Int32 is 4 bytes, Float64 is 8 bytes
    const float64WritePos = (dataStartFloat64 + reservedTail * 2) % float64View.length;
    
    for (let i = 0; i < deltas.length; i++) {
      const pos = (float64WritePos + i) % float64View.length;
      float64View[pos] = deltas[i];
    }

    // Notify worker that new data is available
    Atomics.notify(this.int32View, this.TAIL_INDEX, 1);

    return true;
  }

  /**
   * Notify worker to process available data
   */
  triggerAnalysis(): void {
    if (!this.worker) {
      throw new Error('WorkerBridge not initialized');
    }

    this.worker.postMessage({ type: 'analyze' });
  }

  /**
   * Get buffer statistics
   */
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

  /**
   * Terminate the worker and cleanup
   */
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
