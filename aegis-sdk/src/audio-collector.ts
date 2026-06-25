
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
  private readonly MAX_BUFFER_SECONDS = 10;
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

    this.MAX_BUFFER_SIZE = this.MAX_BUFFER_SECONDS * this.config.sampleRate!;

    this.audioContext = new AudioContext({
      sampleRate: this.config.sampleRate,
    });
  }

  async startCapture(): Promise<void> {
    if (this.isRecording) {
      return;
    }

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
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
    }

    const source = this.audioContext.createMediaStreamSource(this.mediaStream);

    try {
      await this.setupAudioWorklet(source);
    } catch (error) {
      this.setupScriptProcessor(source);
    }

    this.isRecording = true;
  }

  private async setupAudioWorklet(source: MediaStreamAudioSourceNode): Promise<void> {
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
        this.enforceBufferLimit();
      }
    };

    source.connect(this.audioWorklet);
    this.audioWorklet.connect(this.audioContext.destination);
  }

  private setupScriptProcessor(source: MediaStreamAudioSourceNode): void {
    this.scriptProcessor = this.audioContext.createScriptProcessor(
      this.config.bufferSize!,
      this.config.channelCount!,
      this.config.channelCount!
    );

    this.scriptProcessor.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0);
      const dataCopy = new Float32Array(inputData.length);
      dataCopy.set(inputData);
      this.audioBuffer.push(dataCopy);
      // CRITICAL FIX: Enforce sliding window to prevent unbounded growth (H4)
      this.enforceBufferLimit();
    };

    source.connect(this.scriptProcessor);
    this.scriptProcessor.connect(this.audioContext.destination);
  }

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

  getAudioData(): AudioData {
    if (this.audioBuffer.length === 0) {
      return {
        buffer: new Float32Array(0),
        sampleRate: this.config.sampleRate!,
        timestamp: Date.now(),
      };
    }

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

  clearBuffer(): void {
    this.audioBuffer = [];
  }

  private enforceBufferLimit(): void {
    const currentSampleCount = this.audioBuffer.reduce((sum, buf) => sum + buf.length, 0);
    
    if (currentSampleCount > this.MAX_BUFFER_SIZE) {
      while (this.audioBuffer.length > 0 && 
             this.audioBuffer.reduce((sum, buf) => sum + buf.length, 0) > this.MAX_BUFFER_SIZE) {
        this.audioBuffer.shift();
      }
    }
  }

  getSampleCount(): number {
    return this.audioBuffer.reduce((sum, buf) => sum + buf.length, 0);
  }

  isCapturing(): boolean {
    return this.isRecording;
  }

  async resume(): Promise<void> {
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  close(): void {
    this.stopCapture();
    this.audioContext.close();
  }
}
