timestamp=$(date +"%Y-%m-%d_%H-%M-%S")
logfile="logs/logs_viewer_$timestamp.log"

# Ensure logs directory exists
mkdir -p logs

# Run in background with both stdout and stderr piped to the timestamped log file
node server.js >> "$logfile" 2>&1 &
