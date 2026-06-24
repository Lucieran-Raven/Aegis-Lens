# Aegis Lens v2.0 - Go Backend Dockerfile
# Multi-stage build for optimized production image

# Stage 1: Build stage - Compile Go application
FROM golang:1.21-alpine AS builder

WORKDIR /build

# Install build dependencies
RUN apk add --no-cache git ca-certificates

# Copy go.mod and go.sum for dependency caching
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy source code
COPY . .

# Build Go application with optimizations
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-w -s -extldflags '-static'" \
    -a -installsuffix cgo \
    -o aegis-backend \
    ./main.go

# Stage 2: Production stage - Minimal runtime image
FROM alpine:latest AS production

WORKDIR /app

# Install ca-certificates for HTTPS
RUN apk --no-cache add ca-certificates tzdata

# Copy binary from builder
COPY --from=builder /build/aegis-backend .

# Copy migration files
COPY migrations ./migrations

# Create non-root user for security
RUN addgroup -g 1001 -S aegis && \
    adduser -u 1001 -S aegis -G aegis

USER aegis

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Set environment variables
ENV GIN_MODE=release
ENV PORT=8080

# Expose port
EXPOSE 8080

# Run the application
CMD ["./aegis-backend"]

# Stage 3: Development stage - For local development
FROM golang:1.21-alpine AS development

WORKDIR /app

# Install development dependencies
RUN apk add --no-cache git make

# Copy all files
COPY . .

# Install dependencies
RUN go mod download

# Set development environment
ENV GIN_MODE=debug
ENV PORT=8080

# Run with hot reload using air (if installed) or direct go run
CMD ["go", "run", "main.go"]

# Stage 4: Test stage - For running tests
FROM golang:1.21-alpine AS test

WORKDIR /build

# Install test dependencies
RUN apk add --no-cache git

# Copy source code
COPY . .

# Install dependencies
RUN go mod download

# Run tests
RUN go test -v ./...

# Stage 5: Benchmark stage - For performance testing
FROM golang:1.21-alpine AS benchmark

WORKDIR /build

# Install benchmark dependencies
RUN apk add --no-cache git

# Copy source code
COPY . .

# Install dependencies
RUN go mod download

# Run benchmarks
RUN go test -bench=. -benchmem ./internal/api/handlers/
