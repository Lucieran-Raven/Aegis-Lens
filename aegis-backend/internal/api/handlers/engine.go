package handlers

import (
	"context"
	"fmt"
)

// ScoringEngine evaluates telemetry signals and outputs verdicts
type ScoringEngine struct {
	thresholds ScoringThresholds
}

// ScoringThresholds defines the scoring thresholds
type ScoringThresholds struct {
	// Camera timing thresholds
	VirtualCameraVarianceMax    float64 // Maximum variance for virtual camera detection (12 μs²)
	PhysicalVarianceMin         float64 // Minimum variance for physical camera (50 μs²)
	PhysicalVarianceMax         float64 // Maximum variance for physical camera (500 μs²)
	
	// Acoustic thresholds
	AudioLoopbackMaxMs         float64 // Maximum time for audio loopback (0.5ms)
	AudioDelayMaxMs            float64 // Maximum acceptable audio delay (10ms)
	
	// Eye tracking thresholds
	MicrosaccadeRateMin        float64 // Minimum microsaccade rate (0.5 Hz)
	GlintParallaxVarianceMin   float64 // Minimum glint parallax variance (0.1)
	
	// Lip-sync thresholds
	AVDriftMaxMs               float64 // Maximum audio-video drift (150ms)
}

// DefaultThresholds returns the default scoring thresholds
func DefaultThresholds() ScoringThresholds {
	return ScoringThresholds{
		VirtualCameraVarianceMax:   12.0,
		PhysicalVarianceMin:        50.0,
		PhysicalVarianceMax:        500.0,
		AudioLoopbackMaxMs:         0.5,
		AudioDelayMaxMs:            10.0,
		MicrosaccadeRateMin:        0.5,
		GlintParallaxVarianceMin:   0.1,
		AVDriftMaxMs:               150.0,
	}
}

// NewScoringEngine creates a new scoring engine
func NewScoringEngine(thresholds ScoringThresholds) *ScoringEngine {
	return &ScoringEngine{
		thresholds: thresholds,
	}
}

// Verdict represents the final verification verdict
type Verdict string

const (
	VerdictClear      Verdict = "CLEAR"
	VerdictSuspicious Verdict = "SUSPICIOUS"
	VerdictBlocked    Verdict = "BLOCKED"
)

// ScoreResult represents the scoring result
type ScoreResult struct {
	Verdict         Verdict
	ConfidenceScore float64
	SignalFlags     []string
	ScoreBreakdown  map[string]float64
}

// Evaluate evaluates the telemetry and returns a verdict
func (e *ScoringEngine) Evaluate(ctx context.Context, telemetry *TelemetryPayload) *ScoreResult {
	breakdown := make(map[string]float64)
	var flags []string
	confidence := 100.0

	// Evaluate Signal A: Camera timing entropy
	if telemetry.CameraTiming != nil {
		cameraScore, cameraFlags := e.evaluateCameraTiming(telemetry.CameraTiming)
		breakdown["camera_timing"] = cameraScore
		confidence += cameraScore
		flags = append(flags, cameraFlags...)
	}

	// Evaluate Signal B: Acoustic Time-of-Flight
	if telemetry.Acoustic != nil {
		acousticScore, acousticFlags := e.evaluateAcoustic(telemetry.Acoustic)
		breakdown["acoustic"] = acousticScore
		confidence += acousticScore
		flags = append(flags, acousticFlags...)
	}

	// Evaluate Signal C: Eye tracking
	if telemetry.EyeTracking != nil {
		eyeScore, eyeFlags := e.evaluateEyeTracking(telemetry.EyeTracking)
		breakdown["eye_tracking"] = eyeScore
		confidence += eyeScore
		flags = append(flags, eyeFlags...)
	}

	// Evaluate Signal D: Lip-sync
	if telemetry.LipSync != nil {
		lipScore, lipFlags := e.evaluateLipSync(telemetry.LipSync)
		breakdown["lip_sync"] = lipScore
		confidence += lipScore
		flags = append(flags, lipFlags...)
	}

	// Normalize confidence score
	// Start at 100, subtract penalties, ensure within bounds
	confidence = normalizeConfidence(confidence)

	// Determine verdict
	verdict := e.determineVerdict(confidence, flags)

	return &ScoreResult{
		Verdict:         verdict,
		ConfidenceScore: confidence,
		SignalFlags:     flags,
		ScoreBreakdown:  breakdown,
	}
}

// evaluateCameraTiming evaluates camera timing entropy
func (e *ScoringEngine) evaluateCameraTiming(signal *CameraTimingSignal) (float64, []string) {
	score := 0.0
	var flags []string

	// Check variance for virtual camera detection
	if signal.Variance < e.thresholds.VirtualCameraVarianceMax {
		score -= 50.0
		flags = append(flags, "LOW_VARIANCE_VIRTUAL_CAM")
	} else if signal.Variance >= e.thresholds.PhysicalVarianceMin && signal.Variance <= e.thresholds.PhysicalVarianceMax {
		// Good physical camera variance
		score += 10.0
	} else {
		// Unusual variance
		score -= 10.0
		flags = append(flags, "UNUSUAL_VARIANCE")
	}

	// Check KL divergence
	if signal.KLDivergence > 0.5 {
		score -= 20.0
		flags = append(flags, "HIGH_KL_DIVERGENCE")
	} else if signal.KLDivergence < 0.1 {
		score += 5.0
	}

	// Check Shapiro-Wilk W test
	if signal.ShapiroWilkW < 0.9 {
		score -= 15.0
		flags = append(flags, "NON_GAUSSIAN_DISTRIBUTION")
	} else if signal.ShapiroWilkW > 0.95 {
		score += 5.0
	}

	return score, flags
}

