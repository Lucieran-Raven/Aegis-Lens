package handlers

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
)

type SessionVerifyHandler struct {
	redisClient RedisClient
	verifier    *SignatureVerifier
	engine      *ScoringEngine
}

func NewSessionVerifyHandler(redisClient RedisClient, verifier *SignatureVerifier) *SessionVerifyHandler {
	return &SessionVerifyHandler{
		redisClient: redisClient,
		verifier:    verifier,
		engine:      NewScoringEngine(DefaultThresholds()),
	}
}

type SessionVerifyRequest struct {
	Telemetry     TelemetryPayload `json:"telemetry"`
	Signature     []byte          `json:"signature"`
	PublicKeyPEM  string          `json:"public_key_pem"`
}

type TelemetryPayload struct {
	SessionID         string              `json:"session_id"`
	ClientTimestamp   int64               `json:"client_timestamp"`
	SessionNonce      string              `json:"session_nonce"`
	DeviceFingerprint string              `json:"device_fingerprint"`
	CameraTiming      *CameraTimingSignal `json:"camera_timing,omitempty"`
	Acoustic          *AcousticSignal     `json:"acoustic,omitempty"`
	EyeTracking       *EyeTrackingSignal `json:"eye_tracking,omitempty"`
	LipSync           *LipSyncSignal     `json:"lip_sync,omitempty"`
}

type CameraTimingSignal struct {
	Variance      float64   `json:"variance"`
	StdDev        float64   `json:"std_dev"`
	KLDivergence  float64   `json:"kl_divergence"`
	ShapiroWilkW  float64   `json:"shapiro_wilk_w"`
	SampleCount   int       `json:"sample_count"`
	FrameDeltas   []float64 `json:"frame_deltas"`
}

type AcousticSignal struct {
	TimeOfFlightMs        float64 `json:"time_of_flight_ms"`
	CorrelationPeak       float64 `json:"correlation_peak"`
	SpectralEntropy       float64 `json:"spectral_entropy"`
	PhaseSignatureValid   bool    `json:"phase_signature_valid"`
	SampleCount           int     `json:"sample_count"`
}

type EyeTrackingSignal struct {
	MicrosaccadeRate       float64 `json:"microsaccade_rate"`
	GlintParallaxVariance  float64 `json:"glint_parallax_variance"`
	LuminanceCorrelation   float64 `json:"luminance_correlation"`
	GazeSamples            int     `json:"gaze_samples"`
	Status                 string  `json:"status,omitempty"`
	Reason                 string  `json:"reason,omitempty"`
}

type LipSyncSignal struct {
	AudioVideoDriftMs      float64 `json:"audio_video_drift_ms"`
	LipVelocityCorrelation float64 `json:"lip_velocity_correlation"`
	MultiPersonDetected    bool    `json:"multi_person_detected"`
	SyncSamples            int     `json:"sync_samples"`
	Status                 string  `json:"status,omitempty"`
	Reason                 string  `json:"reason,omitempty"`
}

type SessionVerifyResponse struct {
	SessionID       string   `json:"session_id"`
	Verdict         string   `json:"verdict"`
	ConfidenceScore float64  `json:"confidence_score"`
	SignalFlags     []string `json:"signal_flags"`
	ServerTimestamp int64    `json:"server_timestamp"`
}

func getMaxClockSkew() time.Duration {
	maxSkewStr := os.Getenv("MAX_CLOCK_SKEW_SECONDS")
	if maxSkewStr == "" {
		return 5 * time.Second // default to 5 seconds
	}
	maxSkewSeconds, err := strconv.Atoi(maxSkewStr)
	if err != nil || maxSkewSeconds < 0 {
		return 5 * time.Second // default to 5 seconds on invalid value
	}
	return time.Duration(maxSkewSeconds) * time.Second
}

