ps aux | grep "node server.js" | grep -v grep | awk '{print $2}' | xargs kill
