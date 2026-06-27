/**
 * Attack Simulation Demo
 * 
 * This script simulates what a cheating candidate looks like from a signal perspective.
 * It feeds fake telemetry values representing various cheating signatures into the system
 * to demonstrate fraud detection capabilities.
 * 
 * This is a sales/demo tool - it does NOT actually cheat, just shows detection in action.
 */

import { AegisLens, AegisConfig } from '../aegis-sdk/dist/index';
import { CameraTimingSignal } from '../aegis-sdk/dist/proto/session';

// Demo configuration
const DEMO_CONFIG: AegisConfig = {
  apiEndpoint: 'http://localhost:8080/api/v2',
  timeoutMs: 10000,
  videoElement: null as any, // Not used in simulation
  wasmUrl: null, // Not used in simulation
};

/**
 * Simulate Virtual Camera Attack
 * 
 * Signature: Low entropy variance (0.0001), uniform frame intervals
 * This happens when OBS/virtual cameras output perfectly regular frames
 */
function simulateVirtualCamera(): CameraTimingSignal {
  const frameCount = 89;
  const frameDeltas: number[] = [];
  
  // Generate perfectly uniform frame intervals (virtual camera signature)
  for (let i = 0; i < frameCount; i++) {
    frameDeltas.push(33.33); // Exactly 30fps, no jitter
  }
  
  return {
    variance: 0.0001, // Near-zero variance = virtual camera
    stdDev: 0.01,
    klDivergence: 0.001, // Very low KL divergence = uniform distribution
    shapiroWilkW: 0.99, // Perfect normality (too perfect)
    sampleCount: frameCount,
    frameDeltas,
  };
}

/**
 * Simulate Virtual Audio Attack
 * 
 * Signature: Zero ToF latency (0.0ms), flat impulse response
 * This happens when audio is looped back virtually (no physical speaker/mic)
 */
function simulateVirtualAudio() {
  return {
    timeOfFlightMs: 0.0, // Zero latency = instant loopback
    correlationPeak: 1.0, // Perfect correlation (impossible physically)
    spectralEntropy: 0.1, // Flat spectrum = synthetic audio
    phaseSignatureValid: true,
    sampleCount: 1000,
  };
}

/**
 * Simulate Overlay Reading Attack
 * 
 * Signature: High gaze linearity (0.95), repetitive horizontal saccades
 * This happens when candidate reads from a screen overlay
 */
function simulateOverlayReading() {
  return {
    microsaccadeRate: 0.1, // Very low microsaccades = reading, not natural eye movement
    glintParallaxVariance: 0.01, // Near-zero parallax = no depth perception
    luminanceCorrelation: 0.95, // Too high correlation = synthetic pattern
    gazeSamples: 300,
  };
}

/**
 * Simulate Proxy Dubbing Attack
 * 
 * Signature: High AV drift (>150ms)
 * This happens when audio is dubbed by a proxy
 */
function simulateProxyDubbing() {
  return {
    audioVideoDriftMs: 200.0, // Excessive drift = dubbed audio
    lipVelocityCorrelation: 0.2, // Low correlation = lips don't match audio
    multiPersonDetected: false,
    syncSamples: 300,
  };
}

/**
 * Run attack simulation demo
 */
