package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

// Mock session data for integration testing
type mockSession struct {
	SessionID      string
	PublicKeyPEM   string
	Nonce          []byte
	ClientNonce    []byte
	ServerNonce    []byte
	CreatedAt      time.Time
}

// Mock storage for testing
type mockStorage struct {
	sessions map[string]*mockSession
}

func newMockStorage() *mockStorage {
	return &mockStorage{
		sessions: make(map[string]*mockSession),
	}
}

func (m *mockStorage) GetSession(sessionID string) (*mockSession, bool) {
	session, ok := m.sessions[sessionID]
	return session, ok
}

func (m *mockStorage) SetSession(sessionID string, session *mockSession) {
	m.sessions[sessionID] = session
}

func TestSessionVerifyHandler_Integration(t *testing.T) {
	// Setup mock storage
	storage := newMockStorage()
	
	// Create a test session
	testSession := &mockSession{
		SessionID:    "test-session-123",
		PublicKeyPEM: "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE/test/public/key/here\n-----END PUBLIC KEY-----",
		Nonce:       []byte{0x01, 0x02, 0x03, 0x04},
		ClientNonce: []byte{0x11, 0x12, 0x13, 0x14},
		ServerNonce: []byte{0x21, 0x22, 0x23, 0x24},
		CreatedAt:   time.Now(),
	}
	storage.SetSession(testSession.SessionID, testSession)

	// Create handler with mock dependencies
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

	// Create test router
	r := chi.NewRouter()
	handler.RegisterRoutes(r)

	// Test case 1: Valid session with good telemetry
	t.Run("Valid session with good telemetry", func(t *testing.T) {
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
		req := httptest.NewRequest("POST", "/api/v2/session/verify", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()

		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("Expected status 200, got %d", w.Code)
		}

		var response map[string]interface{}
		json.Unmarshal(w.Body.Bytes(), &response)

		if response["verdict"] != "CLEAR" {
			t.Errorf("Expected CLEAR verdict, got %v", response["verdict"])
		}
	})

	// Test case 2: Invalid session ID
	t.Run("Invalid session ID", func(t *testing.T) {
		payload := map[string]interface{}{
			"session_id": "invalid-session",
			"timestamp":  time.Now().UnixMilli(),
			"telemetry": map[string]interface{}{},
			"signature": "mock-signature",
		}

		body, _ := json.Marshal(payload)
		req := httptest.NewRequest("POST", "/api/v2/session/verify", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()

		r.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("Expected status 400, got %d", w.Code)
		}
	})

	// Test case 3: Clock skew detection
	t.Run("Clock skew detection", func(t *testing.T) {
		payload := map[string]interface{}{
			"session_id": testSession.SessionID,
			"timestamp":  time.Now().Add(-60 * time.Second).UnixMilli(), // 60 seconds ago
			"telemetry": map[string]interface{}{
				"variance_score": 150.0,
			},
			"signature": "mock-signature",
		}

		body, _ := json.Marshal(payload)
		req := httptest.NewRequest("POST", "/api/v2/session/verify", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()

		r.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("Expected status 400 for clock skew, got %d", w.Code)
		}
	})
}
