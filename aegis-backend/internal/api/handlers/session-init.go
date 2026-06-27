package handlers

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/aegis-lens/backend/internal/storage"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type SessionInitHandler struct {
	redisClient RedisClient
}

type RedisClient interface {
	StoreSession(ctx context.Context, session *storage.SessionData) error
	GetSession(ctx context.Context, sessionID string) (*storage.SessionData, error)
	UpdatePublicKey(ctx context.Context, sessionID string, publicKeyPEM string) error
}

func NewSessionInitHandler(redisClient RedisClient) *SessionInitHandler {
	return &SessionInitHandler{
		redisClient: redisClient,
	}
}

type SessionInitRequest struct {
	ClientID          string `json:"client_id"`
	DeviceFingerprint string `json:"device_fingerprint"`
	PublicKeyPEM      string `json:"public_key_pem"`
	UserAgent         string `json:"user_agent"`
	Timestamp         int64  `json:"timestamp"`
}

type SessionInitResponse struct {
	SessionID       string `json:"session_id"`
	Nonce           string `json:"nonce"`
	ServerTimestamp int64  `json:"server_timestamp"`
	TTLSeconds      int32  `json:"ttl_seconds"`
}

func (h *SessionInitHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
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

	var req SessionInitRequest
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

	if req.ClientID == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{
			"error":      "missing_field",
			"message":    "client_id is required",
			"request_id": requestID,
		})
		return
	}

	if req.DeviceFingerprint == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{
			"error":      "missing_field",
			"message":    "device_fingerprint is required",
			"request_id": requestID,
		})
		return
	}

	if req.PublicKeyPEM == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{
			"error":      "missing_field",
			"message":    "public_key_pem is required",
			"request_id": requestID,
		})
		return
	}

	sessionID := uuid.New().String()

	nonce := make([]byte, 32)
	if _, err := rand.Read(nonce); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{
			"error":      "internal_error",
			"message":    "Failed to generate nonce",
			"request_id": requestID,
		})
		return
	}
	nonceHex := hex.EncodeToString(nonce)

	now := time.Now()
	expiresAt := now.Add(5 * time.Minute)

	session := &storage.SessionData{
		SessionID:         sessionID,
		ClientID:          req.ClientID,
		DeviceFingerprint: req.DeviceFingerprint,
		Nonce:             nonceHex,
		PublicKeyPEM:      req.PublicKeyPEM,
		CreatedAt:         now,
		ExpiresAt:         expiresAt,
	}

	ctx := r.Context()
	if err := h.redisClient.StoreSession(ctx, session); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{
			"error":      "internal_error",
			"message":    fmt.Sprintf("Failed to store session: %v", err),
			"request_id": requestID,
		})
		return
	}

	resp := SessionInitResponse{
		SessionID:       sessionID,
		Nonce:           nonceHex,
		ServerTimestamp: now.UnixMilli(),
		TTLSeconds:      300,
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

func (h *SessionInitHandler) RegisterRoutes(r chi.Router) {
	r.Post("/api/v2/session/init", h.ServeHTTP)
}
