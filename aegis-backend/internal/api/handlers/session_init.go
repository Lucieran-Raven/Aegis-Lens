package handlers

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// SessionInitHandler handles POST /api/v2/session/init
// Generates cryptographic 4-byte nonces and session IDs
type SessionInitHandler struct {
	redisClient RedisClient
}

// RedisClient interface for dependency injection
type RedisClient interface {
	StoreSession(ctx context.Context, session *SessionData) error
}

// SessionData represents the session to be stored
type SessionData struct {
	SessionID         string
	ClientID          string
	DeviceFingerprint string
	Nonce             []byte
	PublicKeyPEM      string
	CreatedAt         time.Time
	ExpiresAt         time.Time
}

// NewSessionInitHandler creates a new session initialization handler
func NewSessionInitHandler(redisClient RedisClient) *SessionInitHandler {
	return &SessionInitHandler{
		redisClient: redisClient,
	}
}

// SessionInitRequest payload
type SessionInitRequest struct {
	ClientID          string `json:"client_id"`
	DeviceFingerprint string `json:"device_fingerprint"`
	UserAgent         string `json:"user_agent"`
	Timestamp         int64  `json:"timestamp"`
}

// SessionInitResponse payload
type SessionInitResponse struct {
	SessionID       string `json:"session_id"`
	Nonce           []byte `json:"nonce"`           // 4-byte random nonce
	ServerTimestamp int64  `json:"server_timestamp"`
	TTLSeconds      int32  `json:"ttl_seconds"`
}

func (h *SessionInitHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Only accept POST
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse request body
	var req SessionInitRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	// Validate required fields
	if req.ClientID == "" {
		http.Error(w, "client_id is required", http.StatusBadRequest)
		return
	}

	if req.DeviceFingerprint == "" {
		http.Error(w, "device_fingerprint is required", http.StatusBadRequest)
		return
	}

	// Generate session ID
	sessionID := uuid.New().String()

	// Generate 4-byte cryptographic nonce
	nonce := make([]byte, 4)
	if _, err := rand.Read(nonce); err != nil {
		http.Error(w, "Failed to generate nonce", http.StatusInternalServerError)
		return
	}

	// Calculate expiration (5 minutes from now)
	now := time.Now()
	expiresAt := now.Add(5 * time.Minute)

	// Create session data
	session := &SessionData{
		SessionID:         sessionID,
		ClientID:          req.ClientID,
		DeviceFingerprint: req.DeviceFingerprint,
		Nonce:             nonce,
		PublicKeyPEM:      "", // Will be set when client submits public key
		CreatedAt:         now,
		ExpiresAt:         expiresAt,
	}

	// Store session in Redis
	ctx := r.Context()
	if err := h.redisClient.StoreSession(ctx, session); err != nil {
		http.Error(w, fmt.Sprintf("Failed to store session: %v", err), http.StatusInternalServerError)
		return
	}

	// Build response
	resp := SessionInitResponse{
		SessionID:       sessionID,
		Nonce:           nonce,
		ServerTimestamp: now.UnixMilli(),
		TTLSeconds:      300, // 5 minutes
	}

	// Send response
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(resp)
}

// RegisterRoutes registers the session initialization routes
func (h *SessionInitHandler) RegisterRoutes(r chi.Router) {
	r.Post("/api/v2/session/init", h.ServeHTTP)
}
