#!/bin/bash
# ci-repro.sh: Local CI environment simulation script
# Usage: ./ci-repro.sh

set -e

echo "=== CI Environment Reproduction Script ==="
echo "This script simulates the GitHub Actions CI environment locally"
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "ERROR: Docker is not running. Start Docker first."
    exit 1
fi

echo "✓ Docker is running"

# Pull Ubuntu 24.04 image (matches GitHub Actions runner)
echo "Pulling Ubuntu 24.04 image..."
docker pull ubuntu:24.04

echo ""
echo "=== Running CI Environment Simulation ==="
echo "This will start Ubuntu 24.04 with all required tools installed"
echo ""

# Run container with CI environment simulation
docker run --rm -it \
    -v "$(pwd):/workspace" \
    -w /workspace \
    ubuntu:24.04 bash -c "
        set -e
        echo '=== Installing CI Dependencies ==='
        apt-get update
        apt-get install -y curl git nodejs npm golang-go cargo rustc
        
        echo '=== Environment Versions ==='
        node --version
        npm --version
        go version
        cargo --version
        rustc --version
        
        echo '=== Running Environment Validation ==='
        bash .github/scripts/env_check.sh
        
        echo '=== Running Backend Tests ==='
        cd aegis-backend
        go vet ./...
        go test -v ./...
        go test -race ./...
        
        echo '=== Running SDK Tests ==='
        cd ../aegis-sdk
        npm ci --prefer-offline --no-audit
        npm run lint
        npm run type-check
        npm test
        
        echo '=== Running Rust WASM Build ==='
        cd src-rust
        cargo check --target wasm32-unknown-unknown
        
        echo '=== CI Simulation Complete ==='
    "

echo ""
echo "CI simulation completed successfully!"
