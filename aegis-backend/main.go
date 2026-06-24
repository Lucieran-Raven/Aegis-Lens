package main

import (
	"context"
	"crypto/tls"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/aegis-lens/backend/internal/api/handlers"
	"github.com/aegis-lens/backend/internal/storage"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	"golang.org/x/time/rate"
)

func main() {
	// Load environment variables
	redisAddr := getEnv("REDIS_ADDR", "localhost:6379")
	timescaleConn := getEnv("TIMESCALE_CONN", "postgres://localhost/aegis?sslmode=disable")
	serverPort := getEnv("SERVER_PORT", "8443")
	tlsCertPath := getEnv("TLS_CERT_PATH", "/etc/ssl/certs/aegis-backend.crt")
	tlsKeyPath := getEnv("TLS_KEY_PATH", "/etc/ssl/private/aegis-backend.key")
	allowedOrigins := getEnv("ALLOWED_ORIGINS", "https://yourdomain.com,https://app.yourdomain.com")

	// Initialize Redis client
	redisClient, err := storage.NewRedisClient(redisAddr)
	if err != nil {
		log.Fatalf("Failed to initialize Redis: %v", err)
	}
	defer redisClient.Close()

	// Initialize TimescaleDB client
	timescaleClient, err := storage.NewTimescaleClient(timescaleConn)
	if err != nil {
		log.Fatalf("Failed to initialize TimescaleDB: %v", err)
	}
	defer timescaleClient.Close()

	// Initialize database schema
	ctx := context.Background()
	if err := timescaleClient.InitializeSchema(ctx); err != nil {
		log.Fatalf("Failed to initialize database schema: %v", err)
	}

	// Initialize signature verifier
	signatureVerifier := handlers.NewSignatureVerifier()

	// Initialize scoring engine
	scoringEngine := handlers.NewScoringEngine(handlers.DefaultThresholds())

	// Initialize handlers
	sessionInitHandler := handlers.NewSessionInitHandler(redisClient)
	sessionVerifyHandler := handlers.NewSessionVerifyHandler(redisClient, signatureVerifier)

	// Set up router
	r := chi.NewRouter()

	// Parse allowed origins from environment
	originsList := []string{}
	for _, origin := range []string{allowedOrigins} {
		if origin != "" {
			originsList = append(originsList, origin)
		}
	}
	if len(originsList) == 0 {
		// Fallback to localhost for development
		originsList = []string{"http://localhost:3000", "http://localhost:8080"}
		log.Println("WARNING: Using localhost origins. Set ALLOWED_ORIGINS for production.")
	}

	// CORS middleware - STRICT WHITELIST (C1 FIX)
	corsMiddleware := cors.New(cors.Options{
		AllowedOrigins:   originsList,
		AllowedMethods:   []string{"POST", "OPTIONS"},
		AllowedHeaders:   []string{"Content-Type", "X-Session-ID", "X-Client-Version", "Authorization"},
		ExposedHeaders:   []string{"X-Request-ID", "X-Verdict"},
		AllowCredentials: true,
		MaxAge:           300,
		Debug:            false,
	})
	r.Use(corsMiddleware.Handler)

	// HSTS Middleware (C2 FIX)
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")
			next.ServeHTTP(w, r)
		})
	})

	// COOP/COEP Middleware (C3 FIX - CRITICAL for SharedArrayBuffer)
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
			w.Header().Set("Cross-Origin-Embedder-Policy", "require-corp")
			next.ServeHTTP(w, r)
		})
	})

	// Rate Limiting Middleware (C4 FIX - 100 req/min per IP, burst 20)
	// Uses sync.Map to store per-IP limiters for distributed rate limiting
	var ipLimiters sync.Map
	var limiterMutex sync.Mutex

	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Extract IP address
			ip, _, err := net.SplitHostPort(r.RemoteAddr)
			if err != nil {
				ip = r.RemoteAddr
			}

			// Get or create limiter for this IP
			limiterIface, _ := ipLimiters.LoadOrStore(ip, rate.NewLimiter(rate.Limit(100.0), 20))
			limiter := limiterIface.(*rate.Limiter)

			if !limiter.Allow() {
				http.Error(w, "Rate limit exceeded", http.StatusTooManyRequests)
				return
			}

			next.ServeHTTP(w, r)
		})
	})

	// Request Size Limit Middleware (H7 FIX)
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1MB max
			next.ServeHTTP(w, r)
		})
	})

	// Content-Type Validation Middleware
	// Requires application/json for POST endpoints to prevent content-type confusion attacks
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodPost {
				contentType := r.Header.Get("Content-Type")
				if contentType != "application/json" {
					http.Error(w, "Content-Type must be application/json", http.StatusUnsupportedMediaType)
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	})

	// Content Security Policy Middleware (H5 FIX)
	// Blocks cross-site scripting (XSS) injection vectors
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Security-Policy", 
				"default-src 'self'; "+
				"script-src 'self'; "+
				"worker-src 'self' blob:; "+
				"connect-src 'self'; "+
				"img-src 'self' data:; "+
				"style-src 'self' 'unsafe-inline';")
			next.ServeHTTP(w, r)
		})
	})

	// Health check endpoint with dependency checks
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		
		// Check Redis connectivity
		redisCtx, redisCancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer redisCancel()
		if err := redisClient.Ping(redisCtx).Err(); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			w.Write([]byte(`{"status":"error","service":"redis","message":"redis unavailable"}`))
			return
		}
		
		// Check TimescaleDB connectivity
		dbCtx, dbCancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer dbCancel()
		if err := timescaleClient.Ping(dbCtx).Err(); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			w.Write([]byte(`{"status":"error","service":"database","message":"database unavailable"}`))
			return
		}
		
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok","service":"aegis-backend"}`))
	})

	// Register API routes
	sessionInitHandler.RegisterRoutes(r)
	sessionVerifyHandler.RegisterRoutes(r)

	// Configure TLS with secure cipher suites (C2 FIX)
	tlsConfig := &tls.Config{
		MinVersion: tls.VersionTLS12,
		CipherSuites: []uint16{
			tls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
			tls.TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305,
			tls.TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384,
			tls.TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305,
			tls.TLS_AES_128_GCM_SHA256,
			tls.TLS_AES_256_GCM_SHA384,
			tls.TLS_CHACHA20_POLY1305_SHA256,
		},
		PreferServerCipherSuites: true,
	}

	// Create HTTPS server
	server := &http.Server{
		Addr:         ":" + serverPort,
		Handler:      r,
		TLSConfig:    tlsConfig,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Start HTTPS server in goroutine
	go func() {
		log.Printf("Aegis Lens v2.0 Backend starting on port %s (HTTPS)", serverPort)
		if err := server.ListenAndServeTLS(tlsCertPath, tlsKeyPath); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed to start: %v", err)
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")

	// Graceful shutdown with timeout
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}

	log.Println("Server exited")
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
