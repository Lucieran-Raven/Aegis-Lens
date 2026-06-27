# Browser Compatibility Guide

## Quick Reference Matrix

| Feature | Chrome 94+ | Firefox 93+ | Safari 16.4+ | Edge 94+ |
|---|---|---|---|---|
| Frame Timing Entropy | ✅ Full | ⚠️ Degraded | ⚠️ Degraded | ✅ Full |
| Acoustic ToF | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| Corneal Glint | ⚠️ Partial | ⚠️ Partial | ❌ Unsupported | ⚠️ Partial |
| AV-Sync Drift | ✅ Full | ✅ Full | ⚠️ Partial | ✅ Full |
| SharedArrayBuffer | ✅ (COOP/COEP) | ✅ (COOP/COEP) | ✅ Safari 16.4+ | ✅ (COOP/COEP) |

## What COOP/COEP Means For You

COOP (Cross-Origin-Opener-Policy) and COEP (Cross-Origin-Embedder-Policy) are HTTP security headers required to enable `SharedArrayBuffer` in modern browsers. `SharedArrayBuffer` is essential for high-performance WebAssembly workers used in the Aegis Lens SDK.

Without these headers:
- The WASM worker will fail to initialize
- Audio processing will fall back to slower main-thread execution
- Detection accuracy may be reduced

The nginx configuration provided with Aegis Lens sets these headers automatically:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

**Important**: These headers must be set on the same origin that serves the SDK. If you're serving the SDK from a CDN, you'll need to configure CORS and COOP/COEP carefully.

## Firefox Limitations

Firefox does not support `requestVideoFrameCallback`, a modern API for precise frame timing. The SDK falls back to `requestAnimationFrame`, which has the following limitations:

- **Frame timing accuracy reduced by ~15-20%**: `requestAnimationFrame` provides less precise timing compared to `requestVideoFrameCallback`
- **Higher variance**: Frame deltas may show more variance due to timing jitter
- **All other detectors work at full capacity**: Acoustic ToF, eye tracking, and lip sync are unaffected

**Recommendation**: Inform users that Chrome provides the best results, but Firefox is still functional for most detection scenarios.

## Safari Limitations

Safari has several limitations due to stricter camera API restrictions and MediaPipe compatibility:

- **WebGazer eye tracking unreliable**: Safari's camera API restrictions make eye tracking (corneal glint detection) unstable
- **Corneal glint detection falls back to unavailable**: The SDK will report glint detection as "unavailable" in Safari
- **SharedArrayBuffer requires Safari 16.4+**: Versions below 16.4 do not support `SharedArrayBuffer` even with COOP/COEP headers
- **MediaPipe performance may be reduced**: Face detection for lip sync may be slower on Safari

**Recommendation**: Safari is not recommended for production use. Use Chrome 94+ on desktop for full detection capability.

## Mobile Browsers

### iOS Safari
- Same limitations as Safari desktop
- Additional constraints due to iOS camera permissions
- Screen size may affect detection accuracy
- **Not recommended for interview proctoring**

### Android Chrome
- Full support for all detectors
- Performance comparable to desktop Chrome
- Camera angle and screen size may still affect accuracy
- **Acceptable for mobile use cases**

### General Mobile Limitations
- **Camera angle**: Mobile cameras are often at suboptimal angles for face detection
- **Screen size**: Smaller screens may reduce detection accuracy
- **Battery optimization**: Mobile OS may throttle background processing
- **Not recommended for interview proctoring**: Use desktop Chrome for best results

## Recommended Setup for Enterprise

For enterprise deployment and interview proctoring:

- **Chrome 94+ on desktop**: Full detection capability
- **All 4 detectors active and accurate**: Frame timing, acoustic ToF, eye tracking, and lip sync
- **Instruct candidates to use Chrome**: Add this to your interview setup instructions
- **Provide browser check**: Use the SDK's `getSystemHealth()` method to verify browser compatibility before starting

Example browser check:
```typescript
const health = await aegis.getSystemHealth();
if (!health.frameTiming.available) {
  alert('Please use Chrome 94+ for best results');
}
```

## How the SDK Handles Unsupported Features

The SDK is designed to degrade gracefully when features are unavailable:

- **Uses `getSystemHealth()` to check availability**: Before initialization, the SDK checks which features are supported
- **Degrades gracefully**: Missing signals are reported as "unavailable" not errors
- **Verdict still calculated**: The scoring engine calculates verdicts based on available signals only
- **Host platform receives signal availability status**: The response includes which signals were available

Example health check response:
```json
{
  "frameTiming": {
    "available": true,
    "status": "active"
  },
  "acousticToF": {
    "available": true,
    "status": "active"
  },
  "eyeTracking": {
    "available": false,
    "status": "unavailable",
    "reason": "Browser does not support required APIs"
  },
  "lipSync": {
    "available": true,
    "status": "active"
  }
}
```

## Browser-Specific Configuration Notes

### Chrome
- No special configuration required
- COOP/COEP headers must be set for SharedArrayBuffer
- Best performance and accuracy

### Firefox
- COOP/COEP headers must be set for SharedArrayBuffer
- Frame timing will use `requestAnimationFrame` fallback
- Consider informing users about degraded accuracy

### Safari
- COOP/COEP headers must be set for SharedArrayBuffer
- Requires Safari 16.4+ for SharedArrayBuffer support
- Eye tracking will be unavailable
- Not recommended for production use

### Edge
- Same as Chrome (Chromium-based)
- Full support for all features
- COOP/COEP headers must be set for SharedArrayBuffer

## Testing Browser Compatibility

To test browser compatibility in your environment:

1. Open the demo page in different browsers
2. Check the browser console for any errors
3. Call `getSystemHealth()` to see which features are available
4. Run a full session and check the verdict
5. Compare signal flags across browsers

## Future Browser Support

The Aegis Lens team monitors browser API changes and will update the SDK as new APIs become available. Planned improvements:

- **Firefox**: Will adopt `requestVideoFrameCallback` when available
- **Safari**: Working on improved camera API support
- **Mobile**: Optimizing for mobile-specific constraints

For the latest browser support information, check the GitHub issues and release notes.
