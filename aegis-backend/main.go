package main

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
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
	redisAddr := getEnv("REDIS_ADDR", "localhost:6379")
	timescaleConn := getEnv("TIMESCALE_CONN", "postgres://localhost/aegis?sslmode=disable")
	serverPort := getEnv("SERVER_PORT", "8443")
	tlsCertPath := getEnv("TLS_CERT_PATH", "/etc/ssl/certs/aegis-backend.crt")
	tlsKeyPath := getEnv("TLS_KEY_PATH", "/etc/ssl/private/aegis-backend.key")
	allowedOrigins := getEnv("ALLOWED_ORIGINS", "https://yourdomain.com,https://app.yourdomain.com")

	redisClient, err := storage.NewRedisClient(redisAddr)
	if err != nil {
		log.Fatalf("Failed to initialize Redis: %v", err)
	}
	defer redisClient.Close()

	timescaleClient, err := storage.NewTimescaleClient(timescaleConn)
	if err != nil {
		log.Fatalf("Failed to initialize TimescaleDB: %v", err)
	}
	defer timescaleClient.Close()

	ctx := context.Background()
	if err := timescaleClient.InitializeSchema(ctx); err != nil {
		log.Fatalf("Failed to initialize database schema: %v", err)
	}

	signatureVerifier := handlers.NewSignatureVerifier()

	sessionInitHandler := handlers.NewSessionInitHandler(redisClient)
	sessionVerifyHandler := handlers.NewSessionVerifyHandler(redisClient, signatureVerifier)

	r := chi.NewRouter()

	corsOrigins := strings.Split(allowedOrigins, ",")
	originsList := []string{}
	for _, origin := range corsOrigins {
		origin = strings.TrimSpace(origin)
		if origin != "" {
			originsList = append(originsList, origin)
		}
	}
	if len(originsList) == 0 {
			originsList = []string{"http://localhost:3000", "http://localhost:8080"}
		log.Println("WARNING: Using localhost origins. Set ALLOWED_ORIGINS for production.")
	}

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

	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			requestID := generateRequestID()
			ctx := context.WithValue(r.Context(), "request_id", requestID)
			w.Header().Set("X-Request-ID", requestID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})

	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")
			next.ServeHTTP(w, r)
		})
	})

	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
			w.Header().Set("Cross-Origin-Embedder-Policy", "require-corp")
			next.ServeHTTP(w, r)
		})
	})

	var ipLimiters sync.Map
	var sessionInitLimiters sync.Map

	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip, _, err := net.SplitHostPort(r.RemoteAddr)
			if err != nil {
				ip = r.RemoteAddr
			}

			// Stricter rate limiting for session init endpoint
			if r.URL.Path == "/api/v2/session/init" {
				limiterIface, _ := sessionInitLimiters.LoadOrStore(ip, rate.NewLimiter(rate.Limit(10.0), 10))
				limiter := limiterIface.(*rate.Limiter)

				if !limiter.Allow() {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusTooManyRequests)
					w.Write([]byte(`{"error":"rate_limit_exceeded","message":"Too many session requests"}`))
					return
				}
			} else {
				// Standard rate limiting for other endpoints
				limiterIface, _ := ipLimiters.LoadOrStore(ip, rate.NewLimiter(rate.Limit(100.0), 20))
				limiter := limiterIface.(*rate.Limiter)

				if !limiter.Allow() {
					http.Error(w, "Rate limit exceeded", http.StatusTooManyRequests)
					return
				}
			}

			next.ServeHTTP(w, r)
		})
	})

	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1MB max
			next.ServeHTTP(w, r)
		})
	})

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

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		
		redisCtx, redisCancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer redisCancel()
		if err := redisClient.Ping(redisCtx); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"status":"error","service":"redis","message":"redis unavailable"}`))
			return
		}
		
		dbCtx, dbCancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer dbCancel()
		if err := timescaleClient.Ping(dbCtx); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"status":"error","service":"database","message":"database unavailable"}`))
			return
		}
		
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok","service":"aegis-backend"}`))
	})

	sessionInitHandler.RegisterRoutes(r)
	sessionVerifyHandler.RegisterRoutes(r)

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

	server := &http.Server{
		Addr:         ":" + serverPort,
		Handler:      r,
		TLSConfig:    tlsConfig,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		log.Printf("Aegis Lens v2.0 Backend starting on port %s (HTTPS)", serverPort)
		if err := server.ListenAndServeTLS(tlsCertPath, tlsKeyPath); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed to start: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")

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

func generateRequestID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}
