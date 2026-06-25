#!/bin/bash
set -e

echo "=== Environment Validation Check ==="

# Check required system binaries
check_binary() {
  if ! command -v "$1" &> /dev/null; then
    echo "MISSING_BINARY: $1"
    exit 1
  fi
  echo "✓ $1 found"
}

echo "Checking required binaries..."
check_binary "node"
check_binary "npm"
check_binary "go"
check_binary "cargo"

# Check Node.js version
NODE_VERSION=$(node --version | sed 's/v//')
echo "Node.js version: $NODE_VERSION"

# Check Go version
GO_VERSION=$(go version | awk '{print $3}')
echo "Go version: $GO_VERSION"

# Check Rust version
RUST_VERSION=$(rustc --version | awk '{print $2}')
echo "Rust version: $RUST_VERSION"

# Check npm version
NPM_VERSION=$(npm --version)
echo "npm version: $NPM_VERSION"

# Verify lock files exist
echo ""
echo "Checking dependency lock files..."
if [ ! -f "aegis-sdk/package-lock.json" ]; then
  echo "MISSING_LOCK_FILE: aegis-sdk/package-lock.json"
  exit 1
fi
echo "✓ aegis-sdk/package-lock.json found"

if [ ! -f "aegis-backend/go.sum" ]; then
  echo "MISSING_LOCK_FILE: aegis-backend/go.sum"
  exit 1
fi
echo "✓ aegis-backend/go.sum found"

if [ ! -f "aegis-sdk/src-rust/Cargo.lock" ]; then
  echo "MISSING_LOCK_FILE: aegis-sdk/src-rust/Cargo.lock"
  exit 1
fi
echo "✓ aegis-sdk/src-rust/Cargo.lock found"

echo ""
echo "=== Environment Validation PASSED ==="
