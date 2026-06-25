#!/usr/bin/env bash
# wait-for-it.sh: Wait for a service to become available
# Usage: ./wait-for-it.sh host port [timeout_in_seconds]

set -e

HOST="$1"
PORT="$2"
TIMEOUT="${3:-30}"

if [ -z "$HOST" ] || [ -z "$PORT" ]; then
    echo "Usage: $0 host port [timeout]"
    exit 1
fi

echo "Waiting for $HOST:$PORT to become available..."

START_TIME=$(date +%s)
while true; do
    CURRENT_TIME=$(date +%s)
    ELAPSED=$((CURRENT_TIME - START_TIME))
    
    if [ $ELAPSED -ge $TIMEOUT ]; then
        echo "ERROR: Timeout waiting for $HOST:$PORT after ${TIMEOUT}s"
        exit 1
    fi
    
    if timeout 1 bash -c "cat < /dev/null > /dev/tcp/$HOST/$PORT" 2>/dev/null; then
        echo "✓ $HOST:$PORT is available after ${ELAPSED}s"
        exit 0
    fi
    
    sleep 1
done
