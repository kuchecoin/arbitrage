#!/bin/bash

timestamp=$(date +"%Y-%m-%d_%H-%M-%S")
logfile="logs/arbitrage_$timestamp.log"

# Ensure logs directory exists
mkdir -p logs

# Run in background with both stdout and stderr piped to the timestamped log file
npm run arbitrage >> "$logfile" 2>&1 &
