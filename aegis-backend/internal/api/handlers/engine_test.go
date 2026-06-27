package handlers

import (
	"context"
	"testing"
)

func TestScoringEngine_Evaluate(t *testing.T) {
	tests := []struct {
		name     string
		input    *TelemetryPayload
		wantVerdict Verdict
		wantMinScore float64
		wantMaxScore float64
	}{
		{
			name: "Clear physical camera with good timing",
			input: &TelemetryPayload{
				CameraTiming: &CameraTimingSignal{
					Variance:     100.0,
					StdDev:       10.0,
					KLDivergence: 0.05,
					ShapiroWilkW: 0.98,
					SampleCount:  89,
				},
				Acoustic: &AcousticSignal{
					TimeOfFlightMs:      5.0,
					CorrelationPeak:    0.95,
					SpectralEntropy:    2.0,
					PhaseSignatureValid: true,
					SampleCount:        1000,
				},
			},
			wantVerdict: VerdictClear,
			wantMinScore: 80.0,
			wantMaxScore: 100.0,
		},
		{
			name: "Virtual camera detected - low variance",
			input: &TelemetryPayload{
				CameraTiming: &CameraTimingSignal{
					Variance:     5.0,
					StdDev:       2.0,
					KLDivergence: 0.1,
					ShapiroWilkW: 0.95,
					SampleCount:  89,
				},
			},
			wantVerdict: VerdictBlocked,
			wantMinScore: 0.0,
			wantMaxScore: 50.0,
		},
		{
			name: "Instant audio loopback - virtual audio",
			input: &TelemetryPayload{
				Acoustic: &AcousticSignal{
					TimeOfFlightMs:      0.1,
					CorrelationPeak:    0.8,
					SpectralEntropy:    1.0,
					PhaseSignatureValid: true,
					SampleCount:        1000,
				},
			},
			wantVerdict: VerdictBlocked,
			wantMinScore: 60.0,
			wantMaxScore: 70.0,
		},
		{
			name: "Suspicious - unusual variance",
			input: &TelemetryPayload{
				CameraTiming: &CameraTimingSignal{
					Variance:     1000.0,
					StdDev:       31.0,
					KLDivergence: 0.8,
					ShapiroWilkW: 0.85,
					SampleCount:  89,
				},
			},
			wantVerdict: VerdictSuspicious,
			wantMinScore: 50.0,
			wantMaxScore: 79.0,
		},
		{
			name: "No signals provided - should be suspicious",
			input: &TelemetryPayload{
				CameraTiming: nil,
				Acoustic: nil,
				EyeTracking: nil,
				LipSync: nil,
			},
			wantVerdict: VerdictClear,
			wantMinScore: 50.0,
			wantMaxScore: 100.0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			engine := NewScoringEngine(DefaultThresholds())
			result := engine.Evaluate(context.Background(), tt.input)

			if result.Verdict != tt.wantVerdict {
				t.Errorf("Evaluate() Verdict = %v, want %v", result.Verdict, tt.wantVerdict)
			}

			if result.ConfidenceScore < tt.wantMinScore || result.ConfidenceScore > tt.wantMaxScore {
				t.Errorf("Evaluate() ConfidenceScore = %v, want between %v and %v", result.ConfidenceScore, tt.wantMinScore, tt.wantMaxScore)
			}
		})
	}
}

func TestScoringEngine_EvaluateCameraTiming(t *testing.T) {
	engine := NewScoringEngine(DefaultThresholds())

	tests := []struct {
		name string
		signal *CameraTimingSignal
		wantMinScore float64
		wantMaxScore float64
		wantFlags []string
	}{
		{
			name: "Good physical camera variance",
			signal: &CameraTimingSignal{
				Variance: 100.0,
				StdDev: 10.0,
				KLDivergence: 0.05,
				ShapiroWilkW: 0.98,
				SampleCount: 89,
			},
			wantMinScore: 10.0,
			wantMaxScore: 20.0,
			wantFlags: nil,
		},
		{
			name: "Virtual camera - low variance",
			signal: &CameraTimingSignal{
				Variance: 5.0,
				StdDev: 2.0,
				KLDivergence: 0.1,
				ShapiroWilkW: 0.95,
				SampleCount: 89,
			},
			wantMinScore: -50.0,
			wantMaxScore: -40.0,
			wantFlags: []string{"LOW_VARIANCE_VIRTUAL_CAM"},
		},
		{
			name: "High KL divergence",
			signal: &CameraTimingSignal{
				Variance: 100.0,
				StdDev: 10.0,
				KLDivergence: 0.8,
				ShapiroWilkW: 0.98,
				SampleCount: 89,
			},
			wantMinScore: -10.0,
			wantMaxScore: 0.0,
			wantFlags: []string{"HIGH_KL_DIVERGENCE"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			score, flags := engine.evaluateCameraTiming(tt.signal)

			if score < tt.wantMinScore || score > tt.wantMaxScore {
				t.Errorf("evaluateCameraTiming() score = %v, want between %v and %v", score, tt.wantMinScore, tt.wantMaxScore)
			}

			if tt.wantFlags != nil {
				flagFound := false
				for _, wantFlag := range tt.wantFlags {
					for _, gotFlag := range flags {
						if gotFlag == wantFlag {
							flagFound = true
							break
						}
					}
				}
				if !flagFound {
					t.Errorf("evaluateCameraTiming() flags = %v, want to contain %v", flags, tt.wantFlags)
				}
			}
		})
	}
}

func TestScoringEngine_EvaluateAcoustic(t *testing.T) {
	engine := NewScoringEngine(DefaultThresholds())

	tests := []struct {
		name string
		signal *AcousticSignal
		wantMinScore float64
		wantMaxScore float64
		wantFlags []string
	}{
		{
			name: "Good physical room ToF",
			signal: &AcousticSignal{
				TimeOfFlightMs: 5.0,
				CorrelationPeak: 0.95,
				SpectralEntropy: 2.0,
				PhaseSignatureValid: true,
				SampleCount: 1000,
			},
			wantMinScore: 20.0,
			wantMaxScore: 20.0,
			wantFlags: nil,
		},
		{
			name: "Instant loopback",
			signal: &AcousticSignal{
				TimeOfFlightMs: 0.1,
				CorrelationPeak: 0.8,
				SpectralEntropy: 1.0,
				PhaseSignatureValid: true,
				SampleCount: 1000,
			},
			wantMinScore: -40.0,
			wantMaxScore: -30.0,
			wantFlags: []string{"INSTANT_AUDIO_LOOPBACK"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			score, flags := engine.evaluateAcoustic(tt.signal)

			if score < tt.wantMinScore || score > tt.wantMaxScore {
				t.Errorf("evaluateAcoustic() score = %v, want between %v and %v", score, tt.wantMinScore, tt.wantMaxScore)
			}

			if tt.wantFlags != nil {
				flagFound := false
				for _, wantFlag := range tt.wantFlags {
					for _, gotFlag := range flags {
						if gotFlag == wantFlag {
							flagFound = true
							break
						}
					}
				}
				if !flagFound {
					t.Errorf("evaluateAcoustic() flags = %v, want to contain %v", flags, tt.wantFlags)
				}
			}
		})
	}
}
