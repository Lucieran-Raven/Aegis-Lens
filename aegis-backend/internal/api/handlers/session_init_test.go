package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/aegis-lens/backend/internal/storage"
	"github.com/go-chi/chi/v5"
)

// Mock RedisClient for testing
type mockRedisClient struct {
	sessions map[string]*storage.SessionData
}

func newMockRedisClient() *mockRedisClient {
	return &mockRedisClient{
		sessions: make(map[string]*storage.SessionData),
	}
}

func (m *mockRedisClient) StoreSession(ctx context.Context, session *storage.SessionData) error {
	m.sessions[session.SessionID] = session
	return nil
}

func (m *mockRedisClient) GetSession(ctx context.Context, sessionID string) (*storage.SessionData, error) {
	session, exists := m.sessions[sessionID]
	if !exists {
		return nil, fmt.Errorf("session not found")
	}
	return session, nil
}

func (m *mockRedisClient) UpdatePublicKey(ctx context.Context, sessionID string, publicKeyPEM string) error {
	if session, exists := m.sessions[sessionID]; exists {
		session.PublicKeyPEM = publicKeyPEM
		return nil
	}
	return fmt.Errorf("session not found")
}

func (m *mockRedisClient) DeleteSession(ctx context.Context, sessionID string) error {
	delete(m.sessions, sessionID)
	return nil
}

func (m *mockRedisClient) Close() error {
	return nil
}

func (m *mockRedisClient) Ping(ctx context.Context) error {
	return nil
}

func TestSessionInitHandler_ServeHTTP(t *testing.T) {
	mockRedis := newMockRedisClient()
	handler := NewSessionInitHandler(mockRedis)

	tests := []struct {
		name           string
		method         string
		body           interface{}
		wantStatusCode int
		wantError      bool
	}{
		{
			name: "Valid session init request",
			method: http.MethodPost,
			body: SessionInitRequest{
				ClientID:          "test_client_123",
				DeviceFingerprint: "fp_abc123",
				UserAgent:         "Mozilla/5.0",
				Timestamp:         1234567890,
			},
			wantStatusCode: http.StatusOK,
			wantError:      false,
		},
		{
			name:           "Invalid method - GET",
			method:         http.MethodGet,
			body:           nil,
			wantStatusCode: http.StatusMethodNotAllowed,
			wantError:      true,
		},
		{
			name:   "Missing client_id",
			method: http.MethodPost,
			body: SessionInitRequest{
				ClientID:          "",
				DeviceFingerprint: "fp_abc123",
				UserAgent:         "Mozilla/5.0",
				Timestamp:         1234567890,
			},
			wantStatusCode: http.StatusBadRequest,
			wantError:      true,
		},
		{
			name:   "Missing device_fingerprint",
			method: http.MethodPost,
			body: SessionInitRequest{
				ClientID:          "test_client_123",
				DeviceFingerprint: "",
				UserAgent:         "Mozilla/5.0",
				Timestamp:         1234567890,
			},
			wantStatusCode: http.StatusBadRequest,
			wantError:      true,
		},
		{
			name:           "Invalid JSON body",
			method:         http.MethodPost,
			body:           "invalid json",
			wantStatusCode: http.StatusBadRequest,
			wantError:      true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var bodyBytes []byte
			var err error

			if tt.body != nil {
				if strBody, ok := tt.body.(string); ok {
					bodyBytes = []byte(strBody)
				} else {
					bodyBytes, err = json.Marshal(tt.body)
					if err != nil {
						t.Fatalf("Failed to marshal request body: %v", err)
					}
				}
			} else {
				bodyBytes = []byte("{}")
			}

			req := httptest.NewRequest(tt.method, "/api/v2/session/init", bytes.NewBuffer(bodyBytes))
			w := httptest.NewRecorder()

			handler.ServeHTTP(w, req)

			if w.Code != tt.wantStatusCode {
				t.Errorf("ServeHTTP() status = %v, want %v", w.Code, tt.wantStatusCode)
			}

			if !tt.wantError && w.Code != http.StatusOK {
				t.Errorf("ServeHTTP() expected success, got status %v", w.Code)
			}

			if tt.wantStatusCode == http.StatusOK {
				var resp SessionInitResponse
				if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
					t.Errorf("Failed to decode response: %v", err)
				}

				if resp.SessionID == "" {
					t.Error("Response should contain session_id")
				}
				if len(resp.Nonce) != 64 {
					t.Errorf("Nonce should be 64 hex chars (32 bytes), got %d", len(resp.Nonce))
				}
				if resp.TTLSeconds != 300 {
					t.Errorf("TTL should be 300, got %d", resp.TTLSeconds)
				}
			}
		})
	}
}

func TestSessionInitHandler_RegisterRoutes(t *testing.T) {
	mockRedis := newMockRedisClient()
	handler := NewSessionInitHandler(mockRedis)

	// This test just ensures RegisterRoutes doesn't panic
	// In a real test, you'd verify the route is registered correctly
	r := chi.NewRouter()
	handler.RegisterRoutes(r)
}
