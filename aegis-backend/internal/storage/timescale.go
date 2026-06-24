package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TimescaleClient handles TimescaleDB operations for audit logging
type TimescaleClient struct {
	pool *pgxpool.Pool
}

// VerificationEvent represents a verification event for audit logging
type VerificationEvent struct {
	SessionID       string    `json:"session_id"`
	ClientID        string    `json:"client_id"`
	Verdict         string    `json:"verdict"`
	ConfidenceScore float64   `json:"confidence_score"`
	SignalFlags     []string  `json:"signal_flags"`
	CameraVariance  *float64  `json:"camera_variance,omitempty"`
	AudioToF       *float64  `json:"audio_tof,omitempty"`
	Timestamp       time.Time `json:"timestamp"`
}

// NewTimescaleClient creates a new TimescaleDB connection pool
func NewTimescaleClient(connString string) (*TimescaleClient, error) {
	config, err := pgxpool.ParseConfig(connString)
	if err != nil {
		return nil, fmt.Errorf("failed to parse connection string: %w", err)
	}

	pool, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		return nil, fmt.Errorf("failed to create connection pool: %w", err)
	}

	// Test connection
	if err := pool.Ping(context.Background()); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	return &TimescaleClient{pool: pool}, nil
}

// InitializeSchema creates the necessary hypertables
func (t *TimescaleClient) InitializeSchema(ctx context.Context) error {
	queries := []string{
		// Create sessions hypertable
		`CREATE TABLE IF NOT EXISTS sessions (
			session_id TEXT PRIMARY KEY,
			client_id TEXT NOT NULL,
			device_fingerprint TEXT NOT NULL,
			public_key_pem TEXT,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			expires_at TIMESTAMPTZ NOT NULL
		)`,

		// Create verification_events hypertable
		`CREATE TABLE IF NOT EXISTS verification_events (
			id BIGSERIAL PRIMARY KEY,
			session_id TEXT NOT NULL REFERENCES sessions(session_id),
			verdict TEXT NOT NULL,
			confidence_score DOUBLE PRECISION NOT NULL,
			signal_flags JSONB,
			camera_variance DOUBLE PRECISION,
			audio_tof DOUBLE PRECISION,
			timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,

		// Convert sessions to hypertable
		`SELECT create_hypertable('sessions', 'created_at', if_not_exists => TRUE)`,

		// Convert verification_events to hypertable
		`SELECT create_hypertable('verification_events', 'timestamp', if_not_exists => TRUE)`,

		// Create indexes for performance
		`CREATE INDEX IF NOT EXISTS idx_sessions_client_id ON sessions(client_id)`,
		`CREATE INDEX IF NOT EXISTS idx_verification_events_session_id ON verification_events(session_id)`,
		`CREATE INDEX IF NOT EXISTS idx_verification_events_timestamp ON verification_events(timestamp DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_verification_events_verdict ON verification_events(verdict)`,
	}

	for _, query := range queries {
		if _, err := t.pool.Exec(ctx, query); err != nil {
			return fmt.Errorf("failed to execute schema query: %w", err)
		}
	}

	return nil
}

// StoreSession stores a session in the database
func (t *TimescaleClient) StoreSession(ctx context.Context, session *SessionData) error {
	query := `
		INSERT INTO sessions (session_id, client_id, device_fingerprint, public_key_pem, created_at, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (session_id) DO UPDATE SET
			public_key_pem = EXCLUDED.public_key_pem
	`

	_, err := t.pool.Exec(ctx, query,
		session.SessionID,
		session.ClientID,
		session.DeviceFingerprint,
		session.PublicKeyPEM,
		session.CreatedAt,
		session.ExpiresAt,
	)

	if err != nil {
		return fmt.Errorf("failed to store session: %w", err)
	}

	return nil
}

// LogVerificationEvent logs a verification event asynchronously
func (t *TimescaleClient) LogVerificationEvent(ctx context.Context, event *VerificationEvent) error {
	signalFlagsJSON, err := json.Marshal(event.SignalFlags)
	if err != nil {
		return fmt.Errorf("failed to marshal signal flags: %w", err)
	}

	query := `
		INSERT INTO verification_events (
			session_id, verdict, confidence_score, signal_flags,
			camera_variance, audio_tof, timestamp
		) VALUES ($1, $2, $3, $4, $5, $6, $7)
	`

	_, err = t.pool.Exec(ctx, query,
		event.SessionID,
		event.Verdict,
		event.ConfidenceScore,
		signalFlagsJSON,
		event.CameraVariance,
		event.AudioToF,
		event.Timestamp,
	)

	if err != nil {
		return fmt.Errorf("failed to log verification event: %w", err)
	}

	return nil
}

// LogVerificationEventAsync logs a verification event in a non-blocking goroutine
func (t *TimescaleClient) LogVerificationEventAsync(event *VerificationEvent) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		if err := t.LogVerificationEvent(ctx, event); err != nil {
			fmt.Printf("Async log failed: %v\n", err)
		}
	}()
}

// GetSessionEvents retrieves all verification events for a session
func (t *TimescaleClient) GetSessionEvents(ctx context.Context, sessionID string) ([]VerificationEvent, error) {
	query := `
		SELECT session_id, verdict, confidence_score, signal_flags,
			   camera_variance, audio_tof, timestamp
		FROM verification_events
		WHERE session_id = $1
		ORDER BY timestamp DESC
		LIMIT 100
	`

	rows, err := t.pool.Query(ctx, query, sessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to query session events: %w", err)
	}
	defer rows.Close()

	var events []VerificationEvent
	for rows.Next() {
		var event VerificationEvent
		var signalFlagsJSON []byte

		err := rows.Scan(
			&event.SessionID,
			&event.Verdict,
			&event.ConfidenceScore,
			&signalFlagsJSON,
			&event.CameraVariance,
			&event.AudioToF,
			&event.Timestamp,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan event row: %w", err)
		}

		if err := json.Unmarshal(signalFlagsJSON, &event.SignalFlags); err != nil {
			return nil, fmt.Errorf("failed to unmarshal signal flags: %w", err)
		}

		events = append(events, event)
	}

	return events, nil
}

// GetStats retrieves verification statistics
func (t *TimescaleClient) GetStats(ctx context.Context, timeRange time.Duration) (map[string]int64, error) {
	query := `
		SELECT verdict, COUNT(*) as count
		FROM verification_events
		WHERE timestamp > NOW() - $1::INTERVAL
		GROUP BY verdict
	`

	rows, err := t.pool.Query(ctx, query, timeRange.String())
	if err != nil {
		return nil, fmt.Errorf("failed to query stats: %w", err)
	}
	defer rows.Close()

	stats := make(map[string]int64)
	for rows.Next() {
		var verdict string
		var count int64
		if err := rows.Scan(&verdict, &count); err != nil {
			return nil, fmt.Errorf("failed to scan stats row: %w", err)
		}
		stats[verdict] = count
	}

	return stats, nil
}

// Close closes the connection pool
func (t *TimescaleClient) Close() {
	t.pool.Close()
}
