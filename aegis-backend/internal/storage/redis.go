package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/go-redis/redis/v8"
)

const (
	SessionTTL = 5 * time.Minute // Strict 5-minute TTL for ephemeral sessions
)

// RedisClient wraps the Redis client with Aegis-specific operations
type RedisClient struct {
	client *redis.Client
}

// SessionData represents the stored session state
type SessionData struct {
	SessionID        string    `json:"session_id"`
	ClientID         string    `json:"client_id"`
	DeviceFingerprint string   `json:"device_fingerprint"`
	Nonce            []byte    `json:"nonce"` // 4-byte crypto nonce
	PublicKeyPEM     string    `json:"public_key_pem"`
	CreatedAt        time.Time `json:"created_at"`
	ExpiresAt        time.Time `json:"expires_at"`
}

// NewRedisClient creates a new Redis client connection
func NewRedisClient(addr string) (*RedisClient, error) {
	rdb := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: "", // No password in dev, configure via env in prod
		DB:       0,  // Default DB
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := rdb.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("failed to connect to Redis: %w", err)
	}

	return &RedisClient{client: rdb}, nil
}

// StoreSession stores a new session with strict 5-minute TTL
func (r *RedisClient) StoreSession(ctx context.Context, session *SessionData) error {
	key := fmt.Sprintf("session:%s", session.SessionID)
	
	data, err := json.Marshal(session)
	if err != nil {
		return fmt.Errorf("failed to marshal session data: %w", err)
	}

	// Set with strict TTL
	if err := r.client.Set(ctx, key, data, SessionTTL).Err(); err != nil {
		return fmt.Errorf("failed to store session: %w", err)
	}

	return nil
}

// GetSession retrieves a session by ID
func (r *RedisClient) GetSession(ctx context.Context, sessionID string) (*SessionData, error) {
	key := fmt.Sprintf("session:%s", sessionID)
	
	data, err := r.client.Get(ctx, key).Bytes()
	if err != nil {
		if err == redis.Nil {
			return nil, fmt.Errorf("session not found or expired")
		}
		return nil, fmt.Errorf("failed to retrieve session: %w", err)
	}

	var session SessionData
	if err := json.Unmarshal(data, &session); err != nil {
		return nil, fmt.Errorf("failed to unmarshal session data: %w", err)
	}

	return &session, nil
}

// ValidateNonce checks if the provided nonce matches the stored session nonce
func (r *RedisClient) ValidateNonce(ctx context.Context, sessionID string, nonce []byte) (bool, error) {
	session, err := r.GetSession(ctx, sessionID)
	if err != nil {
		return false, err
	}

	// Constant-time comparison to prevent timing attacks
	if len(session.Nonce) != len(nonce) {
		return false, nil
	}

	var result byte
	for i := 0; i < len(nonce); i++ {
		result |= session.Nonce[i] ^ nonce[i]
	}

	return result == 0, nil
}

// UpdatePublicKey stores the client's ephemeral public key for signature verification
func (r *RedisClient) UpdatePublicKey(ctx context.Context, sessionID string, publicKeyPEM string) error {
	session, err := r.GetSession(ctx, sessionID)
	if err != nil {
		return err
	}

	session.PublicKeyPEM = publicKeyPEM
	return r.StoreSession(ctx, session)
}

// DeleteSession removes a session (for cleanup or revocation)
func (r *RedisClient) DeleteSession(ctx context.Context, sessionID string) error {
	key := fmt.Sprintf("session:%s", sessionID)
	return r.client.Del(ctx, key).Err()
}

// Close closes the Redis connection
func (r *RedisClient) Close() error {
	return r.client.Close()
}
