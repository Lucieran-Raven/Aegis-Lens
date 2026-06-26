
export interface FrameTimingData {
  timestamp: number;
  frameIndex: number;
}

export interface FrameCollectorConfig {
  maxSamples?: number;
  sampleIntervalMs?: number;
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

  stop(): void {
    this.isCollecting = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private collectFrame(): void {
    if (!this.isCollecting || this.frameTimings.length >= this.config.maxSamples!) {
      this.stop();
      return;
    }

    if ('requestVideoFrameCallback' in this.videoElement) {
      (this.videoElement as HTMLVideoElement & { requestVideoFrameCallback: (cb: (now: number, metadata: Record<string, unknown>) => void) => void }).requestVideoFrameCallback(
        this.handleVideoFrameCallback.bind(this)
      );
    } else {
      this.animationFrameId = requestAnimationFrame(
        this.handleAnimationFrame.bind(this)
      );
    }
  }

  private handleVideoFrameCallback(
    _now: number,
    metadata: Record<string, unknown>
  ): void {
    if (!this.isCollecting) {
      return;
    }

    const presentationTime = metadata.presentationTime as number | undefined;
    const mediaTime = metadata.mediaTime as number | undefined;
    const timestamp = (presentationTime || mediaTime || performance.now()) * 1000;
    const frameIndex = this.frameTimings.length;

    this.frameTimings.push({ timestamp, frameIndex });

    if (this.lastTimestamp !== null) {
      const delta = timestamp - this.lastTimestamp;
      this.frameDeltas.push(delta);
    }

    this.lastTimestamp = timestamp;

    setTimeout(() => this.collectFrame(), this.config.sampleIntervalMs);
  }

  private handleAnimationFrame(timestamp: number): void {
    if (!this.isCollecting) {
      return;
    }

    const timestampUs = timestamp * 1000;
    const frameIndex = this.frameTimings.length;

    this.frameTimings.push({ timestamp: timestampUs, frameIndex });

    if (this.lastTimestamp !== null) {
      const delta = timestampUs - this.lastTimestamp;
      this.frameDeltas.push(delta);
    }

    this.lastTimestamp = timestampUs;

    setTimeout(() => this.collectFrame(), this.config.sampleIntervalMs);
  }

  getFrameDeltas(): number[] {
    return [...this.frameDeltas];
  }

  getFrameTimings(): FrameTimingData[] {
    return [...this.frameTimings];
  }

  isComplete(): boolean {
    return this.frameTimings.length >= this.config.maxSamples!;
  }

  reset(): void {
    this.stop();
    this.frameTimings = [];
    this.frameDeltas = [];
    this.lastTimestamp = null;
  }

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