async function runAttackSimulation() {
  console.log('=== AEGIS LENS ATTACK SIMULATION DEMO ===\n');
  
  // Initialize AegisLens (in real usage, this would connect to actual backend)
  console.log('Initializing AegisLens...');
  const aegis = new AegisLens(DEMO_CONFIG);
  
  // Note: In this simulation, we're bypassing actual initialization
  // and directly constructing telemetry payloads to demonstrate detection
  
  console.log('\n--- SIMULATION 1: Virtual Camera Attack ---');
  console.log('Scenario: Candidate uses OBS virtual camera');
  const virtualCameraSignal = simulateVirtualCamera();
  console.log('Telemetry:', JSON.stringify(virtualCameraSignal, null, 2));
  console.log('Expected Verdict: BLOCKED (LOW_VARIANCE_VIRTUAL_CAM)');
  console.log('Expected Confidence Score: < 50\n');
  
  console.log('--- SIMULATION 2: Virtual Audio Attack ---');
  console.log('Scenario: Candidate uses virtual audio loopback');
  const virtualAudioSignal = simulateVirtualAudio();
  console.log('Telemetry:', JSON.stringify(virtualAudioSignal, null, 2));
  console.log('Expected Verdict: BLOCKED (INSTANT_AUDIO_LOOPBACK)');
  console.log('Expected Confidence Score: < 50\n');
  
  console.log('--- SIMULATION 3: Overlay Reading Attack ---');
  console.log('Scenario: Candidate reads from screen overlay');
  const overlayReadingSignal = simulateOverlayReading();
  console.log('Telemetry:', JSON.stringify(overlayReadingSignal, null, 2));
  console.log('Expected Verdict: BLOCKED (LOW_MICROSACCADE_RATE, ABSENT_GLINT_PARALLAX)');
  console.log('Expected Confidence Score: < 50\n');
  
  console.log('--- SIMULATION 4: Proxy Dubbing Attack ---');
  console.log('Scenario: Candidate uses proxy dubbing service');
  const proxyDubbingSignal = simulateProxyDubbing();
  console.log('Telemetry:', JSON.stringify(proxyDubbingSignal, null, 2));
  console.log('Expected Verdict: BLOCKED (EXCESSIVE_AV_DRIFT)');
  console.log('Expected Confidence Score: < 50\n');
  
  console.log('--- SIMULATION 5: Combined Attack (All Signals) ---');
  console.log('Scenario: Sophisticated attack using all methods');
  console.log('Telemetry:');
  console.log('  Camera Timing:', JSON.stringify(virtualCameraSignal));
  console.log('  Acoustic:', JSON.stringify(virtualAudioSignal));
  console.log('  Eye Tracking:', JSON.stringify(overlayReadingSignal));
  console.log('  Lip Sync:', JSON.stringify(proxyDubbingSignal));
  console.log('Expected Verdict: BLOCKED (Multiple critical flags)');
  console.log('Expected Confidence Score: 0 (Maximum penalty)\n');
  
  console.log('--- SIMULATION 6: Legitimate Candidate ---');
  console.log('Scenario: Honest candidate with physical hardware');
  const legitimateCamera: CameraTimingSignal = {
    variance: 100.0, // Natural variance
    stdDev: 10.0,
    klDivergence: 0.05, // Natural distribution
    shapiroWilkW: 0.98, // Normal but not perfect
    sampleCount: 89,
    frameDeltas: Array.from({length: 89}, () => 33.33 + (Math.random() - 0.5) * 5),
  };
  const legitimateAudio = {
    timeOfFlightMs: 5.0, // Physical room ToF
    correlationPeak: 0.85, // Good but not perfect
    spectralEntropy: 2.0, // Natural spectrum
    phaseSignatureValid: true,
    sampleCount: 1000,
  };
  const legitimateEyeTracking = {
    microsaccadeRate: 2.5, // Natural microsaccade rate
    glintParallaxVariance: 0.3, // Natural parallax
    luminanceCorrelation: 0.7, // Natural correlation
    gazeSamples: 300,
  };
  const legitimateLipSync = {
    audioVideoDriftMs: 30.0, // Good sync
    lipVelocityCorrelation: 0.8, // Good correlation
    multiPersonDetected: false,
    syncSamples: 300,
  };
  console.log('Telemetry:');
  console.log('  Camera Timing:', JSON.stringify(legitimateCamera));
  console.log('  Acoustic:', JSON.stringify(legitimateAudio));
  console.log('  Eye Tracking:', JSON.stringify(legitimateEyeTracking));
  console.log('  Lip Sync:', JSON.stringify(legitimateLipSync));
  console.log('Expected Verdict: CLEAR');
  console.log('Expected Confidence Score: > 80\n');
  
  console.log('=== END OF SIMULATION ===');
  console.log('\nNote: In production, these telemetry payloads would be sent to');
  console.log('the backend via submitTelemetry() and the actual verdict would');
  console.log('be returned based on the scoring matrix.');
  console.log('\nTo run with actual backend:');
  console.log('  1. Start the Go backend server');
  console.log('  2. Initialize AegisLens with real config');
  console.log('  3. Call aegis.startSession()');
  console.log('  4. Call aegis.submitTelemetry(signal)');
  console.log('  5. Check result.verdict and result.confidenceScore');
}

// Run the simulation
runAttackSimulation().catch(console.error);
