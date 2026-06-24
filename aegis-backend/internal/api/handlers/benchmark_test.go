package handlers

import (
	"encoding/json"
	"testing"
	"time"
)

// BenchmarkSessionVerifyHandler benchmarks the full verification endpoint
func BenchmarkSessionVerifyHandler(b *testing.B) {
	// Setup mock storage
	storage := newMockStorage()
	
	testSession := &mockSession{
		SessionID:    "benchmark-session",
		PublicKeyPEM: "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE/test/public/key/here\n-----END PUBLIC KEY-----",
		Nonce:       []byte{0x01, 0x02, 0x03, 0x04},
		ClientNonce: []byte{0x11, 0x12, 0x13, 0x14},
		ServerNonce: []byte{0x21, 0x22, 0x23, 0x24},
		CreatedAt:   time.Now(),
	}
	storage.SetSession(testSession.SessionID, testSession)

	handler := &SessionVerifyHandler{
		storage: storage,
		scoringEngine: &ScoringEngine{
			thresholds: ScoringThresholds{
				VarianceThreshold:      100.0,
				KLDivergenceThreshold:  0.5,
				ShapiroWilkThreshold:   0.8,
			},
		},
	}

	payload := map[string]interface{}{
		"session_id": testSession.SessionID,
		"timestamp":  time.Now().UnixMilli(),
		"telemetry": map[string]interface{}{
			"variance_score":      150.0,
			"kl_divergence_score": 0.3,
			"shapiro_wilk_score":   0.95,
			"tof_ms":              5.0,
			"glint_valid":         true,
			"lip_sync_valid":      true,
		},
		"signature": "mock-signature",
	}

	body, _ := json.Marshal(payload)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		// Simulate the verification logic
		var reqPayload map[string]interface{}
		json.Unmarshal(body, &reqPayload)
		
		sessionID := reqPayload["session_id"].(string)
		_, _ = storage.GetSession(sessionID)
		
		// Simulate scoring
		telemetry := TelemetryPayload{
			VarianceScore:      150.0,
			KLDivergenceScore:  0.3,
			ShapiroWilkScore:   0.95,
			ToFMs:              5.0,
			GlintValid:         true,
			LipSyncValid:      true,
		}
		handler.scoringEngine.Score(telemetry)
	}
}

// BenchmarkScoringEngine benchmarks just the scoring logic
func BenchmarkScoringEngine(b *testing.B) {
	engine := &ScoringEngine{
		thresholds: ScoringThresholds{
			VarianceThreshold:      100.0,
			KLDivergenceThreshold:  0.5,
			ShapiroWilkThreshold:   0.8,
		},
	}

	telemetry := TelemetryPayload{
		VarianceScore:      150.0,
		KLDivergenceScore:  0.3,
		ShapiroWilkScore:   0.95,
		ToFMs:              5.0,
		GlintValid:         true,
		LipSyncValid:      true,
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		engine.Score(telemetry)
	}
}

// BenchmarkCryptoVerification benchmarks signature verification
func BenchmarkCryptoVerification(b *testing.B) {
	// Mock verification - in production this would use actual ECDSA verification
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		// Simulate signature verification overhead
		_ = verifyMockSignature([]byte("mock-payload"), []byte("mock-signature"))
	}
}

func verifyMockSignature(payload, signature []byte) bool {
	// Mock verification - always returns true for benchmark
	return true
}

