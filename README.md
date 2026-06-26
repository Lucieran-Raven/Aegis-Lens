# Aegis Lens v2.0

**Physics-based trust infrastructure for digital identity verification**

Aegis Lens v2.0 is a hardware-layer digital truth validation platform that detects virtual cameras, deepfakes, and synthetic media through physics-based signal analysis. By measuring camera timing entropy, acoustic time-of-flight, eye tracking patterns, and lip-sync synchronization, it determines whether a user is a real human or using virtual/synthetic media.

## Architecture

Aegis Lens v2.0 is a monorepo containing:

- **aegis-backend**: Go API server with chi router, Redis session management, and TimescaleDB time-series storage
- **aegis-sdk**: TypeScript client SDK with Web Workers, Web Audio API, and cryptographic operations
- **Zero-PII Design**: All biometric processing happens client-side; the server only receives aggregated telemetry signals

## Quick Start with Docker

```bash
# Clone the repository
git clone https://github.com/Lucieran-Raven/Aegis-Lens.git
cd Aegis-Lens

# Start all services (Redis, TimescaleDB, Backend)
docker-compose up -d

# Verify health
curl http://localhost:8080/health
```

For detailed integration instructions, security header requirements, and CORS configuration, see [docs/INTEGRATION.md](docs/INTEGRATION.md).

## Live Detection Demo

Aegis Lens detects four distinct signals to identify virtual/synthetic media:

- **Camera Timing Entropy**: Measures frame timing variance to detect virtual cameras (OBS, ManyCam) which output perfectly regular frames unlike physical cameras with natural jitter
- **Acoustic Time-of-Flight**: Plays an ultrasonic chirp through speakers and measures microphone response time to detect virtual audio loopback (zero latency = synthetic)
- **Eye Tracking**: Uses WebGazer to detect microsaccades and glint parallax; virtual eyes lack natural microsaccade patterns and depth perception
- **Lip-Sync Synchronization**: Uses MediaPipe Face Mesh to measure audio-video drift; proxy dubbing shows excessive drift (>150ms) and poor lip correlation

### Minimum Integration (5 lines)

```typescript
import { AegisLens } from '@aegis-lens/sdk'

const aegis = new AegisLens({ 
  apiEndpoint: 'https://api.aegis-lens.com/api/v2',
  wasmUrl: '/wasm/aegis_wasm_bg.wasm',
  videoElement: document.getElementById('webcam') as HTMLVideoElement
})

await aegis.startSession()
const result = await aegis.submitTelemetry(cameraTimingSignal)
console.log(result.verdict) // "CLEAR" | "SUSPICIOUS" | "BLOCKED"
```

### Health Check

Before starting a session, check which signals are available:

```typescript
const health = aegis.getSystemHealth()
console.log(health)
// {
//   wasm_loaded: true,
//   webgazer_loaded: true,
//   mediapipe_loaded: true,
//   microphone_available: true,
//   camera_available: true,
//   ready_to_detect: true
// }
```

### Zero-PII Design

All biometric processing happens client-side. The server only receives aggregated telemetry signals (variance, correlation, drift values) - no raw video frames, audio samples, or facial landmarks ever leave the device. This ensures GDPR/CCPA compliance and user privacy.

### Attack Simulation

See [examples/attack-simulation.ts](examples/attack-simulation.ts) for a comprehensive demo showing how the system detects various attack vectors (virtual camera, virtual audio, overlay reading, proxy dubbing).

## Security Features

- ECDSA P-256 signature verification with low-S normalization
- TLS 1.2+ with secure cipher suites and HSTS
- Strict CORS whitelist enforcement
- Rate limiting (100 req/min with burst 20)
- Content Security Policy (CSP) headers
- COOP/COEP isolation for SharedArrayBuffer
- Input validation with NaN/Infinity/bounds checking
- Circular buffer memory management to prevent leaks

## Environment Variables

See [`.env.example`](.env.example) for the complete list of required environment variables.

## License

Proprietary - All rights reserved.

## Documentation

- [docs/INTEGRATION.md](docs/INTEGRATION.md) - Integration guide and security requirements
- [docs/HARDENING_REPORT.md](docs/HARDENING_REPORT.md) - Security audit findings and remediation
