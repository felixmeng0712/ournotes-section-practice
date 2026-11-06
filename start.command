#!/bin/bash
# Double-click on a Mac: starts the local server (charts and music are cached in data/, so it works offline afterwards)
# and opens it in the browser. Elsewhere, run: python3 server.py --port 8000
cd "$(dirname "$0")"
PORT=8000
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
echo "This computer:                 http://localhost:$PORT"
[ -n "$IP" ] && echo "Phone or tablet on this Wi-Fi: http://$IP:$PORT"
echo "Close this window to stop."
(sleep 1; open "http://localhost:$PORT") &
exec python3 server.py --port $PORT
