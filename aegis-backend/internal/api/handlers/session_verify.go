package handlers

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
)

// SessionVerifyHandler handles POST /api/v2/session/verify
// Features strict 30s clock-skew defenses and signature verification
type SessionVerifyHandler struct {
	redisClient RedisClient
	verifier    *SignatureVerifier
}

// NewSessionVerifyHandler creates a new session verification handler
func NewSessionVerifyHandler(redisClient RedisClient, verifier *SignatureVerifier) *SessionVerifyHandler {
	return &SessionVerifyHandler{
		redisClient: redisClient,
		verifier:    verifier,
	}
}

// SessionVerifyRequest payload
type SessionVerifyRequest struct {
	Telemetry     TelemetryPayload `json:"telemetry"`
	Signature     []byte          `json:"signature"`
	PublicKeyPEM  string          `json:"public_key_pem"`
}

// TelemetryPayload represents the forensic telemetry data
type TelemetryPayload struct {
	SessionID      string              `json:"session_id"`
	ClientTimestamp int64             `json:"client_timestamp"`
	CameraTiming   *CameraTimingSignal `json:"camera_timing,omitempty"`
	Acoustic       *AcousticSignal     `json:"acoustic,omitempty"`
	EyeTracking    *EyeTrackingSignal `json:"eye_tracking,omitempty"`
	LipSync        *LipSyncSignal     `json:"lip_sync,omitempty"`
}

// CameraTimingSignal represents Signal A data
type CameraTimingSignal struct {
	Variance      float64   `json:"variance"`
	StdDev        float64   `json:"std_dev"`
	KLDivergence  float64   `json:"kl_divergence"`
	ShapiroWilkW  float64   `json:"shapiro_wilk_w"`
	SampleCount   int       `json:"sample_count"`
	FrameDeltas   []float64 `json:"frame_deltas"`
}

// AcousticSignal represents Signal B data
type AcousticSignal struct {
	TimeOfFlightMs        float64 `json:"time_of_flight_ms"`
	CorrelationPeak       float64 `json:"correlation_peak"`
	SpectralEntropy       float64 `json:"spectral_entropy"`
	PhaseSignatureValid   bool    `json:"phase_signature_valid"`
	SampleCount           int     `json:"sample_count"`
}

// EyeTrackingSignal represents Signal C data
type EyeTrackingSignal struct {
	MicrosaccadeRate       float64 `json:"microsaccade_rate"`
	GlintParallaxVariance  float64 `json:"glint_parallax_variance"`
	LuminanceCorrelation   float64 `json:"luminance_correlation"`
	GazeSamples            int     `json:"gaze_samples"`
}

// LipSyncSignal represents Signal D data
type LipSyncSignal struct {
	AudioVideoDriftMs      float64 `json:"audio_video_drift_ms"`
	LipVelocityCorrelation float64 `json:"lip_velocity_correlation"`
	MultiPersonDetected    bool    `json:"multi_person_detected"`
	SyncSamples            int     `json:"sync_samples"`
}

// SessionVerifyResponse payload
type SessionVerifyResponse struct {
	SessionID       string   `json:"session_id"`
	Verdict         string   `json:"verdict"`
	ConfidenceScore float64  `json:"confidence_score"`
	SignalFlags     []string `json:"signal_flags"`
	ServerTimestamp int64    `json:"server_timestamp"`
}

const (
	MaxClockSkew = 30 * time.Second // Strict 30s clock-skew defense
)