// evaluateAcoustic evaluates acoustic Time-of-Flight
func (e *ScoringEngine) evaluateAcoustic(signal *AcousticSignal) (float64, []string) {
	score := 0.0
	var flags []string

	// Check for instant loopback (virtual audio)
	if signal.TimeOfFlightMs < e.thresholds.AudioLoopbackMaxMs {
		score -= 40.0
		flags = append(flags, "INSTANT_AUDIO_LOOPBACK")
	} else if signal.TimeOfFlightMs >= 3.0 && signal.TimeOfFlightMs <= 10.0 {
		// Good physical room ToF
		score += 10.0
	} else if signal.TimeOfFlightMs > e.thresholds.AudioDelayMaxMs {
		// Excessive delay
		score -= 20.0
		flags = append(flags, "EXCESSIVE_AUDIO_DELAY")
	}

	// Check phase signature
	if !signal.PhaseSignatureValid {
		score -= 30.0
		flags = append(flags, "INVALID_PHASE_SIGNATURE")
	} else {
		score += 5.0
	}

	// Check correlation peak
	if signal.CorrelationPeak < 0.7 {
		score -= 10.0
		flags = append(flags, "LOW_CORRELATION_PEAK")
	} else if signal.CorrelationPeak > 0.9 {
		score += 5.0
	}

	return score, flags
}

// evaluateEyeTracking evaluates eye tracking data
func (e *ScoringEngine) evaluateEyeTracking(signal *EyeTrackingSignal) (float64, []string) {
	score := 0.0
	var flags []string

	// Check microsaccade rate
	if signal.MicrosaccadeRate < e.thresholds.MicrosaccadeRateMin {
		score -= 25.0
		flags = append(flags, "LOW_MICROSACCADE_RATE")
	} else if signal.MicrosaccadeRate > 1.0 && signal.MicrosaccadeRate < 3.0 {
		// Normal microsaccade rate
		score += 10.0
	}

	// Check glint parallax variance
	if signal.GlintParallaxVariance < e.thresholds.GlintParallaxVarianceMin {
		score -= 35.0
		flags = append(flags, "ABSENT_GLINT_PARALLAX")
	} else if signal.GlintParallaxVariance > 0.5 {
		// Good glint parallax
		score += 10.0
	}

	// Check luminance correlation
	if signal.LuminanceCorrelation < 0.5 {
		score -= 15.0
		flags = append(flags, "LOW_LUMINANCE_CORRELATION")
	} else if signal.LuminanceCorrelation > 0.8 {
		score += 5.0
	}

	return score, flags
}

// evaluateLipSync evaluates lip-sync drift
func (e *ScoringEngine) evaluateLipSync(signal *LipSyncSignal) (float64, []string) {
	score := 0.0
	var flags []string

	// Check audio-video drift
	if signal.AudioVideoDriftMs > e.thresholds.AVDriftMaxMs {
		score -= 30.0
		flags = append(flags, "EXCESSIVE_AV_DRIFT")
	} else if signal.AudioVideoDriftMs < 50.0 {
		// Good sync
		score += 10.0
	}

	// Check for multi-person detection
	if signal.MultiPersonDetected {
		score -= 50.0
		flags = append(flags, "MULTI_PERSON_DETECTED")
	}

	// Check lip velocity correlation
	if signal.LipVelocityCorrelation < 0.6 {
		score -= 15.0
		flags = append(flags, "LOW_LIP_VELOCITY_CORRELATION")
	} else if signal.LipVelocityCorrelation > 0.85 {
		score += 5.0
	}

	return score, flags
}

// determineVerdict determines the final verdict based on confidence and flags
func (e *ScoringEngine) determineVerdict(confidence float64, flags []string) Verdict {
	// Check for critical flags that immediately block
	criticalFlags := map[string]bool{
		"MULTI_PERSON_DETECTED":    true,
		"INSTANT_AUDIO_LOOPBACK":   true,
		"LOW_VARIANCE_VIRTUAL_CAM": true,
	}

	for _, flag := range flags {
		if criticalFlags[flag] {
			return VerdictBlocked
		}
	}

	// Determine verdict based on confidence
	if confidence >= 80.0 {
		return VerdictClear
	} else if confidence >= 50.0 {
		return VerdictSuspicious
	}
	return VerdictBlocked
}

// normalizeConfidence ensures confidence is within [0, 100]
func normalizeConfidence(confidence float64) float64 {
	if confidence < 0.0 {
		return 0.0
	}
	if confidence > 100.0 {
		return 100.0
	}
	return confidence
}

// GetThresholds returns the current thresholds
func (e *ScoringEngine) GetThresholds() ScoringThresholds {
	return e.thresholds
}

// SetThresholds updates the scoring thresholds
func (e *ScoringEngine) SetThresholds(thresholds ScoringThresholds) {
	e.thresholds = thresholds
}
