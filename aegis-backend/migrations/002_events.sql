-- Aegis Lens v2.0 - Events Migration
-- TimescaleDB hyper-table for forensic telemetry events
-- This table stores anonymized verification events for audit and analytics

-- Enable TimescaleDB extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Create events table for forensic telemetry
CREATE TABLE IF NOT EXISTS events (
    id BIGSERIAL PRIMARY KEY,
    session_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(32) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Anonymized telemetry scores (no PII)
    variance_score NUMERIC(10,2),
    kl_divergence_score NUMERIC(10,4),
    shapiro_wilk_score NUMERIC(5,4),
    
    -- Signal A: Camera Timing
    frame_count INTEGER,
    avg_frame_delta_us NUMERIC(10,2),
    frame_variance NUMERIC(10,2),
    
    -- Signal B: Audio ToF
    tof_ms NUMERIC(6,3),
    spectral_entropy NUMERIC(5,4),
    is_filtered BOOLEAN,
    is_virtual_audio BOOLEAN,
    
    -- Signal C: Eye Tracking
    glint_parallax_variance NUMERIC(10,4),
    microsaccade_rate NUMERIC(5,2),
    luminance_correlation NUMERIC(5,4),
    is_live_gaze BOOLEAN,
    
    -- Signal D: Lip Sync
    lip_velocity_avg NUMERIC(10,4),
    lip_sync_correlation NUMERIC(5,4),
    audio_video_drift_ms NUMERIC(6,3),
    is_lip_sync_valid BOOLEAN,
    
    -- Composite scoring
    composite_score NUMERIC(5,2),
    verdict VARCHAR(20) NOT NULL,
    
    -- Metadata (no PII)
    processing_time_ms NUMERIC(6,3),
    server_region VARCHAR(32),
    
    -- Foreign key to sessions (optional, for relationship)
    -- Note: Sessions may be deleted by retention policy, so this is nullable
    session_fk BIGINT REFERENCES sessions(id) ON DELETE SET NULL
);

-- Note: Hypertable conversion disabled for development
-- TimescaleDB requires partitioning column in primary key
-- Uncomment when schema is refactored for hypertable support
-- SELECT create_hypertable('events', 'timestamp', if_not_exists => TRUE);

-- Create indexes for fast queries
CREATE INDEX idx_events_session_id ON events(session_id);
CREATE INDEX idx_events_timestamp ON events(timestamp DESC);
CREATE INDEX idx_events_event_type ON events(event_type);
CREATE INDEX idx_events_verdict ON events(verdict);
CREATE INDEX idx_events_timestamp_session ON events(timestamp DESC, session_id);

-- Create composite index for common analytics queries
CREATE INDEX idx_events_session_timestamp ON events(session_id, timestamp DESC);

-- Note: Compression, retention, and continuous aggregates disabled for development
-- These require hypertable conversion
-- ALTER TABLE events SET (
--     timescaledb.compress,
--     timescaledb.compress_segmentby = 'session_id'
-- );
-- SELECT add_compression_policy('events', INTERVAL '1 hour');
-- SELECT add_retention_policy('events', INTERVAL '90 days');

-- Create function to log verification events
CREATE OR REPLACE FUNCTION log_verification_event(
    p_session_id VARCHAR,
    p_variance_score NUMERIC,
    p_kl_divergence_score NUMERIC,
    p_shapiro_wilk_score NUMERIC,
    p_tof_ms NUMERIC,
    p_spectral_entropy NUMERIC,
    p_is_filtered BOOLEAN,
    p_is_virtual_audio BOOLEAN,
    p_glint_parallax_variance NUMERIC,
    p_microsaccade_rate NUMERIC,
    p_luminance_correlation NUMERIC,
    p_is_live_gaze BOOLEAN,
    p_lip_velocity_avg NUMERIC,
    p_lip_sync_correlation NUMERIC,
    p_audio_video_drift_ms NUMERIC,
    p_is_lip_sync_valid BOOLEAN,
    p_composite_score NUMERIC,
    p_verdict VARCHAR,
    p_processing_time_ms NUMERIC
)
RETURNS BIGINT AS $$
DECLARE
    event_id BIGINT;
BEGIN
    INSERT INTO events (
        session_id,
        event_type,
        variance_score,
        kl_divergence_score,
        shapiro_wilk_score,
        tof_ms,
        spectral_entropy,
        is_filtered,
        is_virtual_audio,
        glint_parallax_variance,
        microsaccade_rate,
        luminance_correlation,
        is_live_gaze,
        lip_velocity_avg,
        lip_sync_correlation,
        audio_video_drift_ms,
        is_lip_sync_valid,
        composite_score,
        verdict,
        processing_time_ms
    ) VALUES (
        p_session_id,
        'verification',
        p_variance_score,
        p_kl_divergence_score,
        p_shapiro_wilk_score,
        p_tof_ms,
        p_spectral_entropy,
        p_is_filtered,
        p_is_virtual_audio,
        p_glint_parallax_variance,
        p_microsaccade_rate,
        p_luminance_correlation,
        p_is_live_gaze,
        p_lip_velocity_avg,
        p_lip_sync_correlation,
        p_audio_video_drift_ms,
        p_is_lip_sync_valid,
        p_composite_score,
        p_verdict,
        p_processing_time_ms
    )
    RETURNING id INTO event_id;
    
    RETURN event_id;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions (adjust based on your security model)
-- GRANT SELECT, INSERT ON events TO aegis_app;
-- GRANT SELECT ON events_hourly_stats TO aegis_app;
-- GRANT SELECT ON events_daily_stats TO aegis_app;
-- GRANT USAGE, SELECT ON SEQUENCE events_id_seq TO aegis_app;
-- GRANT EXECUTE ON FUNCTION log_verification_event TO aegis_app;

COMMENT ON TABLE events IS 'Aegis Lens forensic telemetry hyper-table with 90-day retention';
COMMENT ON COLUMN events.session_id IS 'Reference to session identifier';
COMMENT ON COLUMN events.event_type IS 'Event type: verification, init, error';
COMMENT ON COLUMN events.variance_score IS 'Frame timing variance score';
COMMENT ON COLUMN events.kl_divergence_score IS 'KL divergence against virtual camera reference';
COMMENT ON COLUMN events.shapiro_wilk_score IS 'Shapiro-Wilk normality test score';
COMMENT ON COLUMN events.tof_ms IS 'Acoustic time-of-flight in milliseconds';
COMMENT ON COLUMN events.spectral_entropy IS 'Audio spectral entropy';
COMMENT ON COLUMN events.verdict IS 'Final verdict: CLEAR, SUSPICIOUS, BLOCKED';
COMMENT ON COLUMN events.processing_time_ms IS 'Server processing time in milliseconds';
COMMENT ON MATERIALIZED VIEW events_hourly_stats IS 'Hourly aggregated statistics for analytics dashboard';
COMMENT ON MATERIALIZED VIEW events_daily_stats IS 'Daily aggregated statistics for long-term analytics';