// validateTelemetry performs strict bounds checking on all telemetry numeric fields
// CRITICAL FIX: Prevents NaN, Infinity, and out-of-bounds values from bypassing detection (H2)
func validateTelemetry(t *TelemetryPayload) error {
	// Validate Camera Timing Signal
	if t.CameraTiming != nil {
		if math.IsNaN(t.CameraTiming.Variance) || math.IsInf(t.CameraTiming.Variance, 0) {
			return fmt.Errorf("invalid camera timing variance: NaN or Infinity")
		}
		if t.CameraTiming.Variance < 0 || t.CameraTiming.Variance > 1000000 {
			return fmt.Errorf("camera timing variance out of valid range: %f", t.CameraTiming.Variance)
		}
		if math.IsNaN(t.CameraTiming.StdDev) || math.IsInf(t.CameraTiming.StdDev, 0) {
			return fmt.Errorf("invalid camera timing std_dev: NaN or Infinity")
		}
		if t.CameraTiming.StdDev < 0 || t.CameraTiming.StdDev > 1000 {
			return fmt.Errorf("camera timing std_dev out of valid range: %f", t.CameraTiming.StdDev)
		}
		if math.IsNaN(t.CameraTiming.KLDivergence) || math.IsInf(t.CameraTiming.KLDivergence, 0) {
			return fmt.Errorf("invalid camera timing kl_divergence: NaN or Infinity")
		}
		if t.CameraTiming.KLDivergence < 0 || t.CameraTiming.KLDivergence > 10 {
			return fmt.Errorf("camera timing kl_divergence out of valid range: %f", t.CameraTiming.KLDivergence)
		}
		if math.IsNaN(t.CameraTiming.ShapiroWilkW) || math.IsInf(t.CameraTiming.ShapiroWilkW, 0) {
			return fmt.Errorf("invalid camera timing shapiro_wilk_w: NaN or Infinity")
		}
		if t.CameraTiming.ShapiroWilkW < 0 || t.CameraTiming.ShapiroWilkW > 1 {
			return fmt.Errorf("camera timing shapiro_wilk_w out of valid range: %f", t.CameraTiming.ShapiroWilkW)
		}
		if t.CameraTiming.SampleCount < 0 || t.CameraTiming.SampleCount > 10000 {
			return fmt.Errorf("camera timing sample_count out of valid range: %d", t.CameraTiming.SampleCount)
		}
	}

	// Validate Acoustic Signal
	if t.Acoustic != nil {
		if math.IsNaN(t.Acoustic.TimeOfFlightMs) || math.IsInf(t.Acoustic.TimeOfFlightMs, 0) {
			return fmt.Errorf("invalid acoustic time_of_flight_ms: NaN or Infinity")
		}
		if t.Acoustic.TimeOfFlightMs < 0 || t.Acoustic.TimeOfFlightMs > 1000 {
			return fmt.Errorf("acoustic time_of_flight_ms out of valid range: %f", t.Acoustic.TimeOfFlightMs)
		}
		if math.IsNaN(t.Acoustic.CorrelationPeak) || math.IsInf(t.Acoustic.CorrelationPeak, 0) {
			return fmt.Errorf("invalid acoustic correlation_peak: NaN or Infinity")
		}
		if t.Acoustic.CorrelationPeak < -1 || t.Acoustic.CorrelationPeak > 1 {
			return fmt.Errorf("acoustic correlation_peak out of valid range: %f", t.Acoustic.CorrelationPeak)
		}
		if math.IsNaN(t.Acoustic.SpectralEntropy) || math.IsInf(t.Acoustic.SpectralEntropy, 0) {
			return fmt.Errorf("invalid acoustic spectral_entropy: NaN or Infinity")
		}
		if t.Acoustic.SpectralEntropy < 0 || t.Acoustic.SpectralEntropy > 10 {
			return fmt.Errorf("acoustic spectral_entropy out of valid range: %f", t.Acoustic.SpectralEntropy)
		}
		if t.Acoustic.SampleCount < 0 || t.Acoustic.SampleCount > 100000 {
			return fmt.Errorf("acoustic sample_count out of valid range: %d", t.Acoustic.SampleCount)
		}
	}

	// Validate Eye Tracking Signal
	if t.EyeTracking != nil {
		if math.IsNaN(t.EyeTracking.MicrosaccadeRate) || math.IsInf(t.EyeTracking.MicrosaccadeRate, 0) {
			return fmt.Errorf("invalid eye tracking microsaccade_rate: NaN or Infinity")
		}
		if t.EyeTracking.MicrosaccadeRate < 0 || t.EyeTracking.MicrosaccadeRate > 100 {
			return fmt.Errorf("eye tracking microsaccade_rate out of valid range: %f", t.EyeTracking.MicrosaccadeRate)
		}
		if math.IsNaN(t.EyeTracking.GlintParallaxVariance) || math.IsInf(t.EyeTracking.GlintParallaxVariance, 0) {
			return fmt.Errorf("invalid eye tracking glint_parallax_variance: NaN or Infinity")
		}
		if t.EyeTracking.GlintParallaxVariance < 0 || t.EyeTracking.GlintParallaxVariance > 10000 {
			return fmt.Errorf("eye tracking glint_parallax_variance out of valid range: %f", t.EyeTracking.GlintParallaxVariance)
		}
		if math.IsNaN(t.EyeTracking.LuminanceCorrelation) || math.IsInf(t.EyeTracking.LuminanceCorrelation, 0) {
			return fmt.Errorf("invalid eye tracking luminance_correlation: NaN or Infinity")
		}
		if t.EyeTracking.LuminanceCorrelation < -1 || t.EyeTracking.LuminanceCorrelation > 1 {
			return fmt.Errorf("eye tracking luminance_correlation out of valid range: %f", t.EyeTracking.LuminanceCorrelation)
		}
		if t.EyeTracking.GazeSamples < 0 || t.EyeTracking.GazeSamples > 10000 {
			return fmt.Errorf("eye tracking gaze_samples out of valid range: %d", t.EyeTracking.GazeSamples)
		}
	}

	// Validate Lip Sync Signal
	if t.LipSync != nil {
		if math.IsNaN(t.LipSync.AudioVideoDriftMs) || math.IsInf(t.LipSync.AudioVideoDriftMs, 0) {
			return fmt.Errorf("invalid lip sync audio_video_drift_ms: NaN or Infinity")
		}
		if t.LipSync.AudioVideoDriftMs < -1000 || t.LipSync.AudioVideoDriftMs > 1000 {
			return fmt.Errorf("lip sync audio_video_drift_ms out of valid range: %f", t.LipSync.AudioVideoDriftMs)
		}
		if math.IsNaN(t.LipSync.LipVelocityCorrelation) || math.IsInf(t.LipSync.LipVelocityCorrelation, 0) {
			return fmt.Errorf("invalid lip sync lip_velocity_correlation: NaN or Infinity")
		}
		if t.LipSync.LipVelocityCorrelation < -1 || t.LipSync.LipVelocityCorrelation > 1 {
			return fmt.Errorf("lip sync lip_velocity_correlation out of valid range: %f", t.LipSync.LipVelocityCorrelation)
		}
		if t.LipSync.SyncSamples < 0 || t.LipSync.SyncSamples > 10000 {
			return fmt.Errorf("lip sync sync_samples out of valid range: %d", t.LipSync.SyncSamples)
		}
	}

	return nil
}

