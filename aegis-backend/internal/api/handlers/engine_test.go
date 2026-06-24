package handlers

import (
	"testing"
	"time"
)

func TestScoringEngine_Integration(t *testing.T) {
	engine := &ScoringEngine{
		thresholds: ScoringThresholds{
			VarianceThreshold:      100.0,
			KLDivergenceThreshold:  0.5,
			ShapiroWilkThreshold:   0.8,
		},
	}

	t.Run("Clear verdict with good telemetry", func(t *testing.T) {
		telemetry := TelemetryPayload{
			VarianceScore:      150.0,
			KLDivergenceScore:  0.3,
			ShapiroWilkScore:   0.95,
			ToFMs:              5.0,
			GlintValid:         true,
			LipSyncValid:      true,
		}

		verdict := engine.Score(telemetry)

		if verdict != VerdictClear {
			t.Errorf("Expected CLEAR verdict, got %v", verdict)
		}
	})

	t.Run("Suspicious verdict with mixed signals", func(t *testing.T) {
		telemetry := TelemetryPayload{
			VarianceScore:      80.0,  // Below threshold
			KLDivergenceScore:  0.4,
			ShapiroWilkScore:   0.75,
			ToFMs:              15.0, // High ToF
			GlintValid:         false,
			LipSyncValid:      true,
		}

		verdict := engine.Score(telemetry)

		if verdict != VerdictSuspicious {
			t.Errorf("Expected SUSPICIOUS verdict, got %v", verdict)
		}
	})

	t.Run("Blocked verdict with multiple failures", func(t *testing.T) {
		telemetry := TelemetryPayload{
			VarianceScore:      10.0,  // Very low - virtual camera
			KLDivergenceScore:  0.9,  // High - suspicious
			ShapiroWilkScore:   0.3,  // Low - not normal
			ToFMs:              0.1,  // Instant - virtual audio
			GlintValid:         false,
			LipSyncValid:      false,
		}

		verdict := engine.Score(telemetry)

		if verdict != VerdictBlocked {
			t.Errorf("Expected BLOCKED verdict, got %v", verdict)
		}
	})

	t.Run("Custom thresholds", func(t *testing.T) {
		customEngine := &ScoringEngine{
			thresholds: ScoringThresholds{
				VarianceThreshold:      200.0,
				KLDivergenceThreshold:  0.8,
				ShapiroWilkThreshold:   0.9,
			},
		}

		telemetry := TelemetryPayload{
			VarianceScore:      150.0,
			KLDivergenceScore:  0.6,
			ShapiroWilkScore:   0.85,
			ToFMs:              5.0,
			GlintValid:         true,
			LipSyncValid:      true,
		}

		verdict := customEngine.Score(telemetry)

		// With higher thresholds, this should be SUSPICIOUS
		if verdict != VerdictSuspicious {
			t.Errorf("Expected SUSPICIOUS verdict with custom thresholds, got %v", verdict)
		}
	})
}

func TestScoringEngine_Performance(t *testing.T) {
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

	// Run 1000 iterations to measure performance
	iterations := 1000
	start := time.Now()

	for i := 0; i < iterations; i++ {
		engine.Score(telemetry)
	}

	duration := time.Since(start)
	avgDuration := duration / time.Duration(iterations)

	t.Logf("Average scoring time: %v per iteration", avgDuration)

	// Should complete in under 1ms per iteration
	if avgDuration > time.Millisecond {
		t.Errorf("Scoring too slow: %v per iteration (target: <1ms)", avgDuration)
	}
}
