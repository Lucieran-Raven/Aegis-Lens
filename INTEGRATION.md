# Aegis Lens v2.0 - Integration Documentation

## Overview

Aegis Lens v2.0 is a hardware-layer digital truth validation platform that detects virtual cameras, deepfakes, and synthetic media through physics-based signal analysis. This document provides comprehensive integration guidelines for enterprise deployment.

## Table of Contents

1. [Security Headers & Isolation](#security-headers--isolation)
2. [CORS Configuration](#cors-configuration)
3. [COOP/COEP Isolation](#coopcoep-isolation)
4. [API Endpoints](#api-endpoints)
5. [SDK Integration](#sdk-integration)
6. [Environment Variables](#environment-variables)
7. [Deployment Checklist](#deployment-checklist)

---

## Security Headers & Isolation

### Required Security Headers

To ensure proper operation of Aegis Lens, the following security headers must be configured on your web server:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; worker-src 'self' blob:
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(self), microphone=(self)
```

### Why These Headers Matter

- **COOP/COEP**: Required for `SharedArrayBuffer` and high-performance Web Workers used in frame timing analysis
- **CSP**: Restricts script execution to prevent XSS attacks that could bypass validation
- **Permissions-Policy**: Explicitly grants camera/microphone access only to authorized origins

---

## CORS Configuration

### Backend CORS Settings

The Aegis Lens backend API requires strict CORS configuration. Configure your reverse proxy or Go backend as follows:

```go
// Example CORS middleware configuration
allowedOrigins := []string{
    "https://your-domain.com",
    "https://app.your-domain.com",
}

allowedMethods := []string{"POST", "OPTIONS"}
allowedHeaders := []string{
    "Content-Type",
    "Authorization",
    "X-Session-ID",
    "X-Client-Version",
}

exposedHeaders := []string{
    "X-Request-ID",
    "X-Verdict",
}
```

### Frontend CORS Configuration

When integrating the SDK, ensure your API client includes proper CORS headers:

```typescript
const apiClient = new AegisApiClient({
    baseUrl: 'https://api.your-domain.com',
    headers: {
        'Content-Type': 'application/json',
        'X-Client-Version': '2.0.0',
    },
});
```

### CORS Error Handling

If you encounter CORS errors, verify:

1. Origin is included in `allowedOrigins`
2. Preflight OPTIONS requests are handled correctly
3. Credentials mode matches your authentication strategy
4. Response headers include `Access-Control-Allow-Origin`

---

## COOP/COEP Isolation

### What is COOP/COEP?

**Cross-Origin Opener Policy (COOP)** and **Cross-Origin Embedder Policy (COEP)** are security headers that enable advanced browser features like `SharedArrayBuffer` and high-performance Web Workers.

### Implementation

#### Nginx Configuration

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # COOP/COEP headers
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Cross-Origin-Embedder-Policy "require-corp" always;

    # Additional security headers
    add_header Cross-Origin-Resource-Policy "same-origin" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; worker-src 'self' blob:" always;
}
```

#### Apache Configuration

```apache
<VirtualHost *:443>
    ServerName your-domain.com

    # COOP/COEP headers
    Header always set Cross-Origin-Opener-Policy "same-origin"
    Header always set Cross-Origin-Embedder-Policy "require-corp"

    # Additional security headers
    Header always set Cross-Origin-Resource-Policy "same-origin"
    Header always set Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; worker-src 'self' blob:"
</VirtualHost>
```

#### Cloudflare Workers

```javascript
export default {
    async fetch(request) {
        const response = await handleRequest(request);
        
        response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
        response.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
        
        return response;
    }
};
```

### Testing COOP/COEP

Verify COOP/COEP is correctly configured:

```javascript
// In browser console
console.log(crossOriginIsolated); // Should return: true

// Check SharedArrayBuffer availability
try {
    const buffer = new SharedArrayBuffer(1024);
    console.log('SharedArrayBuffer is available');
} catch (e) {
    console.error('SharedArrayBuffer is not available:', e);
}
```

---

## API Endpoints

### Session Initialization

**Endpoint:** `POST /api/v2/session/init`

**Description:** Initializes a new validation session, generates cryptographic nonces, and returns a public key for client-side signing.

**Request Body:**
```json
{
    "client_version": "2.0.0",
    "user_agent": "Mozilla/5.0...",
    "client_ip": "192.168.1.1"
}
```

**Response:**
```json
{
    "session_id": "uuid-v4",
    "server_nonce": "base64-encoded-nonce",
    "public_key_pem": "-----BEGIN PUBLIC KEY-----...",
    "expires_at": "2024-01-01T00:05:00Z"
}
```

### Session Verification

**Endpoint:** `POST /api/v2/session/verify`

**Description:** Submits telemetry data for validation and receives a verdict.

**Request Body:**
```json
{
    "session_id": "uuid-v4",
    "timestamp": 1704067200000,
    "telemetry": {
        "variance_score": 150.0,
        "kl_divergence_score": 0.3,
        "shapiro_wilk_score": 0.95,
        "tof_ms": 5.0,
        "glint_valid": true,
        "lip_sync_valid": true
    },
    "signature": "base64-encoded-signature"
}
```

**Response:**
```json
{
    "verdict": "CLEAR",
    "confidence": 0.95,
    "processing_time_ms": 2.5,
    "server_timestamp": 1704067200250
}
```

**Verdict Values:**
- `CLEAR`: Hardware validation passed, likely genuine user
- `SUSPICIOUS`: Some signals indicate potential virtualization
- `BLOCKED`: Multiple signals indicate synthetic media or virtual devices

### Health Check

**Endpoint:** `GET /health`

**Description:** Returns service health status.

**Response:**
```json
{
    "status": "healthy",
    "timestamp": "2024-01-01T00:00:00Z",
    "services": {
        "redis": "healthy",
        "database": "healthy"
    }
}
```

---

## SDK Integration

### Installation

```bash
npm install @aegis-lens/sdk
```

### Basic Integration

```typescript
import { AegisLens } from '@aegis-lens/sdk';

// Initialize the SDK
const aegis = new AegisLens({
    apiKey: 'your-api-key',
    baseUrl: 'https://api.your-domain.com',
    videoElement: document.getElementById('video'),
});

// Start validation
async function startValidation() {
    try {
        const result = await aegis.validate();
        console.log('Verdict:', result.verdict);
        console.log('Confidence:', result.confidence);
    } catch (error) {
        console.error('Validation failed:', error);
    }
}

// Start when user grants permissions
document.getElementById('start-btn').addEventListener('click', startValidation);
```

### Advanced Configuration

```typescript
const aegis = new AegisLens({
    apiKey: 'your-api-key',
    baseUrl: 'https://api.your-domain.com',
    videoElement: document.getElementById('video'),
    
    // Audio configuration
    audioConfig: {
        sampleRate: 48000,
        chirpDuration: 0.08,
        bypassEchoCancellation: true,
    },
    
    // Video configuration
    videoConfig: {
        frameRate: 60,
        resolution: { width: 1280, height: 720 },
    },
    
    // Thresholds
    thresholds: {
        varianceThreshold: 100.0,
        klDivergenceThreshold: 0.5,
        shapiroWilkThreshold: 0.8,
    },
    
    // Callbacks
    onProgress: (progress) => {
        console.log('Progress:', progress);
    },
    onTelemetry: (telemetry) => {
        console.log('Telemetry:', telemetry);
    },
});
```

### Error Handling

```typescript
try {
    const result = await aegis.validate();
    
    if (result.verdict === 'BLOCKED') {
        // Block user access
        window.location.href = '/blocked';
    } else if (result.verdict === 'SUSPICIOUS') {
        // Require additional verification
        showAdditionalVerification();
    } else {
        // Allow access
        grantAccess();
    }
} catch (error) {
    if (error.code === 'PERMISSION_DENIED') {
        showPermissionError();
    } else if (error.code === 'COOP_COEP_REQUIRED') {
        showCOOPCOEPError();
    } else {
        showGenericError();
    }
}
```

---

## Environment Variables

### Backend Environment Variables

```bash
# Server Configuration
GIN_MODE=release
PORT=8080
LOG_LEVEL=info

# Redis Configuration
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# Database Configuration
POSTGRES_HOST=timescaledb
POSTGRES_PORT=5432
POSTGRES_DB=aegis
POSTGRES_USER=aegis_user
POSTGRES_PASSWORD=secure_password

# Security
SESSION_TTL=300s
CLOCK_SKEW_TOLERANCE=30s

# Scoring Thresholds
VARIANCE_THRESHOLD=100.0
KL_DIVERGENCE_THRESHOLD=0.5
SHAPIRO_WILK_THRESHOLD=0.8
```

### Frontend Environment Variables

```bash
# API Configuration
VITE_API_BASE_URL=https://api.your-domain.com
VITE_API_KEY=your-api-key

# Feature Flags
VITE_ENABLE_AUDIO_TOF=true
VITE_ENABLE_EYE_TRACKING=true
VITE_ENABLE_LIP_SYNC=true
```

---

## Deployment Checklist

### Pre-Deployment

- [ ] Configure COOP/COEP headers on web server
- [ ] Set up CSP headers with proper worker-src directive
- [ ] Configure CORS policies for API endpoints
- [ ] Generate and distribute API keys
- [ ] Set up Redis instance with persistence
- [ ] Configure TimescaleDB with proper retention policies
- [ ] Run database migrations
- [ ] Configure SSL/TLS certificates

### Deployment

- [ ] Build TypeScript SDK: `npm run build`
- [ ] Build Go backend: `go build -o aegis-backend`
- [ ] Build Docker images: `docker-compose build`
- [ ] Deploy to production environment
- [ ] Run health checks: `curl https://api.your-domain.com/health`
- [ ] Verify COOP/COEP: Check browser console for `crossOriginIsolated`

### Post-Deployment

- [ ] Monitor Redis connection health
- [ ] Monitor database connection pool
- [ ] Review API response times (target: <15ms)
- [ ] Check error logs for validation failures
- [ ] Verify telemetry data is being logged
- [ ] Test with real hardware devices
- [ ] Test with virtual cameras (should be blocked)

### Monitoring

Key metrics to monitor:

- API response time (p50, p95, p99)
- Verification success rate
- Verdict distribution (CLEAR/SUSPICIOUS/BLOCKED)
- Redis hit rate
- Database query performance
- Web Worker initialization time
- SharedArrayBuffer availability

---

## Troubleshooting

### SharedArrayBuffer Not Available

**Symptom:** Error message "SharedArrayBuffer is not defined"

**Solution:** Ensure COOP/COEP headers are correctly configured:
```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

### CORS Errors

**Symptom:** Browser console shows CORS policy errors

**Solution:** Verify your backend includes proper CORS headers and your origin is whitelisted.

### Permission Denied

**Symptom:** Camera/microphone access denied

**Solution:** Ensure Permissions-Policy header includes camera and microphone, and user has granted permissions.

### High Latency

**Symptom:** API response time exceeds 15ms

**Solution:** Check Redis and database connection pools, enable connection keep-alive, and consider geographic distribution.

---

## Support

For integration support, contact:
- Email: support@aegis-lens.com
- Documentation: https://docs.aegis-lens.com
- Status Page: https://status.aegis-lens.com

---

**Version:** 2.0.0  
**Last Updated:** 2024-01-01
