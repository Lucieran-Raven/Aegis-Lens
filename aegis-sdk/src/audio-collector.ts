/**
 * Aegis Lens v2.0 - Audio Collector
 * Low-latency microphone collection bypassing echo cancellation
 * Captures audio for Time-of-Flight measurement
 */

export interface AudioCollectorConfig {
  sampleRate?: number;
  bufferSize?: number;
  channelCount?: number;
  bypassEchoCancellation?: boolean;
  bypassNoiseSuppression?: boolean;
  bypassAutoGain?: boolean;
}

export interface AudioData {
  buffer: Float32Array;
  sampleRate: number;
  timestamp: number;
}

export class AudioCollector {
  private audioContext: AudioContext;
  private mediaStream: MediaStream | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private audioWorklet: AudioWorkletNode | null = null;
  private isRecording: boolean = false;
  private audioBuffer: Float32Array[] = [];
  private config: AudioCollectorConfig;
  private readonly MAX_BUFFER_SECONDS = 10; // CRITICAL FIX: Cap at 10 seconds to prevent memory leaks (H4)
  private readonly MAX_BUFFER_SIZE: number;

  constructor(config: AudioCollectorConfig = {}) {
    this.config = {
      sampleRate: 48000,
      bufferSize: 4096,
      channelCount: 1,
      bypassEchoCancellation: true,
      bypassNoiseSuppression: true,
      bypassAutoGain: true,
      ...config,
    };

    // Calculate max buffer size in samples (10 seconds at sample rate)
    this.MAX_BUFFER_SIZE = this.MAX_BUFFER_SECONDS * this.config.sampleRate!;

    this.audioContext = new AudioContext({
      sampleRate: this.config.sampleRate,
    });
  }

  /**
   * Start audio capture with echo cancellation bypassed
   */
  async startCapture(): Promise<void> {
    if (this.isRecording) {
      return;
    }

    // Request microphone access with constraints to bypass audio processing
    const constraints: MediaStreamConstraints = {
      audio: {
        channelCount: this.config.channelCount,
        sampleRate: this.config.sampleRate,
        echoCancellation: !this.config.bypassEchoCancellation,
        noiseSuppression: !this.config.bypassNoiseSuppression,
        autoGainControl: !this.config.bypassAutoGain,
      },
      video: false,
    };

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      // Fallback with relaxed constraints if strict constraints fail
      console.warn('Strict audio constraints failed, using fallback:', error);
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
    }

    const source = this.audioContext.createMediaStreamSource(this.mediaStream);

    // Try to use AudioWorklet for better performance
    try {
      await this.setupAudioWorklet(source);
    } catch (error) {
      console.warn('AudioWorklet not available, falling back to ScriptProcessor:', error);
      this.setupScriptProcessor(source);
    }

    this.isRecording = true;
  }

  /**
   * Set up AudioWorklet for audio processing (preferred method)
   */
  private async setupAudioWorklet(source: MediaStreamAudioSourceNode): Promise<void> {
    // Create a simple worklet processor
    const workletCode = `
      class AudioProcessor extends AudioWorkletProcessor {
        constructor() {
          super();
          this.buffer = [];
          this.bufferSize = 4096;
        }

        process(inputs, outputs) {
          const input = inputs[0];
          const output = outputs[0];
          
          if (input.length > 0 && input[0].length > 0) {
            const channelData = input[0];
            this.port.postMessage({
              type: 'audioData',
              data: channelData.slice()
            });
          }
          
          return true;
        }
      }

      registerProcessor('audio-processor', AudioProcessor);
    `;

    const blob = new Blob([workletCode], { type: 'application/javascript' });
    const workletUrl = URL.createObjectURL(blob);

    await this.audioContext.audioWorklet.addModule(workletUrl);

    this.audioWorklet = new AudioWorkletNode(this.audioContext, 'audio-processor');
    
    this.audioWorklet.port.onmessage = (event) => {
      if (event.data.type === 'audioData') {
        this.audioBuffer.push(new Float32Array(event.data.data));
        // CRITICAL FIX: Enforce sliding window to prevent unbounded growth (H4)
        this.enforceBufferLimit();
      }
    };

    source.connect(this.audioWorklet);
    this.audioWorklet.connect(this.audioContext.destination);
  }

  /**
   * Set up ScriptProcessor as fallback (deprecated but widely supported)
   */
  private setupScriptProcessor(source: MediaStreamAudioSourceNode): void {
    this.scriptProcessor = this.audioContext.createScriptProcessor(
      this.config.bufferSize!,
      this.config.channelCount!,
      this.config.channelCount!
    );

    this.scriptProcessor.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0);
      // Copy the data to avoid reference issues
      const dataCopy = new Float32Array(inputData.length);
      dataCopy.set(inputData);
      this.audioBuffer.push(dataCopy);
      // CRITICAL FIX: Enforce sliding window to prevent unbounded growth (H4)
      this.enforceBufferLimit();
    };

    source.connect(this.scriptProcessor);
    this.scriptProcessor.connect(this.audioContext.destination);
  }

  /**
   * Stop audio capture
   */
  stopCapture(): void {
    if (!this.isRecording) {
      return;
    }

    this.isRecording = false;

    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }

    if (this.audioWorklet) {
      this.audioWorklet.disconnect();
      this.audioWorklet = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
  }

  /**
   * Get collected audio data
   */
  getAudioData(): AudioData {
    if (this.audioBuffer.length === 0) {
      return {
        buffer: new Float32Array(0),
        sampleRate: this.config.sampleRate!,
        timestamp: Date.now(),
      };
    }

    // Concatenate all buffers
    const totalLength = this.audioBuffer.reduce((sum, buf) => sum + buf.length, 0);
    const combinedBuffer = new Float32Array(totalLength);
    let offset = 0;

    for (const buf of this.audioBuffer) {
      combinedBuffer.set(buf, offset);
      offset += buf.length;
    }

    return {
      buffer: combinedBuffer,
      sampleRate: this.config.sampleRate!,
      timestamp: Date.now(),
    };
  }

  /**
   * Clear the audio buffer
   */
  clearBuffer(): void {
    this.audioBuffer = [];
  }

  /**
   * Enforce buffer limit by removing oldest data when exceeding max size
   * CRITICAL FIX: Prevents unbounded memory growth in long sessions (H4)
   */
  private enforceBufferLimit(): void {
    const currentSampleCount = this.audioBuffer.reduce((sum, buf) => sum + buf.length, 0);
    
    if (currentSampleCount > this.MAX_BUFFER_SIZE) {
      // Remove oldest buffers until we're under the limit
      while (this.audioBuffer.length > 0 && 
             this.audioBuffer.reduce((sum, buf) => sum + buf.length, 0) > this.MAX_BUFFER_SIZE) {
        this.audioBuffer.shift();
      }
    }
  }

  /**
   * Get the number of samples collected
   */
  getSampleCount(): number {
    return this.audioBuffer.reduce((sum, buf) => sum + buf.length, 0);
  }

  /**
   * Check if recording is active
   */
  isCapturing(): boolean {
    return this.isRecording;
  }

  /**
   * Resume the AudioContext (required after user interaction)
   */
  async resume(): Promise<void> {
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  /**
   * Close the AudioContext
   */
  close(): void {
    this.stopCapture();
    this.audioContext.close();
  }
}
