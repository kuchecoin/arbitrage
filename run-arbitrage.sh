#!/bin/bash

# --- CONFIGURATION ---
LOG_DIR="logs"
ARCHIVE_DIR="logs/archive"
MAX_LOG_FILES=20
BOT_COMMAND_PATTERN="node .*arbitrage" # Pattern to match the running bot process
CYCLE_DELAY_SECONDS=$((6 * 60 * 60))  # 6 hours in seconds
MANAGER_LOG="$LOG_DIR/manager_loop.log" # Log file for the manager script itself
# ---------------------

# Ensure logs and archive directories exist
mkdir -p "$LOG_DIR"
mkdir -p "$ARCHIVE_DIR"

echo "==========================================================" >> "$MANAGER_LOG"
echo "Bot Manager Loop Started: $(date)" >> "$MANAGER_LOG"
echo "Target cycle delay: 6 hours ($CYCLE_DELAY_SECONDS seconds)" >> "$MANAGER_LOG"
echo "==========================================================" >> "$MANAGER_LOG"

# Start the infinite loop
while true; do

    echo "--- Bot Management Cycle Starting: $(date) ---" >> "$MANAGER_LOG"

    ### 1. STOP THE CURRENT BOT PROCESS ###
    # (Logic remains the same as previous version)
    echo "1. Attempting to stop existing bot process..." >> "$MANAGER_LOG"
    pids=$(pgrep -f "$BOT_COMMAND_PATTERN")

    if [ -z "$pids" ]; then
        echo "   -> No existing bot process found." >> "$MANAGER_LOG"
    else
        echo "   -> Found PID(s): $pids. Sending SIGTERM..." >> "$MANAGER_LOG"
        pkill -f "$BOT_COMMAND_PATTERN"
        sleep 3
        
        if pgrep -f "$BOT_COMMAND_PATTERN" > /dev/null; then
            echo "   -> Process still running. Sending SIGKILL (-9)..." >> "$MANAGER_LOG"
            pkill -9 -f "$BOT_COMMAND_PATTERN"
        fi
        echo "   -> Bot successfully stopped." >> "$MANAGER_LOG"
    fi

    echo "----------------------------------------------------------"

    ### 2. LOG ARCHIVING AND CLEANUP (MODIFIED FOR ZIP) ###
    echo "2. Checking log file count in $LOG_DIR..." >> "$MANAGER_LOG"
    
    # Count the number of current log files (excluding directories and hidden files)
    file_count=$(find "$LOG_DIR" -maxdepth 1 -type f -name 'arbitrage_*.log' | wc -l)
    echo "   -> Current log file count: $file_count" >> "$MANAGER_LOG"

    if [ "$file_count" -gt "$MAX_LOG_FILES" ]; then
        
        files_to_archive=$((file_count - MAX_LOG_FILES))
        echo "   -> Limit of $MAX_LOG_FILES exceeded. Archiving $files_to_archive oldest file(s)."

        # Find the oldest logs
        find "$LOG_DIR" -maxdepth 1 -type f -name 'arbitrage_*.log' \
            | sort \
            | head -n "$files_to_archive" \
            | while read -r logfile_path; do
                
                # Get just the filename (e.g., arbitrage_2025-11-20_10-00-00.log)
                filename=$(basename "$logfile_path")
                # Create the zip archive name (e.g., arbitrage_2025-11-20_10-00-00.zip)
                zip_filename="${filename%.log}.zip" 
                zip_path="$ARCHIVE_DIR/$zip_filename"

                # 2.1. Create the ZIP file
                echo "   -> Zipping $filename to $zip_path..." >> "$MANAGER_LOG"
                # -j: junk path (don't store directory structure)
                # -m: move file (delete original after zipping)
                zip -jm "$zip_path" "$logfile_path" 2>> "$MANAGER_LOG" 
                
                if [ $? -eq 0 ]; then
                    echo "   -> $filename successfully zipped and moved." >> "$MANAGER_LOG"
                else
                    echo "   -> ERROR: Failed to zip $filename." >> "$MANAGER_LOG"
                fi

            done
        
    else
        echo "   -> File count is within the limit ($MAX_LOG_FILES). No archiving needed." >> "$MANAGER_LOG"
    fi

    echo "----------------------------------------------------------"

    ### 3. RESTART THE BOT ###
    # (Logic remains the same as previous version)
    echo "3. Restarting the arbitrage bot..." >> "$MANAGER_LOG"
    timestamp=$(date +"%Y-%m-%d_%H-%M-%S")
    logfile="$LOG_DIR/arbitrage_$timestamp.log"

    npm run start >> "$logfile" 2>&1 &

    new_pid=$!
    echo "   -> Bot restarted successfully. New process PID: $new_pid" >> "$MANAGER_LOG"
    echo "   -> Logging output to: $logfile" >> "$MANAGER_LOG"

    echo "--- Cycle Finished. Sleeping for 6 hours. ---" >> "$MANAGER_LOG"
    
    ### 4. DELAY ###
    sleep "$CYCLE_DELAY_SECONDS"

done