// validateTelemetry performs strict bounds checking on all telemetry numeric fields
func validateTelemetry(t *TelemetryPayload) error {
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
	requestID, _ := r.Context().Value("request_id").(string)
	if requestID == "" {
		requestID = "unknown"
	}

	if r.Method != http.MethodPost {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusMethodNotAllowed)
		json.NewEncoder(w).Encode(map[string]string{
			"error":      "method_not_allowed",
			"message":    "Method not allowed",
			"request_id": requestID,
		})
		return
	}

	var req SessionVerifyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{
			"error":      "invalid_request",
			"message":    fmt.Sprintf("Invalid request body: %v", err),
			"request_id": requestID,
		})
		return
	}

	if req.Telemetry.SessionID == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{
			"error":      "missing_field",
			"message":    "session_id is required",
			"request_id": requestID,
		})
		return
	}

	if err := validateTelemetry(&req.Telemetry); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{
			"error":      "invalid_telemetry",
			"message":    fmt.Sprintf("Invalid telemetry data: %v", err),
			"request_id": requestID,
		})
		return
	}

	ctx := r.Context()
	session, err := h.redisClient.GetSession(ctx, req.Telemetry.SessionID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{
			"error":      "invalid_session",
			"message":    "Invalid or expired session",
			"request_id": requestID,
		})
		return
	}

	// Validate nonce for replay protection
	if session.Nonce == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{
			"error":      "replay_attack",
			"message":    "Nonce already used - replay attack detected",
			"request_id": requestID,
		})
		return
	}
	if req.Telemetry.SessionNonce != session.Nonce {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{
			"error":      "replay_attack",
			"message":    "Invalid nonce - replay attack detected",
			"request_id": requestID,
		})
		return
	}

	// Validate public key matches session init to prevent key swapping
	if session.PublicKeyPEM == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{
			"error":      "key_mismatch",
			"message":    "Session has no associated public key",
			"request_id": requestID,
		})
		return
	}
	if req.PublicKeyPEM != session.PublicKeyPEM {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{
			"error":      "key_mismatch",
			"message":    "Public key does not match session",
			"request_id": requestID,
		})
		return
	}

	// Validate device fingerprint to detect device switching
	if req.Telemetry.DeviceFingerprint == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{
			"error":      "missing_field",
			"message":    "device_fingerprint is required",
			"request_id": requestID,
		})
		return
	}
	if req.Telemetry.DeviceFingerprint != session.DeviceFingerprint {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{
			"error":      "device_mismatch",
			"message":    "Device fingerprint mismatch detected",
			"request_id": requestID,
		})
		return
	}

	now := time.Now()
	clientTime := time.UnixMilli(req.Telemetry.ClientTimestamp)
	maxClockSkew := getMaxClockSkew()
	if now.Sub(clientTime) > maxClockSkew || clientTime.Sub(now) > maxClockSkew {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusRequestTimeout)
		json.NewEncoder(w).Encode(map[string]string{
			"error":      "clock_skew",
			"message":    "Clock skew exceeds maximum allowed",
			"request_id": requestID,
		})
		return
	}

	telemetryBytes, err := json.Marshal(req.Telemetry)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{
			"error":      "internal_error",
			"message":    "Failed to marshal telemetry",
			"request_id": requestID,
		})
		return
	}

	// Use session-stored public key for verification, not request key
	signatureValid, err := h.verifier.VerifySignature(session.PublicKeyPEM, req.Signature, telemetryBytes)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{
			"error":      "signature_error",
			"message":    fmt.Sprintf("Signature verification failed: %v", err),
			"request_id": requestID,
		})
		return
	}

	if !signatureValid {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{
			"error":      "invalid_signature",
			"message":    "Invalid signature",
			"request_id": requestID,
		})
		return
	}

	// Delete nonce after successful verification to prevent replay
	session.Nonce = ""
	if err := h.redisClient.StoreSession(ctx, session); err != nil {
		// Log error but continue - nonce deletion failure is non-critical for verification
		// In production, this should be logged to monitoring system
	}

	result := h.engine.Evaluate(ctx, &req.Telemetry)

	resp := SessionVerifyResponse{
		SessionID:       req.Telemetry.SessionID,
		Verdict:         string(result.Verdict),
		ConfidenceScore: result.ConfidenceScore,
		SignalFlags:     result.SignalFlags,
		ServerTimestamp: now.UnixMilli(),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{
			"error":      "internal_error",
			"message":    "Failed to encode response",
			"request_id": requestID,
		})
		return
	}
}

func (h *SessionVerifyHandler) RegisterRoutes(r chi.Router) {
	r.Post("/api/v2/session/verify", h.ServeHTTP)
}
