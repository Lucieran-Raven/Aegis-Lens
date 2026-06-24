/**
 * Aegis Lens v2.0 - Frame Collector
 * Manages requestVideoFrameCallback loop to track exact hardware delivery times
 * Captures frame timing entropy for virtual camera detection
 */

export interface FrameTimingData {
  timestamp: number; // High-resolution timestamp in microseconds
  frameIndex: number;
}

export interface FrameCollectorConfig {
  maxSamples?: number; // Maximum number of frame deltas to collect (default: 89)
  sampleIntervalMs?: number; // Minimum interval between samples (default: 16ms ~ 60fps)
}

export class FrameCollector {
  private videoElement: HTMLVideoElement;
  private config: FrameCollectorConfig;
  private frameTimings: FrameTimingData[] = [];
  private isCollecting: boolean = false;
  private animationFrameId: number | null = null;
  private lastTimestamp: number | null = null;
  private frameDeltas: number[] = [];

  constructor(videoElement: HTMLVideoElement, config: FrameCollectorConfig = {}) {
    this.videoElement = videoElement;
    this.config = {
      maxSamples: 89,
      sampleIntervalMs: 16,
      ...config,
    };
  }

  /**
   * Start collecting frame timing data
   */
  start(): void {
    if (this.isCollecting) {
      return;
    }

    this.isCollecting = true;
    this.frameTimings = [];
    this.frameDeltas = [];
    this.lastTimestamp = null;

    this.collectFrame();
  }

  /**
   * Stop collecting frame timing data
   */
  stop(): void {
    this.isCollecting = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Collect a single frame timestamp using requestVideoFrameCallback
   */
  private collectFrame(): void {
    if (!this.isCollecting || this.frameTimings.length >= this.config.maxSamples!) {
      this.stop();
      return;
    }

    // Use requestVideoFrameCallback for hardware-level timing
    if ('requestVideoFrameCallback' in this.videoElement) {
      (this.videoElement as any).requestVideoFrameCallback(
        this.handleVideoFrameCallback.bind(this)
      );
    } else {
      // Fallback to requestAnimationFrame for browsers without support
      this.animationFrameId = requestAnimationFrame(
        this.handleAnimationFrame.bind(this)
      );
    }
  }

  /**
   * Handle requestVideoFrameCallback callback
   */
  private handleVideoFrameCallback(
    _now: number,
    metadata: any
  ): void {
    if (!this.isCollecting) {
      return;
    }

    // Use presentationTime for hardware delivery time (in microseconds)
    const timestamp = (metadata.presentationTime || metadata.mediaTime || performance.now()) * 1000; // Convert to microseconds
    const frameIndex = this.frameTimings.length;

    this.frameTimings.push({ timestamp, frameIndex });

    // Calculate delta from previous frame
    if (this.lastTimestamp !== null) {
      const delta = timestamp - this.lastTimestamp;
      this.frameDeltas.push(delta);
    }

    this.lastTimestamp = timestamp;

    // Schedule next collection
    setTimeout(() => this.collectFrame(), this.config.sampleIntervalMs);
  }

  /**
   * Handle requestAnimationFrame fallback
   */
  private handleAnimationFrame(timestamp: number): void {
    if (!this.isCollecting) {
      return;
    }

    // Use performance.now() for high-resolution timing (in microseconds)
    const timestampUs = timestamp * 1000;
    const frameIndex = this.frameTimings.length;

    this.frameTimings.push({ timestamp: timestampUs, frameIndex });

    // Calculate delta from previous frame
    if (this.lastTimestamp !== null) {
      const delta = timestampUs - this.lastTimestamp;
      this.frameDeltas.push(delta);
    }

    this.lastTimestamp = timestampUs;

    // Schedule next collection
    setTimeout(() => this.collectFrame(), this.config.sampleIntervalMs);
  }

  /**
   * Get the collected frame deltas (inter-arrival times in microseconds)
   */
  getFrameDeltas(): number[] {
    return [...this.frameDeltas];
  }

  /**
   * Get the collected frame timings
   */
  getFrameTimings(): FrameTimingData[] {
    return [...this.frameTimings];
  }

  /**
   * Check if collection is complete
   */
  isComplete(): boolean {
    return this.frameTimings.length >= this.config.maxSamples!;
  }

  /**
   * Reset the collector
   */
  reset(): void {
    this.stop();
    this.frameTimings = [];
    this.frameDeltas = [];
    this.lastTimestamp = null;
  }

  /**
   * Get collection statistics
   */
  getStats(): {
    totalFrames: number;
    totalDeltas: number;
    isCollecting: boolean;
  } {
    return {
      totalFrames: this.frameTimings.length,
      totalDeltas: this.frameDeltas.length,
      isCollecting: this.isCollecting,
    };
  }
}