func (h *SessionVerifyHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Only accept POST
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse request body
	var req SessionVerifyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	// Validate required fields
	if req.Telemetry.SessionID == "" {
		http.Error(w, "session_id is required", http.StatusBadRequest)
		return
	}

	// CRITICAL FIX: Validate telemetry numeric fields for NaN, Infinity, and bounds (H2)
	if err := validateTelemetry(&req.Telemetry); err != nil {
		http.Error(w, fmt.Sprintf("Invalid telemetry data: %v", err), http.StatusBadRequest)
		return
	}

	// Retrieve session from Redis
	ctx := r.Context()
	session, err := h.redisClient.GetSession(ctx, req.Telemetry.SessionID)
	if err != nil {
		http.Error(w, "Invalid or expired session", http.StatusUnauthorized)
		return
	}

	// Clock-skew defense
	now := time.Now()
	clientTime := time.UnixMilli(req.Telemetry.ClientTimestamp)
	if now.Sub(clientTime) > MaxClockSkew || clientTime.Sub(now) > MaxClockSkew {
		http.Error(w, "Clock skew exceeds maximum allowed", http.StatusRequestTimeout)
		return
	}

	// Verify signature
	telemetryBytes, err := json.Marshal(req.Telemetry)
	if err != nil {
		http.Error(w, "Failed to marshal telemetry", http.StatusInternalServerError)
		return
	}

	signatureValid, err := h.verifier.VerifySignature(req.PublicKeyPEM, req.Signature, telemetryBytes)
	if err != nil {
		http.Error(w, fmt.Sprintf("Signature verification failed: %v", err), http.StatusUnauthorized)
		return
	}

	if !signatureValid {
		http.Error(w, "Invalid signature", http.StatusUnauthorized)
		return
	}

	// Update public key in session if not already set
	if session.PublicKeyPEM == "" {
		err = h.redisClient.UpdatePublicKey(ctx, req.Telemetry.SessionID, req.PublicKeyPEM)
		if err != nil {
			// Log error but continue with verification
			fmt.Printf("Failed to update public key: %v\n", err)
		}
	}

	// Score the telemetry
	verdict, confidence, flags := h.scoreTelemetry(&req.Telemetry)

	// Build response
	resp := SessionVerifyResponse{
		SessionID:       req.Telemetry.SessionID,
		Verdict:         verdict,
		ConfidenceScore: confidence,
		SignalFlags:     flags,
		ServerTimestamp: now.UnixMilli(),
	}

	// Send response
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
		return
	}
}

