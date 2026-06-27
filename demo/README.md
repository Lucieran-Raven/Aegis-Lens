# Aegis Lens Demo

This directory contains a working HTML demo and attack simulation for Aegis Lens.

## Running the HTML Demo

### Prerequisites

1. Build the SDK:
```bash
cd aegis-sdk
npm run build
```

2. Start the backend:
```bash
docker compose up
```

3. Open the demo in Chrome:
```
Open demo/index.html in your browser
```

### What the Demo Does

1. **Camera Feed**: Shows your webcam stream
2. **Audio Visualization**: Shows real-time audio spectrum
3. **Start Session**: Click to begin a 60-second verification session
4. **Detectors**: Shows real-time status of all 4 detectors:
   - Camera Timing (frame entropy analysis)
   - Acoustic ToF (ultrasonic chirp analysis)
   - Eye Tracking (microsaccade detection)
   - Lip Sync (audio-video drift)
5. **Results**: After 60 seconds, displays the verification verdict

### Important Notes

- The demo requires Chrome or Edge with COOP/COEP headers enabled
- The backend must be running on `http://localhost:8080`
- Camera and microphone permissions are required
- The demo runs for 60 seconds before submitting telemetry

## Running the Attack Simulation

### Prerequisites

1. Build the SDK:
```bash
cd aegis-sdk
npm run build
```

2. Start the backend:
```bash
docker compose up
```

3. Run the simulation:
```bash
npx ts-node examples/attack-simulation.ts
```

### What the Simulation Does

The attack simulation demonstrates how Aegis Lens detects various cheating scenarios:

1. **Virtual Camera**: OBS/virtual camera with perfect frame timing
2. **Virtual Audio**: Instant audio loopback with zero latency
3. **Overlay Reading**: Reading from screen overlay (linear gaze)
4. **Proxy Dubbing**: Audio dubbed by proxy (high AV drift)
5. **Combined Attack**: All cheating methods together
6. **Legitimate Candidate**: Honest user with physical hardware

The simulation shows the expected telemetry signals and verdicts for each scenario.

### Note

The attack simulation is a demonstration tool - it does not actually cheat or interact with the backend. It shows what cheating looks like from a signal perspective to demonstrate fraud detection capabilities.
