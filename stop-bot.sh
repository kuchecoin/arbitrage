#!/bin/bash

# --- CONFIGURATION ---
MANAGER_PATTERN="run-arbitrage.sh" # The script running the infinite loop
BOT_PATTERN="node .*arbitrage"         # The running Node.js bot process
# ---------------------

echo "=========================================================="
echo "🚨 Starting Unified Bot Shutdown: $(date)"
echo "=========================================================="

### 1. GRACEFUL STOP (SIGTERM) ###

# Crucial Step: Kill the manager loop first, so it doesn't restart the bot instantly.
echo "1a. Attempting to gracefully stop the **Manager Loop** ($MANAGER_PATTERN)..."
pkill -f "$MANAGER_PATTERN"

# Kill the arbitrage bot process
echo "1b. Attempting to gracefully stop the **Arbitrage Bot** ($BOT_PATTERN)..."
pkill -f "$BOT_PATTERN"

# Give the processes a few seconds to terminate gracefully
sleep 2

echo "----------------------------------------------------------"

### 2. FORCED STOP (SIGKILL) ###

# Check if either process is still running after the graceful signal
if pgrep -f "$MANAGER_PATTERN" > /dev/null; then
    echo "⚠️ Manager loop persisted. Forcing termination (SIGKILL -9)..."
    pkill -9 -f "$MANAGER_PATTERN"
fi

if pgrep -f "$BOT_PATTERN" > /dev/null; then
    echo "⚠️ Arbitrage bot persisted. Forcing termination (SIGKILL -9)..."
    pkill -9 -f "$BOT_PATTERN"
fi

# Final check for confirmation
if ! pgrep -f "$MANAGER_PATTERN" && ! pgrep -f "$BOT_PATTERN"; then
    echo "✅ SUCCESS: All bot processes have been stopped."
else
    echo "❌ WARNING: Some processes may still be running. Manual check recommended."
fi

echo "=========================================================="