// scoreTelemetry evaluates the telemetry and returns a verdict
func (h *SessionVerifyHandler) scoreTelemetry(telemetry *TelemetryPayload) (string, float64, []string) {
	var flags []string
	var confidence float64 = 100.0

	// Signal A: Camera timing entropy
	if telemetry.CameraTiming != nil {
		if telemetry.CameraTiming.Variance < 12.0 {
			flags = append(flags, "LOW_VARIANCE_VIRTUAL_CAM")
			confidence -= 50.0
		}
		if telemetry.CameraTiming.KLDivergence > 0.5 {
			flags = append(flags, "HIGH_KL_DIVERGENCE")
			confidence -= 20.0
		}
		if telemetry.CameraTiming.ShapiroWilkW < 0.9 {
			flags = append(flags, "NON_GAUSSIAN_DISTRIBUTION")
			confidence -= 15.0
		}
	}

	// Signal B: Acoustic Time-of-Flight
	if telemetry.Acoustic != nil {
		if telemetry.Acoustic.TimeOfFlightMs < 0.5 {
			flags = append(flags, "INSTANT_AUDIO_LOOPBACK")
			confidence -= 40.0
		}
		if telemetry.Acoustic.TimeOfFlightMs > 10.0 {
			flags = append(flags, "EXCESSIVE_AUDIO_DELAY")
			confidence -= 20.0
		}
		if !telemetry.Acoustic.PhaseSignatureValid {
			flags = append(flags, "INVALID_PHASE_SIGNATURE")
			confidence -= 30.0
		}
	}

	// Signal C: Eye tracking
	if telemetry.EyeTracking != nil {
		if telemetry.EyeTracking.MicrosaccadeRate < 0.5 {
			flags = append(flags, "LOW_MICROSACCADE_RATE")
			confidence -= 25.0
		}
		if telemetry.EyeTracking.GlintParallaxVariance < 0.1 {
			flags = append(flags, "ABSENT_GLINT_PARALLAX")
			confidence -= 35.0
		}
	}

	// Signal D: Lip-sync drift
	if telemetry.LipSync != nil {
		if telemetry.LipSync.AudioVideoDriftMs > 150.0 {
			flags = append(flags, "EXCESSIVE_AV_DRIFT")
			confidence -= 30.0
		}
		if telemetry.LipSync.MultiPersonDetected {
			flags = append(flags, "MULTI_PERSON_DETECTED")
			confidence -= 50.0
		}
	}

	// Determine verdict based on confidence
	var verdict string
	if confidence >= 80.0 {
		verdict = "CLEAR"
	} else if confidence >= 50.0 {
		verdict = "SUSPICIOUS"
	} else {
		verdict = "BLOCKED"
	}

	// Ensure confidence is within bounds
	if confidence < 0.0 {
		confidence = 0.0
	}
	if confidence > 100.0 {
		confidence = 100.0
	}

	return verdict, confidence, flags
}

// RegisterRoutes registers the session verification routes
func (h *SessionVerifyHandler) RegisterRoutes(r chi.Router) {
	r.Post("/api/v2/session/verify", h.ServeHTTP)
}
