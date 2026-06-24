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

For detailed integration instructions, security header requirements, and CORS configuration, see [INTEGRATION.md](INTEGRATION.md).

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

- [INTEGRATION.md](INTEGRATION.md) - Integration guide and security requirements
- [HARDENING_REPORT.md](HARDENING_REPORT.md) - Security audit findings and remediation