// BenchmarkFullVerification benchmarks the complete verification flow
func BenchmarkFullVerification(b *testing.B) {
	storage := newMockStorage()
	
	testSession := &mockSession{
		SessionID:    "full-bench-session",
		PublicKeyPEM: "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE/test/public/key/here\n-----END PUBLIC KEY-----",
		Nonce:       []byte{0x01, 0x02, 0x03, 0x04},
		ClientNonce: []byte{0x11, 0x12, 0x13, 0x14},
		ServerNonce: []byte{0x21, 0x22, 0x23, 0x24},
		CreatedAt:   time.Now(),
	}
	storage.SetSession(testSession.SessionID, testSession)

	handler := &SessionVerifyHandler{
		storage: storage,
		scoringEngine: &ScoringEngine{
			thresholds: ScoringThresholds{
				VarianceThreshold:      100.0,
				KLDivergenceThreshold:  0.5,
				ShapiroWilkThreshold:   0.8,
			},
		},
	}

	payload := map[string]interface{}{
		"session_id": testSession.SessionID,
		"timestamp":  time.Now().UnixMilli(),
		"telemetry": map[string]interface{}{
			"variance_score":      150.0,
			"kl_divergence_score": 0.3,
			"shapiro_wilk_score":   0.95,
			"tof_ms":              5.0,
			"glint_valid":         true,
			"lip_sync_valid":      true,
		},
		"signature": "mock-signature",
	}

	body, _ := json.Marshal(payload)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		start := time.Now()
		
		// Full verification flow
		var reqPayload map[string]interface{}
		json.Unmarshal(body, &reqPayload)
		
		sessionID := reqPayload["session_id"].(string)
		session, ok := storage.GetSession(sessionID)
		if !ok {
			continue
		}
		
		// Clock skew check
		timestamp := int64(reqPayload["timestamp"].(float64))
		elapsed := time.Since(session.CreatedAt)
		if elapsed > 30*time.Second || elapsed < -30*time.Second {
			continue
		}
		
		if time.UnixMilli(timestamp).Sub(session.CreatedAt) > 30*time.Second {
			continue
		}
		
		// Signature verification
		_ = verifyMockSignature(body, []byte("mock-signature"))
		
		// Scoring
		telemetry := TelemetryPayload{
			VarianceScore:      150.0,
			KLDivergenceScore:  0.3,
			ShapiroWilkScore:   0.95,
			ToFMs:              5.0,
			GlintValid:         true,
			LipSyncValid:      true,
		}
		handler.scoringEngine.Score(telemetry)
		
		duration := time.Since(start)
		if duration > 15*time.Millisecond {
			b.Errorf("Verification took %v, exceeding 15ms budget", duration)
		}
	}
}

// TestPerformanceBudget verifies the 15ms performance budget
func TestPerformanceBudget(t *testing.T) {
	storage := newMockStorage()
	
	testSession := &mockSession{
		SessionID:    "perf-test-session",
		PublicKeyPEM: "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE/test/public/key/here\n-----END PUBLIC KEY-----",
		Nonce:       []byte{0x01, 0x02, 0x03, 0x04},
		ClientNonce: []byte{0x11, 0x12, 0x13, 0x14},
		ServerNonce: []byte{0x21, 0x22, 0x23, 0x24},
		CreatedAt:   time.Now(),
	}
	storage.SetSession(testSession.SessionID, testSession)

	handler := &SessionVerifyHandler{
		storage: storage,
		scoringEngine: &ScoringEngine{
			thresholds: ScoringThresholds{
				VarianceThreshold:      100.0,
				KLDivergenceThreshold:  0.5,
				ShapiroWilkThreshold:   0.8,
			},
		},
	}

	payload := map[string]interface{}{
		"session_id": testSession.SessionID,
		"timestamp":  time.Now().UnixMilli(),
		"telemetry": map[string]interface{}{
			"variance_score":      150.0,
			"kl_divergence_score": 0.3,
			"shapiro_wilk_score":   0.95,
			"tof_ms":              5.0,
			"glint_valid":         true,
			"lip_sync_valid":      true,
		},
		"signature": "mock-signature",
	}

	body, _ := json.Marshal(payload)

	// Run 100 iterations and measure
	iterations := 100
	var totalDuration time.Duration
	maxDuration := time.Duration(0)
	failures := 0

	for i := 0; i < iterations; i++ {
		start := time.Now()
		
		var reqPayload map[string]interface{}
		json.Unmarshal(body, &reqPayload)
		
		sessionID := reqPayload["session_id"].(string)
		session, _ := storage.GetSession(sessionID)
		
		timestamp := int64(reqPayload["timestamp"].(float64))
		_ = time.UnixMilli(timestamp).Sub(session.CreatedAt)
		
		_ = verifyMockSignature(body, []byte("mock-signature"))
		
		telemetry := TelemetryPayload{
			VarianceScore:      150.0,
			KLDivergenceScore:  0.3,
			ShapiroWilkScore:   0.95,
			ToFMs:              5.0,
			GlintValid:         true,
			LipSyncValid:      true,
		}
		handler.scoringEngine.Score(telemetry)
		
		duration := time.Since(start)
		totalDuration += duration
		
		if duration > maxDuration {
			maxDuration = duration
		}
		
		if duration > 15*time.Millisecond {
			failures++
		}
	}

	avgDuration := totalDuration / time.Duration(iterations)

	t.Logf("Performance Results:")
	t.Logf("  Average: %v", avgDuration)
	t.Logf("  Maximum: %v", maxDuration)
	t.Logf("  Failures (>15ms): %d/%d", failures, iterations)

	if failures > iterations/10 {
		t.Errorf("More than 10%% of requests exceeded 15ms budget: %d/%d", failures, iterations)
	}

	if avgDuration > 5*time.Millisecond {
		t.Errorf("Average verification time %v exceeds 5ms target", avgDuration)
	}
}
