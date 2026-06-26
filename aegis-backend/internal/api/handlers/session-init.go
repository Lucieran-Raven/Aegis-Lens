package handlers

import (
	"context"
	"crypto/rand"
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
	UserAgent         string `json:"user_agent"`
	Timestamp         int64  `json:"timestamp"`
}

type SessionInitResponse struct {
	SessionID       string `json:"session_id"`
	Nonce           []byte `json:"nonce"`
	ServerTimestamp int64  `json:"server_timestamp"`
	TTLSeconds      int32  `json:"ttl_seconds"`
}

func (h *SessionInitHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req SessionInitRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	if req.ClientID == "" {
		http.Error(w, "client_id is required", http.StatusBadRequest)
		return
	}

	if req.DeviceFingerprint == "" {
		http.Error(w, "device_fingerprint is required", http.StatusBadRequest)
		return
	}

	sessionID := uuid.New().String()

	nonce := make([]byte, 4)
	if _, err := rand.Read(nonce); err != nil {
		http.Error(w, "Failed to generate nonce", http.StatusInternalServerError)
		return
	}

	now := time.Now()
	expiresAt := now.Add(5 * time.Minute)

	session := &storage.SessionData{
		SessionID:         sessionID,
		ClientID:          req.ClientID,
		DeviceFingerprint: req.DeviceFingerprint,
		Nonce:             nonce,
		PublicKeyPEM:      "",
		CreatedAt:         now,
		ExpiresAt:         expiresAt,
	}

	ctx := r.Context()
	if err := h.redisClient.StoreSession(ctx, session); err != nil {
		http.Error(w, fmt.Sprintf("Failed to store session: %v", err), http.StatusInternalServerError)
		return
	}

	resp := SessionInitResponse{
		SessionID:       sessionID,
		Nonce:           nonce,
		ServerTimestamp: now.UnixMilli(),
		TTLSeconds:      300,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
		return
	}
}

func (h *SessionInitHandler) RegisterRoutes(r chi.Router) {
	r.Post("/api/v2/session/init", h.ServeHTTP)
}
