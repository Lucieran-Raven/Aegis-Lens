package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/go-redis/redis/v8"
)

const (
	SessionTTL = 5 * time.Minute
)

type RedisClient struct {
	client *redis.Client
}

type SessionData struct {
	SessionID        string    `json:"session_id"`
	ClientID         string    `json:"client_id"`
	DeviceFingerprint string   `json:"device_fingerprint"`
	Nonce            []byte    `json:"nonce"`
	PublicKeyPEM     string    `json:"public_key_pem"`
	CreatedAt        time.Time `json:"created_at"`
	ExpiresAt        time.Time `json:"expires_at"`
}

func NewRedisClient(addr string) (*RedisClient, error) {
	rdb := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: "",
		DB:       0,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := rdb.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("failed to connect to Redis: %w", err)
	}

	return &RedisClient{client: rdb}, nil
}

func (r *RedisClient) StoreSession(ctx context.Context, session *SessionData) error {
	key := fmt.Sprintf("session:%s", session.SessionID)
	
	data, err := json.Marshal(session)
	if err != nil {
		return fmt.Errorf("failed to marshal session data: %w", err)
	}

	if err := r.client.Set(ctx, key, data, SessionTTL).Err(); err != nil {
		return fmt.Errorf("failed to store session: %w", err)
	}

	return nil
}

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

func (r *RedisClient) ValidateNonce(ctx context.Context, sessionID string, nonce []byte) (bool, error) {
	session, err := r.GetSession(ctx, sessionID)
	if err != nil {
		return false, err
	}

	if len(session.Nonce) != len(nonce) {
		return false, nil
	}

	var result byte
	for i := 0; i < len(nonce); i++ {
		result |= session.Nonce[i] ^ nonce[i]
	}

	return result == 0, nil
}

func (r *RedisClient) UpdatePublicKey(ctx context.Context, sessionID string, publicKeyPEM string) error {
	session, err := r.GetSession(ctx, sessionID)
	if err != nil {
		return err
	}

	session.PublicKeyPEM = publicKeyPEM
	return r.StoreSession(ctx, session)
}

func (r *RedisClient) DeleteSession(ctx context.Context, sessionID string) error {
	key := fmt.Sprintf("session:%s", sessionID)
	return r.client.Del(ctx, key).Err()
}

func (r *RedisClient) Close() error {
	return r.client.Close()
}

func (r *RedisClient) Ping(ctx context.Context) error {
	return r.client.Ping(ctx).Err()
}
