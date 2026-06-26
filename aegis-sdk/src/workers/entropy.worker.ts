/**
 * Aegis Lens v2.0 - Entropy Analysis Web Worker
 * Processes frame delta arrays using Rust WASM for sub-millisecond mathematical evaluations
 * Runs in background thread to avoid blocking UI
 */

// Worker will be initialized with SharedArrayBuffer
let sharedBuffer: SharedArrayBuffer | null = null;
let int32View: Int32Array | null = null;
let float64View: Float64Array | null = null;

// Ring buffer indices
let HEAD_INDEX = 0;
let TAIL_INDEX = 0;
let DATA_START = 0;

/**
 * Initialize the worker with SharedArrayBuffer
 */
self.onmessage = async (event: MessageEvent) => {
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

/**
 * Initialize SharedArrayBuffer and load WASM module
 */
async function initialize(
  buffer: SharedArrayBuffer,
  headIndex: number,
  tailIndex: number,
  dataStart: number,
  wasmUrl?: string
): Promise<void> {
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
      // @ts-expect-error - WASM module exports are dynamic
      self.wasmModule = wasmModule.instance.exports;
    } catch (error) {
      console.error('Failed to load WASM module:', error);
    }
  }

  self.postMessage({ type: 'initialized' });
}

/**
 * Analyze frame deltas from ring buffer
 */
function analyze(): void {
  if (!int32View || !float64View) {
    console.error('Worker not initialized');
    return;
  }

  const head = Atomics.load(int32View!, HEAD_INDEX);
  const tail = Atomics.load(int32View!, TAIL_INDEX);

  if (head === tail) {
    // No data to process
    return;
  }

  // Read all available data from ring buffer
  const deltas: number[] = [];
  let current = head;

  while (current !== tail) {
    const lengthIndex = DATA_START + current * 2;
    const length = int32View![lengthIndex];
    
    const dataStartFloat64 = DATA_START * 2;
    const float64ReadPos = (dataStartFloat64 + current * 2) % float64View!.length;
    
    for (let i = 0; i < length; i++) {
      const pos = (float64ReadPos + i) % float64View!.length;
      deltas.push(float64View![pos]);
    }

    current = (current + 1) % 256; // Ring size is 256
  }

  // Update head index to indicate data has been consumed
  Atomics.store(int32View!, HEAD_INDEX, tail);

  // Process deltas with WASM or fallback to JS
  let result;
  // @ts-expect-error - WASM module is dynamically loaded
  if (self.wasmModule) {
    result = analyzeWithWasm(deltas);
  } else {
    result = analyzeWithJS(deltas);
  }

  // Send result back to main thread
  self.postMessage({
    type: 'result',
    result,
  });
}

/**
 * Analyze deltas using Rust WASM module
 */
function analyzeWithWasm(deltas: number[]): Record<string, unknown> {
  try {
    // @ts-expect-error - WASM module exports are dynamic
    const { analyze_frame_deltas, is_virtual_camera, get_confidence_score } = self.wasmModule;

    const wasmResult = analyze_frame_deltas(deltas);
    const isVirtual = is_virtual_camera(deltas);
    const confidence = get_confidence_score(deltas);

    return {
      variance: wasmResult.variance,
      stdDev: wasmResult.std_dev,
      klDivergence: wasmResult.kl_divergence,
      shapiroWilkW: wasmResult.shapiro_wilk_w,
      sampleCount: wasmResult.sample_count,
      isVirtualCamera: isVirtual,
      confidenceScore: confidence,
    };
  } catch (error) {
    console.error('WASM analysis failed, falling back to JS:', error);
    return analyzeWithJS(deltas);
  }
}

/**
 * Fallback JavaScript analysis (simplified)
 */
function analyzeWithJS(deltas: number[]): Record<string, unknown> {
  const variance = calculateVariance(deltas);
  const stdDev = Math.sqrt(variance);
  const klDivergence = calculateKLDivergence(deltas);
  const shapiroWilkW = calculateShapiroWilk(deltas);

  // Virtual camera detection
  const isVirtualCamera = variance < 12.0;

  // Confidence score
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

/**
 * Calculate variance (Welford algorithm)
 */
function calculateVariance(samples: number[]): number {
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

/**
 * Calculate KL divergence (simplified)
 */
function calculateKLDivergence(samples: number[]): number {
  if (samples.length === 0) return 0.0;

  // Simplified histogram-based KL divergence
  const bins = 20;
  const histogram = new Array(bins).fill(0);
  const max = Math.max(...samples);
  const binWidth = Math.max(max / bins, 1.0);

  for (const sample of samples) {
    const bin = Math.min(Math.floor(sample / binWidth), bins - 1);
    histogram[bin]++;
  }

  // Normalize
  const total = samples.length;
  for (let i = 0; i < bins; i++) {
    histogram[i] /= total;
  }

  // Calculate KL divergence against uniform distribution
  let kl = 0.0;
  const epsilon = 1e-10;
  for (let i = 0; i < bins; i++) {
    const p = Math.max(histogram[i], epsilon);
    const q = 1.0 / bins;
    kl += p * Math.log(p / q);
  }

  return kl;
}

/**
 * Calculate Shapiro-Wilk W statistic (simplified approximation)
 */
function calculateShapiroWilk(samples: number[]): number {
  if (samples.length < 3) return 0.0;

  const n = samples.length;
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const ss = sorted.reduce((sum, x) => sum + (x - mean) ** 2, 0);

  if (ss === 0) return 0.0;

  // Simplified normal approximation
  const skewness = sorted.reduce((sum, x) => sum + ((x - mean) / Math.sqrt(ss)) ** 3, 0) / n;
  const kurtosis = sorted.reduce((sum, x) => sum + ((x - mean) / Math.sqrt(ss)) ** 4, 0) / n - 3.0;

  const skewScore = Math.max(1.0 - Math.min(Math.abs(skewness), 1.0), 0.0);
  const kurtScore = Math.max(1.0 - Math.min(Math.abs(kurtosis), 1.0), 0.0);

  return (skewScore * 0.5 + kurtScore * 0.5);
}

